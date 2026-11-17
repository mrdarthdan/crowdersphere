//! App settings, kept in settings.json in the app's data folder
//! (%APPDATA%\CrowderSphere on Windows — the same file the PowerShell version used).
//!
//! The WordPress application password is not stored in settings.json. It goes in the
//! operating system's credential store: Windows Credential Manager, the macOS Keychain,
//! or the Secret Service (GNOME Keyring / KWallet) on Linux.

use crate::posts::{read_text, str_of, write_atomic, Res};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

const KEYRING_SERVICE: &str = "CrowderSphere";
const KEYRING_USER: &str = "wordpress-application-password";

pub struct Settings {
    path: PathBuf,
    /// Everything in settings.json, including keys this version doesn't know about.
    raw: Map<String, Value>,
}

pub fn data_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("CrowderSphere")
}

fn default_posts_dir() -> String {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("Blog Posts")
        .to_string_lossy()
        .into_owned()
}

fn keyring_entry() -> Res<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Couldn't open the system password store: {e}"))
}

impl Settings {
    pub fn load(dir: &Path) -> Settings {
        let _ = std::fs::create_dir_all(dir);
        let path = dir.join("settings.json");
        let mut raw = read_text(&path)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| match v {
                Value::Object(m) => Some(m),
                _ => None,
            })
            .unwrap_or_default();
        if str_of(raw.get("postsDir")).is_empty() {
            raw.insert("postsDir".into(), json!(default_posts_dir()));
        }
        for k in ["siteUrl", "username"] {
            if !raw.get(k).map_or(false, Value::is_string) {
                raw.insert(k.into(), json!(""));
            }
        }
        if str_of(raw.get("restStyle")).is_empty() {
            raw.insert("restStyle".into(), json!("pretty"));
        }
        if raw.get("maxImageWidth").and_then(Value::as_i64).unwrap_or(0) <= 0 {
            raw.insert("maxImageWidth".into(), json!(1920));
        }
        let mut s = Settings { path, raw };
        s.migrate_legacy_password();
        s
    }

    pub fn save(&self) -> Res<()> {
        let txt = serde_json::to_string_pretty(&self.raw).map_err(|e| e.to_string())?;
        write_atomic(&self.path, txt.as_bytes())
    }

    pub fn get(&self, k: &str) -> String {
        str_of(self.raw.get(k))
    }
    pub fn set(&mut self, k: &str, v: Value) {
        self.raw.insert(k.into(), v);
    }
    pub fn posts_dir(&self) -> PathBuf {
        PathBuf::from(self.get("postsDir"))
    }

    pub fn password(&self) -> Option<String> {
        keyring_entry().ok()?.get_password().ok().filter(|p| !p.is_empty())
    }
    pub fn has_password(&self) -> bool {
        self.password().is_some()
    }
    pub fn set_password(&mut self, plain: &str) -> Res<()> {
        keyring_entry()?
            .set_password(plain)
            .map_err(|e| format!("Couldn't store the password in the system password store: {e}"))
    }
    pub fn clear_password(&mut self) {
        if let Ok(e) = keyring_entry() {
            let _ = e.delete_credential();
        }
        self.raw.insert("passwordEnc".into(), json!(""));
    }

    /// The PowerShell version stored the password DPAPI-encrypted in settings.json
    /// ("passwordEnc"). Move it into Windows Credential Manager the first time we run.
    /// passwordEnc is left in place so the old version keeps working during the switch-over.
    fn migrate_legacy_password(&mut self) {
        let enc = self.get("passwordEnc");
        if enc.is_empty() || self.has_password() {
            return;
        }
        if let Some(plain) = legacy::decrypt_password_enc(&enc) {
            if self.set_password(&plain).is_ok() {
                crate::log("Moved the WordPress password into the system password store.");
            }
        }
    }

    /// What the editor is allowed to see. Never includes the password.
    pub fn public(&self) -> Value {
        json!({
            "siteUrl": self.get("siteUrl"),
            "username": self.get("username"),
            "hasPassword": self.has_password(),
            "postsDir": self.get("postsDir"),
            "maxImageWidth": self.raw.get("maxImageWidth").and_then(Value::as_i64).unwrap_or(1920),
            "version": env!("CARGO_PKG_VERSION"),
            "prefs": self.raw.get("prefs").cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
        })
    }

    /// Apply changes from the Settings dialog.
    pub fn update(&mut self, b: &Value) -> Res<()> {
        for f in ["siteUrl", "username"] {
            if let Some(v) = b.get(f) {
                self.set(f, json!(str_of(Some(v)).trim()));
            }
        }
        if let Some(v) = b.get("postsDir") {
            let d = str_of(Some(v)).trim().to_string();
            if !d.is_empty() {
                self.set("postsDir", json!(d));
            }
        }
        if let Some(n) = b
            .get("maxImageWidth")
            .and_then(|v| v.as_i64().or_else(|| str_of(Some(v)).parse().ok()))
        {
            self.set("maxImageWidth", json!(n.clamp(320, 10000)));
        }
        if b.get("clearPassword").and_then(Value::as_bool).unwrap_or(false) {
            self.clear_password();
        }
        let pw = str_of(b.get("appPassword")).trim().to_string();
        if !pw.is_empty() {
            self.set_password(&pw)?;
        }
        if let Some(p) = b.get("prefs").filter(|p| p.is_object()) {
            self.set("prefs", p.clone());
        }
        if b.get("siteUrl").is_some() {
            self.set("restStyle", json!("pretty"));
        }
        self.save()
    }
}

#[cfg(windows)]
mod legacy {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    /// PowerShell's ConvertFrom-SecureString (no key) = hex of a DPAPI blob of UTF-16 text.
    pub fn decrypt_password_enc(hex: &str) -> Option<String> {
        let hex = hex.trim();
        if hex.len() % 2 != 0 {
            return None;
        }
        let mut bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok())
            .collect::<Option<Vec<u8>>>()?;
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_mut_ptr(),
        };
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                &mut out,
            )
        };
        if ok == 0 || out.pbData.is_null() {
            return None;
        }
        let plain = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) };
        let units: Vec<u16> = plain.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let text = String::from_utf16(&units).ok();
        unsafe {
            LocalFree(out.pbData as _);
        }
        text.filter(|t| !t.is_empty())
    }
}

#[cfg(not(windows))]
mod legacy {
    pub fn decrypt_password_enc(_hex: &str) -> Option<String> {
        None
    }
}
