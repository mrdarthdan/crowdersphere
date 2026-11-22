//! CrowderSphere desktop app (Tauri 2).
//!
//! The editor (ui/) runs in the system web view. It calls the commands below through
//! Tauri's IPC; nothing listens on a network port. Pictures and videos are shown to the
//! editor through the private `csfiles:` protocol, which only serves files from a post's images
//! and videos folders.

mod posts;
mod settings;
mod wp;

use posts::{str_of, Res};
use serde_json::{json, Value};
use settings::Settings;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

struct AppState {
    settings: Mutex<Settings>,
    /// Held while a command reads or writes post folders, so an autosave can never
    /// interleave with a publish that is updating the same post.json.
    disk: tokio::sync::Mutex<()>,
    closing: AtomicBool,
}

impl AppState {
    fn root(&self) -> PathBuf {
        self.settings.lock().unwrap().posts_dir()
    }
    fn wp(&self) -> wp::Wp {
        let s = self.settings.lock().unwrap();
        wp::Wp {
            site: s.get("siteUrl"),
            user: s.get("username"),
            pass: s.password().unwrap_or_default(),
            rest_style: s.get("restStyle"),
        }
    }
}

pub(crate) fn log(msg: &str) {
    let path = settings::data_dir().join("log.txt");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{}  {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), msg);
    }
}

/// Log a failed command, then pass the result on to the editor unchanged.
fn logged<T>(cmd: &str, r: Res<T>) -> Res<T> {
    if let Err(e) = &r {
        log(&format!("ERROR {cmd}: {e}"));
    }
    r
}

fn header(req: &tauri::ipc::Request<'_>, name: &str) -> Res<String> {
    let raw = req
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("Missing {name}"))?;
    Ok(urlencoding::decode(raw).map_err(|e| e.to_string())?.into_owned())
}

fn raw_body(req: &tauri::ipc::Request<'_>) -> Res<Vec<u8>> {
    match req.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("Expected file data".into()),
    }
}

// ------------------------------------------------------------------ settings

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Res<Value> {
    Ok(state.settings.lock().unwrap().public())
}

#[tauri::command]
async fn save_settings(state: State<'_, AppState>, body: Value) -> Res<Value> {
    let mut s = state.settings.lock().unwrap();
    logged("save_settings", s.update(&body))?;
    posts::ensure_root(&s.posts_dir())?;
    Ok(s.public())
}

#[tauri::command]
async fn test_connection(state: State<'_, AppState>) -> Res<Value> {
    let w = state.wp();
    let (result, style) = logged("test_connection", wp::test(&w).await)?;
    let mut s = state.settings.lock().unwrap();
    s.set("restStyle", json!(style));
    s.save()?;
    Ok(result)
}

// ------------------------------------------------------------------ posts

#[tauri::command]
async fn list_posts(state: State<'_, AppState>) -> Res<Value> {
    let root = state.root();
    let _g = state.disk.lock().await;
    let posts = logged("list_posts", posts::list_posts(&root))?;
    Ok(json!({ "posts": posts, "postsDir": root.to_string_lossy() }))
}

#[tauri::command]
async fn get_post(state: State<'_, AppState>, id: String) -> Res<Value> {
    let root = state.root();
    let _g = state.disk.lock().await;
    logged("get_post", posts::get_post(&root, &id))
}

#[tauri::command]
async fn save_post(state: State<'_, AppState>, body: Value) -> Res<Value> {
    let root = state.root();
    let _g = state.disk.lock().await;
    logged("save_post", posts::save_post(&root, &body))
}

#[tauri::command]
async fn delete_post(state: State<'_, AppState>, id: String) -> Res<Value> {
    let root = state.root();
    let _g = state.disk.lock().await;
    let dir = posts::post_dir(&root, &id)?;
    logged(
        "delete_post",
        trash::delete(&dir).map_err(|e| format!("Couldn't move the post to the Recycle Bin: {e}")),
    )?;
    Ok(json!({ "ok": true }))
}

/// Raw picture bytes in the body; post id and file name in the x-id / x-name headers.
#[tauri::command]
async fn save_image(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Res<Value> {
    let id = header(&request, "x-id")?;
    let name = header(&request, "x-name")?;
    let bytes = raw_body(&request)?;
    let root = state.root();
    let _g = state.disk.lock().await;
    let src = logged("save_image", posts::save_image(&root, &id, &name, &bytes))?;
    Ok(json!({ "src": src }))
}

/// One piece of a video being added (raw bytes in the body). Headers: x-id (post), x-name (the
/// video's file name), x-upload (an id for this video), x-offset (where the piece goes), x-last ("1"
/// on the final piece). Returns {src: "videos/..."} after the last piece, {} before that.
#[tauri::command]
async fn save_video_chunk(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Res<Value> {
    let id = header(&request, "x-id")?;
    let name = header(&request, "x-name")?;
    let upload = header(&request, "x-upload")?;
    let offset: u64 = header(&request, "x-offset")?.parse().map_err(|_| "Bad x-offset")?;
    let last = header(&request, "x-last")? == "1";
    let bytes = raw_body(&request)?;
    let root = state.root();
    let _g = state.disk.lock().await;
    let src = logged(
        "save_video_chunk",
        posts::save_video_chunk(&root, &id, &name, &upload, offset, last, &bytes),
    )?;
    Ok(match src {
        Some(src) => json!({ "src": src }),
        None => json!({}),
    })
}

#[tauri::command]
async fn discard_video(state: State<'_, AppState>, id: String, upload: String) -> Res<Value> {
    let root = state.root();
    let _g = state.disk.lock().await;
    logged("discard_video", posts::discard_video_upload(&root, &id, &upload))?;
    Ok(json!({ "ok": true }))
}

/// Raw .docx bytes in the body; post id and file name in the x-id / x-name headers.
#[tauri::command]
async fn export_docx(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Res<Value> {
    let id = header(&request, "x-id")?;
    let name = header(&request, "x-name")?;
    let bytes = raw_body(&request)?;
    let root = state.root();
    let _g = state.disk.lock().await;
    let dir = posts::post_dir(&root, &id)?;
    let file = posts::export_path(&dir, &name)?;
    let fname = file.file_name().unwrap().to_string_lossy().into_owned();
    logged(
        "export_docx",
        std::fs::write(&file, &bytes).map_err(|e| {
            if e.raw_os_error() == Some(32) {
                format!("Close '{fname}' in Word first, then export again.")
            } else {
                format!("Couldn't save {fname}: {e}")
            }
        }),
    )?;
    Ok(json!({ "path": file.to_string_lossy(), "name": fname }))
}

#[tauri::command]
async fn open_export(app: tauri::AppHandle, state: State<'_, AppState>, id: String, name: String) -> Res<Value> {
    let dir = posts::post_dir(&state.root(), &id)?;
    let file = posts::export_path(&dir, &name)?;
    if !file.exists() {
        return Err("That file isn't there any more - export it again.".into());
    }
    app.opener()
        .open_path(file.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the document: {e}"))?;
    Ok(json!({ "ok": true }))
}

// ------------------------------------------------------------------ WordPress

#[tauri::command]
async fn get_categories(state: State<'_, AppState>) -> Res<Value> {
    logged("get_categories", wp::categories(&state.wp()).await)
}

#[tauri::command]
async fn add_category(state: State<'_, AppState>, name: String) -> Res<Value> {
    logged("add_category", wp::add_category(&state.wp(), &name).await)
}

/// Upload progress for big files goes to the editor as "cs-publish-progress" events: {file, done, total}.
#[tauri::command]
async fn publish(app: tauri::AppHandle, state: State<'_, AppState>, body: Value) -> Res<Value> {
    let w = state.wp();
    let root = state.root();
    let report: wp::Report = std::sync::Arc::new(move |v| {
        let _ = app.emit("cs-publish-progress", v);
    });
    let _g = state.disk.lock().await;
    logged(
        "publish",
        wp::publish(
            &w,
            &root,
            &str_of(body.get("id")),
            &str_of(body.get("status")),
            &str_of(body.get("html")),
            &str_of(body.get("scheduleAt")),
            report,
        )
        .await,
    )
}

#[tauri::command]
async fn sync_scheduled(state: State<'_, AppState>) -> Res<Value> {
    let w = state.wp();
    let root = state.root();
    let _g = state.disk.lock().await;
    logged("sync_scheduled", wp::sync_scheduled(&w, &root).await)
}

/// A picture from another website, as raw bytes, for the Word export.
#[tauri::command]
async fn remote_image(url: String) -> Res<tauri::ipc::Response> {
    let bytes = logged("remote_image", wp::fetch_remote_image(&url).await)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ------------------------------------------------------------------ desktop helpers

/// Show a post's folder (or the posts folder) in Explorer / Finder.
#[tauri::command]
async fn open_folder(app: tauri::AppHandle, state: State<'_, AppState>, id: Option<String>) -> Res<Value> {
    let root = state.root();
    let target = match id.filter(|s| !s.is_empty()) {
        Some(id) => posts::post_dir(&root, &id)?,
        None => {
            posts::ensure_root(&root)?;
            root
        }
    };
    app.opener()
        .open_path(target.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the folder: {e}"))?;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn browse_folder(app: tauri::AppHandle, start: Option<String>) -> Res<Value> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dlg = app
        .dialog()
        .file()
        .set_title("Choose the folder where CrowderSphere keeps your posts");
    if let Some(s) = start.filter(|s| std::path::Path::new(s).is_dir()) {
        dlg = dlg.set_directory(s);
    }
    dlg.pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let picked = rx.await.ok().flatten();
    let path = picked
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    Ok(json!({ "path": path }))
}

#[tauri::command]
async fn open_url(app: tauri::AppHandle, url: String) -> Res<Value> {
    if url.starts_with("https://") || url.starts_with("http://") {
        app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "ok": true }))
}

// ------------------------------------------------------------------ updates

/// Ask GitHub whether a newer release exists. Updates are checked against the public key in
/// tauri.conf.json, so only releases signed with CrowderSphere's update key are offered.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Res<Value> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| format!("Updates aren't available: {e}"))?;
    let found = logged(
        "check_update",
        updater.check().await.map_err(|e| format!("Couldn't check for updates: {e}")),
    )?;
    Ok(match found {
        Some(u) => json!({ "available": true, "current": current, "version": u.version, "notes": u.body }),
        None => json!({ "available": false, "current": current }),
    })
}

/// Download and install the update, then restart. On Windows the installer closes the app itself.
/// Progress is reported to the editor as "cs-update-progress" events: {done, total}.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Res<()> {
    let updater = app.updater().map_err(|e| format!("Updates aren't available: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Couldn't check for updates: {e}"))?
        .ok_or("CrowderSphere is already up to date.")?;
    log(&format!("Installing update {}", update.version));
    let progress_app = app.clone();
    let mut done: u64 = 0;
    logged(
        "install_update",
        update
            .download_and_install(
                move |chunk, total| {
                    done += chunk as u64;
                    let _ = progress_app.emit("cs-update-progress", json!({ "done": done, "total": total }));
                },
                || {},
            )
            .await
            .map_err(|e| format!("The update didn't install: {e}")),
    )?;
    app.restart();
}

/// Called by the editor once it has saved after a close request.
#[tauri::command]
async fn quit(app: tauri::AppHandle) -> Res<()> {
    app.exit(0);
    Ok(())
}

// ------------------------------------------------------------------ picture and video protocol

/// csfiles://localhost/<post-id>/<images|videos>/<file>  (http://csfiles.localhost/... on Windows)
///
/// Videos are asked for a piece at a time (HTTP range requests), so they start playing and can be
/// skipped through without reading the whole file into memory.
fn serve_file(app: &tauri::AppHandle, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let respond = |status: u16| {
        tauri::http::Response::builder()
            .status(status)
            // the Word exporter fetch()es pictures from the editor page, a different origin
            .header("Access-Control-Allow-Origin", "*")
    };
    let not_found = || respond(404).body(Vec::new()).unwrap();
    let parts: Vec<String> = request
        .uri()
        .path()
        .trim_start_matches('/')
        .split('/')
        .map(|p| percent_encoding::percent_decode_str(p).decode_utf8_lossy().into_owned())
        .collect();
    if parts.len() != 3 || !posts::is_safe_name(&parts[0]) {
        return not_found();
    }
    let root = app.state::<AppState>().root();
    let Ok(file) = posts::media_path(&root.join(&parts[0]), &format!("{}/{}", parts[1], parts[2])) else {
        return not_found();
    };
    let Ok(mut f) = std::fs::File::open(&file) else {
        return not_found();
    };
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return not_found();
    };
    let ok = |status: u16| {
        respond(status)
            .header("Content-Type", posts::mime_of(&file))
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Accept-Ranges", "bytes")
    };
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    match range.map(|r| byte_range(r, len)) {
        None => {
            let mut bytes = Vec::new();
            match f.read_to_end(&mut bytes) {
                Ok(_) => ok(200).body(bytes).unwrap(),
                Err(_) => not_found(),
            }
        }
        Some(Some((start, end))) => {
            let mut bytes = vec![0u8; (end - start + 1) as usize];
            match f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut bytes)) {
                Ok(()) => ok(206)
                    .header("Content-Range", format!("bytes {start}-{end}/{len}"))
                    .body(bytes)
                    .unwrap(),
                Err(_) => not_found(),
            }
        }
        Some(None) => respond(416)
            .header("Content-Range", format!("bytes */{len}"))
            .body(Vec::new())
            .unwrap(),
    }
}

/// The first byte range in a Range header ("bytes=0-", "bytes=100-199", "bytes=-500") for a file
/// of `len` bytes, as inclusive (start, end). Open-ended ranges get at most 4 MB at a time; the
/// player simply asks for the next piece. None if the range can't be served.
fn byte_range(header: &str, len: u64) -> Option<(u64, u64)> {
    const PIECE: u64 = 4 * 1024 * 1024;
    let spec = header.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if len == 0 {
        return None;
    }
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        if n == 0 {
            return None;
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() {
            start.saturating_add(PIECE - 1)
        } else {
            b.parse().ok()?
        };
        (start, end.min(len - 1))
    };
    (start <= end && start < len).then_some((start, end))
}

// ------------------------------------------------------------------ app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = settings::data_dir();
    let state = AppState {
        settings: Mutex::new(Settings::load(&data_dir)),
        disk: tokio::sync::Mutex::new(()),
        closing: AtomicBool::new(false),
    };
    log(&format!(
        "Launching CrowderSphere {} on {}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    ));

    tauri::Builder::default()
        // Must be registered first: a second launch just brings the open window to the front,
        // so two copies can never edit (and overwrite) the same post.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .register_uri_scheme_protocol("csfiles", |ctx, request| serve_file(ctx.app_handle(), &request))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let st = window.state::<AppState>();
                // First close: let the editor save, then it calls `quit`. A second click on X,
                // or an editor that doesn't answer within 5 seconds, closes regardless.
                if !st.closing.swap(true, Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("cs-close-requested", ());
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        app.exit(0);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            test_connection,
            list_posts,
            get_post,
            save_post,
            delete_post,
            save_image,
            save_video_chunk,
            discard_video,
            export_docx,
            open_export,
            get_categories,
            add_category,
            publish,
            sync_scheduled,
            remote_image,
            check_update,
            install_update,
            open_folder,
            browse_folder,
            open_url,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running CrowderSphere");
}

#[cfg(test)]
mod tests {
    use super::byte_range;

    #[test]
    fn ranges() {
        let mb = 1024 * 1024;
        assert_eq!(byte_range("bytes=0-", 100), Some((0, 99)));
        assert_eq!(byte_range("bytes=0-", 10 * mb), Some((0, 4 * mb - 1)));
        assert_eq!(byte_range("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(byte_range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(byte_range("bytes=-10", 100), Some((90, 99)));
        assert_eq!(byte_range("bytes=-500", 100), Some((0, 99)));
        assert_eq!(byte_range("bytes=0-9, 20-29", 100), Some((0, 9)));
        assert_eq!(byte_range("bytes=100-", 100), None);
        assert_eq!(byte_range("bytes=20-10", 100), None);
        assert_eq!(byte_range("bytes=0-", 0), None);
        assert_eq!(byte_range("items=0-1", 100), None);
        assert_eq!(byte_range("bytes=x-", 100), None);
    }
}
