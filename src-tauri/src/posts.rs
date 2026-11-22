//! Posts on disk. Each post is a folder:
//!
//! ```text
//! 2026-11-07-hiking-bryce-canyon/
//!   post.html   the post content (paths are relative: images/..., videos/...)
//!   post.json   title, categories, tags, WordPress post ID, upload history
//!   images/     the pictures used in the post
//!   videos/     the video files used in the post (only made when one is added)
//! ```
//!
//! The format is the same one the original PowerShell version wrote, so existing
//! posts open unchanged. Unknown keys in post.json are kept as they are.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub type Res<T> = Result<T, String>;

pub fn now_iso() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Folder and file names we create or accept from the UI: letters, digits, dot, dash, underscore.
pub fn is_safe_name(n: &str) -> bool {
    !n.is_empty()
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && !n.chars().all(|c| c == '.')
}

/// "Hiking Bryce Cañon!" -> "hiking-bryce-canon"
pub fn make_slug(title: &str) -> String {
    use unicode_normalization::char::is_combining_mark;
    use unicode_normalization::UnicodeNormalization;
    let folded: String = title.to_lowercase().nfd().filter(|c| !is_combining_mark(*c)).collect();
    let mut out = String::new();
    let mut last_dash = false;
    for c in folded.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let mut out = out.trim_matches('-').to_string();
    if out.len() > 50 {
        out.truncate(50); // ASCII only, so this is a char boundary
        out = out.trim_matches('-').to_string();
    }
    if out.is_empty() {
        "untitled".into()
    } else {
        out
    }
}

/// Write a file by writing a temporary copy and renaming it over the original,
/// so a crash or power cut never leaves a half-written post.json or post.html.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Res<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Couldn't save {}: {e}", path.display())
    })
}

pub fn read_text(path: &Path) -> Res<String> {
    let s = fs::read_to_string(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    Ok(s.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(s))
}

pub fn ensure_root(root: &Path) -> Res<()> {
    fs::create_dir_all(root).map_err(|e| format!("Couldn't create the posts folder {}: {e}", root.display()))
}

pub fn post_dir(root: &Path, id: &str) -> Res<PathBuf> {
    if !is_safe_name(id) {
        return Err("Bad post id".into());
    }
    let d = root.join(id);
    if !d.is_dir() {
        return Err(format!("That post folder no longer exists: {}", d.display()));
    }
    Ok(d)
}

pub fn new_post_folder(root: &Path, title: &str) -> Res<String> {
    ensure_root(root)?;
    let base = format!("{}-{}", chrono::Local::now().format("%Y-%m-%d"), make_slug(title));
    let mut id = base.clone();
    let mut n = 2;
    while root.join(&id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    fs::create_dir_all(root.join(&id).join("images")).map_err(|e| format!("Couldn't create the post folder: {e}"))?;
    Ok(id)
}

pub fn default_meta() -> Map<String, Value> {
    let now = now_iso();
    let v = json!({
        "title": "", "excerpt": "", "categories": [], "tags": "", "featured": "",
        "created": now, "modified": now,
        "wpId": null, "wpLink": "", "wpStatus": "", "published": "", "scheduled": "",
        "media": {}
    });
    match v {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

/// Windows PowerShell sometimes wrote arrays as {"value": [...], "Count": n}; unwrap those.
fn normalize_array(v: &Value) -> Value {
    match v {
        Value::Array(_) => v.clone(),
        Value::Null => json!([]),
        Value::Object(o) if o.get("value").is_some_and(Value::is_array) => o["value"].clone(),
        other => json!([other]),
    }
}

pub fn load_meta(dir: &Path) -> Map<String, Value> {
    let def = default_meta();
    let p = dir.join("post.json");
    let parsed = read_text(&p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
    let mut m = match parsed {
        Some(Value::Object(m)) => m,
        _ => return def,
    };
    for (k, v) in def {
        if !m.contains_key(&k) {
            m.insert(k, v);
        }
    }
    if !m.get("media").is_some_and(Value::is_object) {
        m.insert("media".into(), json!({}));
    }
    let cats = normalize_array(&m["categories"]);
    m.insert("categories".into(), cats);
    m
}

pub fn save_meta(dir: &Path, meta: &Map<String, Value>) -> Res<()> {
    let txt = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    write_atomic(&dir.join("post.json"), txt.as_bytes())
}

pub fn str_of(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

pub fn list_posts(root: &Path) -> Res<Vec<Value>> {
    ensure_root(root)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("Couldn't read {}: {e}", root.display()))? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !path.is_dir() || !is_safe_name(&name) || !path.join("post.json").exists() {
            continue;
        }
        let m = load_meta(&path);
        out.push(json!({
            "id": name,
            "title": m["title"], "modified": m["modified"], "created": m["created"],
            "wpStatus": m["wpStatus"], "wpLink": m["wpLink"],
            "published": m["published"], "scheduled": m["scheduled"],
        }));
    }
    out.sort_by_key(|p| std::cmp::Reverse(str_of(p.get("modified"))));
    Ok(out)
}

pub fn get_post(root: &Path, id: &str) -> Res<Value> {
    let dir = post_dir(root, id)?;
    let hp = dir.join("post.html");
    let html = if hp.exists() { read_text(&hp)? } else { String::new() };
    Ok(json!({ "id": id, "meta": load_meta(&dir), "html": html }))
}

/// Save the editor's content. `body` is {id?, html?, meta?: {title, excerpt, categories, tags, featured}}.
pub fn save_post(root: &Path, body: &Value) -> Res<Value> {
    let empty = Map::new();
    let bm = body.get("meta").and_then(Value::as_object).unwrap_or(&empty);
    let id = match str_of(body.get("id")) {
        s if s.is_empty() => new_post_folder(root, &str_of(bm.get("title")))?,
        s => s,
    };
    let dir = post_dir(root, &id)?;
    let mut meta = load_meta(&dir);
    for f in ["title", "excerpt", "tags", "featured"] {
        if bm.contains_key(f) {
            meta.insert(f.into(), Value::String(str_of(bm.get(f))));
        }
    }
    if let Some(c) = bm.get("categories") {
        meta.insert("categories".into(), normalize_array(c));
    }
    meta.insert("modified".into(), Value::String(now_iso()));
    if let Some(h) = body.get("html") {
        write_atomic(&dir.join("post.html"), str_of(Some(h)).as_bytes())?;
    }
    save_meta(&dir, &meta)?;
    Ok(json!({ "id": id, "meta": meta }))
}

pub const IMAGE_EXTS: [&str; 4] = ["jpg", "png", "gif", "webp"];
pub const VIDEO_EXTS: [&str; 4] = ["mp4", "m4v", "mov", "webm"];

/// The lower-case extension of a file name from the editor, if it's one of `allowed`.
fn allowed_ext(name: &str, allowed: &[&str]) -> Option<String> {
    let mut ext = Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext == "jpeg" {
        ext = "jpg".into();
    }
    allowed.contains(&ext.as_str()).then_some(ext)
}

/// A safe, unused file name in `dir` for a file the user called `name`: "My Photo!.JPEG" -> "my-photo.jpg".
fn unused_name(dir: &Path, name: &str, ext: &str, fallback: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut base = String::new();
    let mut last_dash = false;
    for c in stem.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' {
            base.push(c);
            last_dash = false;
        } else if !last_dash {
            base.push('-');
            last_dash = true;
        }
    }
    let mut base = base.trim_matches('-').to_string();
    base.truncate(60);
    if base.is_empty() {
        base = fallback.into();
    }
    let mut file = format!("{base}.{ext}");
    let mut n = 2;
    while dir.join(&file).exists() {
        file = format!("{base}-{n}.{ext}");
        n += 1;
    }
    file
}

/// Store a picture in the post's images folder. Returns its relative path, e.g. "images/sunset-2.jpg".
pub fn save_image(root: &Path, id: &str, name: &str, bytes: &[u8]) -> Res<String> {
    let dir = post_dir(root, id)?;
    let img_dir = dir.join("images");
    fs::create_dir_all(&img_dir).map_err(|e| e.to_string())?;
    let ext = allowed_ext(name, &IMAGE_EXTS).ok_or_else(|| {
        let ext = Path::new(name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        format!("Unsupported image type '.{ext}'. Use JPG, PNG, GIF or WebP.")
    })?;
    let file = unused_name(&img_dir, name, &ext, "image");
    fs::write(img_dir.join(&file), bytes).map_err(|e| format!("Couldn't save the picture: {e}"))?;
    Ok(format!("images/{file}"))
}

/// Where a video being added arrives, piece by piece, before it gets its real name.
fn upload_part(dir: &Path, upload: &str) -> Res<PathBuf> {
    if !(8..=64).contains(&upload.len()) || !upload.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Bad upload id".into());
    }
    Ok(dir.join("videos").join(format!(".adding-{upload}.part")))
}

/// Add a video to the post's videos folder. Videos are too big to send in one go, so the editor
/// sends them in pieces: `offset` is where this piece goes, and the last piece (`last`) moves the
/// finished file to its real name. Returns its relative path then, e.g. "videos/sunset.mp4".
pub fn save_video_chunk(
    root: &Path,
    id: &str,
    name: &str,
    upload: &str,
    offset: u64,
    last: bool,
    bytes: &[u8],
) -> Res<Option<String>> {
    use std::io::Write;
    let dir = post_dir(root, id)?;
    let ext = allowed_ext(name, &VIDEO_EXTS).ok_or("Unsupported video type. Use MP4, MOV, M4V or WebM videos.")?;
    let part = upload_part(&dir, upload)?;
    let vid_dir = dir.join("videos");
    fs::create_dir_all(&vid_dir).map_err(|e| e.to_string())?;
    let mut f = if offset == 0 {
        fs::File::create(&part)
    } else {
        fs::OpenOptions::new().append(true).open(&part)
    }
    .map_err(|e| format!("Couldn't save the video: {e}"))?;
    let have = f.metadata().map_err(|e| e.to_string())?.len();
    if have != offset {
        return Err("The video was interrupted while it was being added. Please add it again.".into());
    }
    f.write_all(bytes).map_err(|e| format!("Couldn't save the video: {e}"))?;
    drop(f);
    if !last {
        return Ok(None);
    }
    let file = unused_name(&vid_dir, name, &ext, "video");
    fs::rename(&part, vid_dir.join(&file)).map_err(|e| format!("Couldn't save the video: {e}"))?;
    Ok(Some(format!("videos/{file}")))
}

/// Throw away a video that stopped part way through being added.
pub fn discard_video_upload(root: &Path, id: &str, upload: &str) -> Res<()> {
    let part = upload_part(&post_dir(root, id)?, upload)?;
    if part.exists() {
        fs::remove_file(&part).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Resolve "images/<file>" or "videos/<file>" inside a post folder, refusing anything that could point elsewhere.
pub fn media_path(dir: &Path, rel: &str) -> Res<PathBuf> {
    let mut parts = rel.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(d @ ("images" | "videos")), Some(f), None) if is_safe_name(f) && !f.starts_with('.') => Ok(dir.join(d).join(f)),
        _ => Err(format!("Bad file path: {rel}")),
    }
}

pub fn is_video(rel: &str) -> bool {
    rel.starts_with("videos/")
}

/// Word export file name, e.g. "Hiking Bryce Canyon.docx".
pub fn export_path(dir: &Path, name: &str) -> Res<PathBuf> {
    let name = name.trim();
    let re = regex::Regex::new(r"(?i)^[A-Za-z0-9][A-Za-z0-9 ._()'&,-]*\.docx$").unwrap();
    if name.chars().count() > 120 || !re.is_match(name) || name.contains("..") {
        return Err("Bad export file name".into());
    }
    Ok(dir.join(name))
}

pub fn mime_of(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

/// File modification time as .NET ticks, which is how the PowerShell version recorded
/// uploads in post.json. Keeping the same unit means pictures uploaded by the old
/// version are recognized and not uploaded twice.
pub fn dotnet_ticks(t: SystemTime) -> String {
    const UNIX_EPOCH_TICKS: i128 = 621_355_968_000_000_000;
    let ticks = match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_nanos() as i128 / 100 + UNIX_EPOCH_TICKS,
        Err(e) => UNIX_EPOCH_TICKS - e.duration().as_nanos() as i128 / 100,
    };
    ticks.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn slugs() {
        assert_eq!(make_slug("Hiking Bryce Cañon!"), "hiking-bryce-canon");
        assert_eq!(make_slug("  --  "), "untitled");
        assert_eq!(make_slug(""), "untitled");
        assert_eq!(make_slug(&"a ".repeat(40)).len() <= 50, true);
        assert!(!make_slug(&"ab ".repeat(30)).ends_with('-'));
    }

    #[test]
    fn safe_names() {
        assert!(is_safe_name("2026-11-07-hiking"));
        assert!(is_safe_name("photo_1.jpg"));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name("."));
        assert!(!is_safe_name("a/b"));
        assert!(!is_safe_name("a\\b"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name("café"));
    }

    #[test]
    fn media_paths_cannot_escape() {
        let d = Path::new("/posts/p");
        assert!(media_path(d, "images/a.jpg").is_ok());
        assert!(media_path(d, "videos/a.mp4").is_ok());
        assert!(media_path(d, "images/../post.json").is_err());
        assert!(media_path(d, "videos/../post.json").is_err());
        assert!(media_path(d, "../../etc/passwd").is_err());
        assert!(media_path(d, "images/sub/a.jpg").is_err());
        assert!(media_path(d, "post.json").is_err());
        assert!(media_path(d, "exports/a.docx").is_err());
        assert!(media_path(d, "videos/.adding-abcdefgh.part").is_err());
    }

    #[test]
    fn export_names() {
        let d = Path::new("/posts/p");
        assert!(export_path(d, "Hiking Bryce Canyon.docx").is_ok());
        assert!(export_path(d, "Rock & Roll (draft), v2.DOCX").is_ok());
        assert!(export_path(d, "../evil.docx").is_err());
        assert!(export_path(d, "a..b.docx").is_err());
        assert!(export_path(d, "notes.txt").is_err());
        assert!(export_path(d, &format!("{}.docx", "a".repeat(130))).is_err());
    }

    #[test]
    fn ticks_match_dotnet() {
        // 2026-01-01T00:00:00Z in .NET ticks
        let t = UNIX_EPOCH + Duration::from_secs(1_767_225_600);
        assert_eq!(dotnet_ticks(t), "639028224000000000");
    }

    #[test]
    fn post_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let r = save_post(
            root,
            &json!({ "html": "<p>Hi</p>", "meta": { "title": "My Trip", "categories": [3] } }),
        )
        .unwrap();
        let id = r["id"].as_str().unwrap().to_string();
        assert!(id.ends_with("-my-trip"));

        let p = get_post(root, &id).unwrap();
        assert_eq!(p["html"], "<p>Hi</p>");
        assert_eq!(p["meta"]["title"], "My Trip");
        assert_eq!(p["meta"]["categories"], json!([3]));

        // a second post with the same title gets its own folder
        let r2 = save_post(root, &json!({ "meta": { "title": "My Trip" } })).unwrap();
        assert_ne!(r2["id"], r["id"]);

        // updating without html keeps the old html; unknown keys survive
        let dir = root.join(&id);
        let mut m = load_meta(&dir);
        m.insert("somethingNew".into(), json!(42));
        save_meta(&dir, &m).unwrap();
        save_post(root, &json!({ "id": id, "meta": { "excerpt": "short" } })).unwrap();
        let p = get_post(root, &id).unwrap();
        assert_eq!(p["html"], "<p>Hi</p>");
        assert_eq!(p["meta"]["excerpt"], "short");
        assert_eq!(p["meta"]["somethingNew"], 42);

        assert_eq!(list_posts(root).unwrap().len(), 2);
        assert!(get_post(root, "../x").is_err());
    }

    #[test]
    fn legacy_powershell_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("2025-01-01-old");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("post.json"),
            "\u{feff}{\"title\":\"Old\",\"categories\":{\"value\":[1,2],\"Count\":2},\"media\":null}",
        )
        .unwrap();
        let m = load_meta(&dir);
        assert_eq!(m["title"], "Old");
        assert_eq!(m["categories"], json!([1, 2]));
        assert!(m["media"].is_object());
        assert_eq!(m["wpStatus"], "");
    }

    #[test]
    fn images_are_named_safely() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let id = new_post_folder(root, "Pics").unwrap();
        assert_eq!(save_image(root, &id, "My Photo!.JPEG", b"x").unwrap(), "images/my-photo.jpg");
        assert_eq!(
            save_image(root, &id, "My Photo!.jpeg", b"x").unwrap(),
            "images/my-photo-2.jpg"
        );
        assert_eq!(
            save_image(root, &id, "..\\..\\evil.png", b"x")
                .unwrap()
                .starts_with("images/"),
            true
        );
        assert!(save_image(root, &id, "script.exe", b"x").is_err());
        assert!(save_image(root, &id, "noext", b"x").is_err());
    }

    #[test]
    fn videos_arrive_in_pieces() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let id = new_post_folder(root, "Clips").unwrap();
        let up = "abcDEF123456";
        assert_eq!(
            save_video_chunk(root, &id, "Salt River.MOV", up, 0, false, b"hello ").unwrap(),
            None
        );
        assert!(!root.join(&id).join("videos").join("salt-river.mov").exists());
        // a piece that doesn't follow on from the last one is refused
        assert!(save_video_chunk(root, &id, "Salt River.MOV", up, 3, false, b"x").is_err());
        let done = save_video_chunk(root, &id, "Salt River.MOV", up, 6, true, b"world").unwrap();
        assert_eq!(done.as_deref(), Some("videos/salt-river.mov"));
        let dir = root.join(&id).join("videos");
        assert_eq!(fs::read(dir.join("salt-river.mov")).unwrap(), b"hello world");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "the temporary piece file is gone");
        // same name again gets its own file
        let again = save_video_chunk(root, &id, "salt river.mov", "zzzzzzzz", 0, true, b"x").unwrap();
        assert_eq!(again.as_deref(), Some("videos/salt-river-2.mov"));
        // unsupported types and unsafe upload ids are refused
        assert!(save_video_chunk(root, &id, "clip.avi", up, 0, true, b"x").is_err());
        assert!(save_video_chunk(root, &id, "clip.mp4", "../../evil", 0, true, b"x").is_err());
        assert!(save_video_chunk(root, &id, "clip.mp4", "short", 0, true, b"x").is_err());
        // an abandoned video is thrown away
        save_video_chunk(root, &id, "clip.webm", "abandoned1", 0, false, b"x").unwrap();
        discard_video_upload(root, &id, "abandoned1").unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        assert_eq!(mime_of(Path::new("a.MP4")), "video/mp4");
        assert!(is_video("videos/a.mp4") && !is_video("images/a.jpg"));
    }
}
