//! WordPress REST API: connection test, categories, tags, media uploads, posts and scheduling.
//! Authentication uses a WordPress Application Password over HTTP Basic auth.

use crate::posts::{self, str_of, Res};
use serde_json::{json, Map, Value};
use std::path::Path;
use std::time::Duration;

/// Everything needed to talk to the site, copied out of Settings so no lock is held
/// while waiting on the network.
#[derive(Clone)]
pub struct Wp {
    pub site: String,
    pub user: String,
    pub pass: String,
    pub rest_style: String,
}

#[derive(Debug)]
pub struct WpError {
    pub status: Option<u16>,
    pub msg: String,
    /// WordPress's JSON error body, when there was one ({code, message, data})
    pub body: Option<Value>,
}
impl From<WpError> for String {
    fn from(e: WpError) -> String {
        e.msg
    }
}
fn wp_err(msg: impl Into<String>) -> WpError {
    WpError {
        status: None,
        msg: msg.into(),
        body: None,
    }
}

pub enum Body {
    None,
    Json(Value),
    Bytes(Vec<u8>, String),
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(format!(
            "CrowderSphere/{} ({})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        ))
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()
        .expect("HTTP client")
}

/// Download a picture from another website, for the Word export. The editor page can't
/// fetch it itself because browsers block cross-site downloads that the site doesn't allow (CORS).
pub async fn fetch_remote_image(url: &str) -> Res<Vec<u8>> {
    const MAX: usize = 40 * 1024 * 1024;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web (http/https) pictures can be downloaded.".into());
    }
    let resp = client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't download {url}: {}", error_chain(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("Couldn't download {url}: HTTP {}", resp.status().as_u16()));
    }
    let ct = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if !ct.is_empty() && !ct.starts_with("image/") && !ct.starts_with("application/octet-stream") {
        return Err(format!("{url} isn't a picture ({ct})"));
    }
    if resp.content_length().is_some_and(|n| n as usize > MAX) {
        return Err(format!("{url} is too large to include"));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("Couldn't download {url}: {e}"))?;
    if bytes.len() > MAX {
        return Err(format!("{url} is too large to include"));
    }
    Ok(bytes.to_vec())
}

pub fn html_decode(s: &str) -> String {
    html_escape::decode_html_entities(s).into_owned()
}

fn truncate_chars(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "..."
    }
}

impl Wp {
    pub fn url(&self, route: &str, query: &str) -> Result<String, WpError> {
        let mut site = self.site.trim().trim_end_matches('/').to_string();
        if site.is_empty() {
            return Err(wp_err("Set your WordPress site address in Settings first."));
        }
        if !site.starts_with("http://") && !site.starts_with("https://") {
            site = format!("https://{site}");
        }
        Ok(if self.rest_style == "query" {
            let mut u = format!("{site}/?rest_route={route}");
            if !query.is_empty() {
                u.push('&');
                u.push_str(query);
            }
            u
        } else {
            let mut u = format!("{site}/wp-json{route}");
            if !query.is_empty() {
                u.push('?');
                u.push_str(query);
            }
            u
        })
    }

    pub async fn call(
        &self,
        method: &str,
        route: &str,
        query: &str,
        body: Body,
        headers: &[(&str, String)],
    ) -> Result<Value, WpError> {
        if self.user.is_empty() || self.pass.is_empty() {
            return Err(wp_err(
                "Add your WordPress username and application password in Settings first.",
            ));
        }
        let url = self.url(route, query)?;
        let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| wp_err(e.to_string()))?;
        let mut req = client()
            .request(m, &url)
            .basic_auth(&self.user, Some(&self.pass))
            .header("Accept", "application/json");
        for (k, v) in headers {
            req = req.header(*k, v);
        }
        req = match body {
            Body::None => req,
            Body::Json(v) => req.json(&v),
            Body::Bytes(b, ct) => req.header("Content-Type", ct).body(b),
        };
        let resp = req
            .send()
            .await
            .map_err(|e| wp_err(format!("Couldn't reach {}: {}", self.site, error_chain(&e))))?;
        let status = resp.status().as_u16();
        let txt = resp
            .text()
            .await
            .map_err(|e| wp_err(format!("Couldn't read WordPress's reply: {e}")))?;
        if !(200..300).contains(&status) {
            let body = serde_json::from_str::<Value>(&txt).ok();
            let mut msg = body
                .as_ref()
                .and_then(|j| j.get("message").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| {
                    let no_tags = regex::Regex::new(r"<[^>]+>").unwrap().replace_all(&txt, " ");
                    regex::Regex::new(r"\s+")
                        .unwrap()
                        .replace_all(&no_tags, " ")
                        .trim()
                        .to_string()
                });
            msg = truncate_chars(&html_decode(&msg), 300);
            if status == 401 {
                msg.push_str(" (Check the username and application password in Settings.)");
            }
            return Err(WpError {
                status: Some(status),
                msg: format!("WordPress said (HTTP {status}): {msg}"),
                body,
            });
        }
        // Some hosts print PHP notices before the JSON; skip to the first { or [
        let start = txt
            .find(['{', '['])
            .ok_or_else(|| wp_err("WordPress sent back something that isn't API data. Is the site address right?"))?;
        serde_json::from_str(&txt[start..])
            .map_err(|e| wp_err(format!("WordPress sent back data CrowderSphere couldn't read: {e}")))
    }

    pub async fn get(&self, route: &str, query: &str) -> Result<Value, WpError> {
        self.call("GET", route, query, Body::None, &[]).await
    }
    pub async fn post(&self, route: &str, v: Value) -> Result<Value, WpError> {
        self.call("POST", route, "", Body::Json(v), &[]).await
    }
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut s = e.to_string();
    let mut cur = e.source();
    while let Some(inner) = cur {
        s.push_str(": ");
        s.push_str(&inner.to_string());
        cur = inner.source();
    }
    s
}

/// Try the current REST URL style first, then the other ("pretty" /wp-json/ or "query" ?rest_route=).
/// Returns the result and the style that worked.
pub async fn test(wp: &Wp) -> Result<(Value, String), String> {
    let mut styles = vec![wp.rest_style.clone()];
    for s in ["pretty", "query"] {
        if s != wp.rest_style {
            styles.push(s.into());
        }
    }
    let mut first_err: Option<String> = None;
    for style in styles {
        let w = Wp {
            rest_style: style.clone(),
            ..wp.clone()
        };
        match w.get("/wp/v2/users/me", "context=edit").await {
            Ok(me) => {
                let can_publish = me
                    .get("capabilities")
                    .and_then(|c| c.get("publish_posts"))
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                return Ok((
                    json!({ "ok": true, "name": me.get("name"), "canPublish": can_publish }),
                    style,
                ));
            }
            Err(e) => {
                if matches!(e.status, Some(401 | 403)) {
                    return Err(e.msg);
                }
                first_err.get_or_insert(e.msg);
            }
        }
    }
    Err(first_err.unwrap_or_else(|| "Couldn't connect.".into()))
}

fn category_json(c: &Value) -> Value {
    json!({ "id": c.get("id"), "name": html_decode(&str_of(c.get("name"))), "parent": c.get("parent") })
}

pub async fn categories(wp: &Wp) -> Res<Value> {
    let r = wp
        .get("/wp/v2/categories", "per_page=100&orderby=name&hide_empty=false")
        .await?;
    let list: Vec<Value> = r
        .as_array()
        .map(|a| a.iter().map(category_json).collect())
        .unwrap_or_default();
    Ok(json!({ "categories": list }))
}

pub async fn add_category(wp: &Wp, name: &str) -> Res<Value> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Type a category name first.".into());
    }
    let r = wp.post("/wp/v2/categories", json!({ "name": name })).await?;
    Ok(category_json(&r))
}

async fn resolve_tag_ids(wp: &Wp, text: &str) -> Res<Vec<i64>> {
    let mut ids = Vec::new();
    for name in text.split(',').map(str::trim).filter(|n| !n.is_empty()) {
        let q = format!("per_page=100&search={}", urlencoding::encode(name));
        let r = wp.get("/wp/v2/tags", &q).await?;
        let found = r.as_array().and_then(|a| {
            a.iter()
                .find(|t| html_decode(&str_of(t.get("name"))).to_lowercase() == name.to_lowercase())
                .and_then(|t| t.get("id").and_then(Value::as_i64))
        });
        let id = match found {
            Some(id) => id,
            None => match wp.post("/wp/v2/tags", json!({ "name": name })).await {
                Ok(t) => t
                    .get("id")
                    .and_then(Value::as_i64)
                    .ok_or("WordPress didn't return the new tag's id")?,
                // A tag that differs only in accents or punctuation already exists: WordPress tells us its id
                Err(e) => existing_term_id(&e).ok_or(e.msg)?,
            },
        };
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// WordPress refuses to create a duplicate term with {"code":"term_exists","data":{"term_id":N}}.
fn existing_term_id(e: &WpError) -> Option<i64> {
    let b = e.body.as_ref()?;
    if b.get("code").and_then(Value::as_str) != Some("term_exists") {
        return None;
    }
    b.get("data")?.get("term_id")?.as_i64()
}

/// Upload a local picture to the Media Library unless the same file was uploaded before.
async fn ensure_media(wp: &Wp, dir: &Path, meta: &mut Map<String, Value>, rel: &str) -> Res<Value> {
    let path = posts::image_path(dir, rel)?;
    let md = std::fs::metadata(&path).map_err(|_| format!("Image file is missing: {rel}"))?;
    let size = md.len();
    let mtime = posts::dotnet_ticks(md.modified().map_err(|e| e.to_string())?);
    if let Some(prev) = meta.get("media").and_then(|m| m.get(rel)) {
        let prev_size = prev
            .get("size")
            .and_then(|s| s.as_u64().or_else(|| str_of(Some(s)).parse().ok()));
        if prev_size == Some(size) && str_of(prev.get("mtime")) == mtime {
            return Ok(prev.clone());
        }
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Couldn't read {rel}: {e}"))?;
    let fname = path.file_name().unwrap().to_string_lossy().into_owned();
    let r = wp
        .call(
            "POST",
            "/wp/v2/media",
            "",
            Body::Bytes(bytes, posts::mime_of(&path).into()),
            &[("Content-Disposition", format!("attachment; filename=\"{fname}\""))],
        )
        .await?;
    let entry = json!({ "id": r.get("id"), "url": r.get("source_url"), "size": size, "mtime": mtime });
    if let Some(Value::Object(media)) = meta.get_mut("media") {
        media.insert(rel.into(), entry.clone());
    }
    posts::save_meta(dir, meta)?; // remember uploads even if a later step fails
    Ok(entry)
}

/// WordPress gives date_gmt as "2026-11-17T15:00:00" (UTC, no zone); store it as ISO UTC with a Z.
pub fn to_utc_iso(wp_gmt: &str) -> String {
    let s = wp_gmt.trim();
    if s.is_empty() {
        return String::new();
    }
    match chrono::NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), "%Y-%m-%dT%H:%M:%S") {
        Ok(d) => d.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        Err(_) => s.to_string(),
    }
}

/// Parse a time from the editor (ISO 8601, normally with a Z). A time without a zone is taken as UTC.
pub fn parse_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = s.trim();
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Some(d.with_timezone(&chrono::Utc));
    }
    for f in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"] {
        if let Ok(d) = chrono::NaiveDateTime::parse_from_str(s, f) {
            return Some(d.and_utc());
        }
    }
    None
}

/// Point local image paths at their uploaded copies, and drop editor-only attributes.
pub fn rewrite_content(html: &str, uploaded: &[(String, Value)]) -> String {
    let mut content = html.to_string();
    for (rel, media) in uploaded {
        let from = format!("src=\"{rel}\"");
        let to = format!(
            "src=\"{}\" class=\"wp-image-{}\"",
            str_of(media.get("url")).replace('"', "&quot;"),
            str_of(media.get("id"))
        );
        content = content.replace(&from, &to);
    }
    regex::Regex::new(r#"\s(contenteditable|data-[a-z-]+)="[^"]*""#)
        .unwrap()
        .replace_all(&content, "")
        .into_owned()
}

pub fn image_refs(html: &str) -> Vec<String> {
    let re = regex::Regex::new(r#"src="(images/[^"]+)""#).unwrap();
    let mut out: Vec<String> = Vec::new();
    for c in re.captures_iter(html) {
        let r = c[1].to_string();
        if !out.contains(&r) {
            out.push(r);
        }
    }
    out
}

/// Send a post (and its pictures) to WordPress. status: draft | publish | future | keep | pending | private.
pub async fn publish(wp: &Wp, root: &Path, id: &str, status: &str, html: &str, schedule_at: &str) -> Res<Value> {
    let dir = posts::post_dir(root, id)?;
    let mut meta = posts::load_meta(&dir);
    let title = str_of(meta.get("title"));
    if title.trim().is_empty() {
        return Err("Give the post a title before sending it to WordPress.".into());
    }
    let html = if html.is_empty() {
        posts::read_text(&dir.join("post.html")).unwrap_or_default()
    } else {
        posts::write_atomic(&dir.join("post.html"), html.as_bytes())?;
        html.to_string()
    };

    // 1. Upload every local picture the post uses
    let mut uploaded = Vec::new();
    for rel in image_refs(&html) {
        let m = ensure_media(wp, &dir, &mut meta, &rel).await?;
        uploaded.push((rel, m));
    }
    let content = rewrite_content(&html, &uploaded);

    // 2. Featured image
    let featured = str_of(meta.get("featured"));
    let featured_id = if featured.is_empty() {
        0
    } else {
        ensure_media(wp, &dir, &mut meta, &featured)
            .await?
            .get("id")
            .and_then(Value::as_i64)
            .unwrap_or(0)
    };

    // 3. Taxonomy
    let tag_ids = resolve_tag_ids(wp, &str_of(meta.get("tags"))).await?;
    let cats: Vec<i64> = meta
        .get("categories")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|c| c.as_i64().or_else(|| str_of(Some(c)).parse().ok()))
                .collect()
        })
        .unwrap_or_default();

    let prev_status = str_of(meta.get("wpStatus"));
    let mut status = status.to_string();
    if status == "keep" {
        status = if prev_status.is_empty() {
            "draft".into()
        } else {
            prev_status.clone()
        };
    }
    if !["draft", "publish", "pending", "private", "future"].contains(&status.as_str()) {
        status = "draft".into();
    }

    let mut payload = json!({
        "title": title, "content": content, "excerpt": str_of(meta.get("excerpt")), "status": status,
        "categories": cats, "tags": tag_ids, "featured_media": featured_id,
    });
    // Scheduling: WordPress holds a "future" post and publishes it itself at date_gmt
    let was_scheduled = prev_status == "future";
    let fmt = "%Y-%m-%dT%H:%M:%S";
    if status == "future" {
        let when = parse_utc(schedule_at).ok_or("Pick a date and time to schedule the post for.")?;
        if when <= chrono::Utc::now() + chrono::Duration::minutes(1) {
            return Err("The scheduled time has to be in the future.".into());
        }
        payload["date_gmt"] = json!(when.format(fmt).to_string());
    } else if status == "publish" && was_scheduled {
        // "Publish now" on a scheduled post: move its date to now, or WordPress keeps it scheduled
        payload["date_gmt"] = json!(chrono::Utc::now().format(fmt).to_string());
    } else if status == "draft" && was_scheduled {
        payload["date_gmt"] = Value::Null; // forget the old schedule
    }

    let wp_id = meta
        .get("wpId")
        .and_then(|v| v.as_i64().or_else(|| str_of(Some(v)).parse().ok()));
    let mut r = None;
    if let Some(pid) = wp_id {
        match wp.post(&format!("/wp/v2/posts/{pid}"), payload.clone()).await {
            Ok(v) => r = Some(v),
            Err(e) if matches!(e.status, Some(404 | 410)) => {} // deleted on the site: create it again
            Err(e) => return Err(e.msg),
        }
    }
    let r = match r {
        Some(v) => v,
        None => wp.post("/wp/v2/posts", payload).await?,
    };

    let new_status = str_of(r.get("status"));
    meta.insert("wpId".into(), r.get("id").cloned().unwrap_or(Value::Null));
    meta.insert("wpLink".into(), json!(str_of(r.get("link"))));
    meta.insert(
        "scheduled".into(),
        json!(if new_status == "future" {
            to_utc_iso(&str_of(r.get("date_gmt")))
        } else {
            String::new()
        }),
    );
    meta.insert("wpStatus".into(), json!(new_status));
    let now = posts::now_iso();
    meta.insert("published".into(), json!(now));
    meta.insert("modified".into(), json!(now));
    posts::save_meta(&dir, &meta)?;
    Ok(json!({ "id": id, "meta": meta }))
}

/// Scheduled posts go live on WordPress by themselves; once their time has passed,
/// ask WordPress for the real status so the post list stops saying "Scheduled".
pub async fn sync_scheduled(wp: &Wp, root: &Path) -> Res<Value> {
    let mut changed: Vec<String> = Vec::new();
    if wp.user.is_empty() || wp.pass.is_empty() {
        return Ok(json!({ "changed": changed }));
    }
    for p in posts::list_posts(root)? {
        if str_of(p.get("wpStatus")) != "future" {
            continue;
        }
        let id = str_of(p.get("id"));
        let Ok(dir) = posts::post_dir(root, &id) else { continue };
        let mut m = posts::load_meta(&dir);
        let Some(wp_id) = m
            .get("wpId")
            .and_then(|v| v.as_i64().or_else(|| str_of(Some(v)).parse().ok()))
        else {
            continue;
        };
        let due = parse_utc(&str_of(m.get("scheduled"))).map_or(true, |t| t <= chrono::Utc::now());
        if !due {
            continue;
        }
        let r = match wp.get(&format!("/wp/v2/posts/{wp_id}"), "context=edit").await {
            Ok(r) => r,
            Err(e) => {
                crate::log(&format!("sync_scheduled {id}: {}", e.msg));
                continue;
            }
        };
        let st = str_of(r.get("status"));
        if st != str_of(m.get("wpStatus")) {
            let link = str_of(r.get("link"));
            if !link.is_empty() {
                m.insert("wpLink".into(), json!(link));
            }
            m.insert(
                "scheduled".into(),
                json!(if st == "future" {
                    to_utc_iso(&str_of(r.get("date_gmt")))
                } else {
                    String::new()
                }),
            );
            m.insert("wpStatus".into(), json!(st));
            posts::save_meta(&dir, &m)?;
            changed.push(id);
        }
    }
    Ok(json!({ "changed": changed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wp(style: &str, site: &str) -> Wp {
        Wp {
            site: site.into(),
            user: "u".into(),
            pass: "p".into(),
            rest_style: style.into(),
        }
    }

    #[test]
    fn urls() {
        assert_eq!(
            wp("pretty", "myblog.com/").url("/wp/v2/tags", "a=1").unwrap(),
            "https://myblog.com/wp-json/wp/v2/tags?a=1"
        );
        assert_eq!(
            wp("query", "http://x.org").url("/wp/v2/tags", "a=1").unwrap(),
            "http://x.org/?rest_route=/wp/v2/tags&a=1"
        );
        assert_eq!(
            wp("pretty", "https://x.org").url("/wp/v2/posts", "").unwrap(),
            "https://x.org/wp-json/wp/v2/posts"
        );
        assert!(wp("pretty", "  ").url("/x", "").is_err());
    }

    #[test]
    fn content_rewrite() {
        let html = r#"<figure contenteditable="false" data-size="m"><img src="images/a.jpg" alt=""></figure><p><img src="images/a.jpg"><img src="https://x/y.png"></p>"#;
        let refs = image_refs(html);
        assert_eq!(refs, vec!["images/a.jpg"]);
        let out = rewrite_content(
            html,
            &[("images/a.jpg".into(), json!({ "id": 7, "url": "https://b.com/a.jpg" }))],
        );
        assert!(!out.contains("contenteditable"));
        assert!(!out.contains("data-size"));
        assert_eq!(out.matches(r#"src="https://b.com/a.jpg" class="wp-image-7""#).count(), 2);
        assert!(out.contains("https://x/y.png"));
    }

    #[test]
    fn times() {
        assert_eq!(to_utc_iso("2026-11-17T15:00:00"), "2026-11-17T15:00:00Z");
        assert_eq!(to_utc_iso(""), "");
        let d = parse_utc("2026-11-17T15:00:00.000Z").unwrap();
        assert_eq!(d.format("%Y-%m-%dT%H:%M:%S").to_string(), "2026-11-17T15:00:00");
        assert_eq!(parse_utc("2026-11-17T15:00:00").unwrap(), d);
        assert!(parse_utc("soon").is_none());
    }

    #[test]
    fn duplicate_tag() {
        let e = WpError {
            status: Some(400),
            msg: "x".into(),
            body: Some(json!({"code":"term_exists","data":{"status":400,"term_id":12}})),
        };
        assert_eq!(existing_term_id(&e), Some(12));
        assert_eq!(existing_term_id(&wp_err("x")), None);
    }

    #[test]
    fn decode() {
        assert_eq!(html_decode("Rock &amp; Roll &#8217;"), "Rock & Roll \u{2019}");
    }
}
