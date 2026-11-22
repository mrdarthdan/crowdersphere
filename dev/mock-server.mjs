// Runs the editor UI in a normal browser against a stand-in back end, for development and tests.
//   node dev/mock-server.mjs [postsDir] [port]
// Posts are real folders in postsDir (same format as the app). WordPress calls are not available.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui');
const postsDir = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cs-posts-')));
const port = +(process.argv[3] || 47999);
fs.mkdirSync(postsDir, { recursive: true });
let settings = { siteUrl: '', username: '', hasPassword: false, postsDir, maxImageWidth: 1920, version: 'dev', prefs: {} };

const safe = n => /^[A-Za-z0-9._-]+$/.test(n || '') && !/^\.+$/.test(n);
const now = () => new Date().toISOString().slice(0, 19);
const meta = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf8')); } catch { return {}; } };
const slug = t => (t || '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'untitled';
const MIME = { '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.html': 'text/html', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

function body(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }
function send(res, code, data, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = u.searchParams, p = u.pathname;
  try {
    if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(UI, 'index.html'), 'utf8'), 'text/html');
    if (/^\/((vendor\/)?[a-z0-9-]+\.(js|ico))$/.test(p)) return send(res, 200, fs.readFileSync(path.join(UI, p)), MIME[path.extname(p)]);
    if (p.startsWith('/files/')) {
      const [id, d, f] = p.slice(7).split('/').map(decodeURIComponent);
      if (!safe(id) || !['images', 'videos'].includes(d) || !safe(f) || f.startsWith('.')) return send(res, 404, '', 'text/plain');
      const file = path.join(postsDir, id, d, f), type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
      const m = /^bytes=(\d*)-(\d*)/.exec(req.headers.range || ''), size = fs.statSync(file).size;
      if (!m) return send(res, 200, fs.readFileSync(file), type);
      // videos are asked for a piece at a time, like the app's csfiles: protocol
      const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    // a stand-in for a picture on another website (no CORS headers), for the Word export test
    if (p === '/remote.png') return send(res, 200, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'), 'image/png');
    if (!p.startsWith('/api/')) return send(res, 404, 'Not found', 'text/plain');
    switch (p) {
      case '/api/settings':
        if (req.method === 'POST') Object.assign(settings, JSON.parse((await body(req)).toString() || '{}'));
        return send(res, 200, settings);
      case '/api/posts': {
        const posts = fs.readdirSync(postsDir).filter(n => safe(n) && fs.existsSync(path.join(postsDir, n, 'post.json')))
          .map(id => ({ id, ...meta(path.join(postsDir, id)) })).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
        return send(res, 200, { posts, postsDir });
      }
      case '/api/post': {
        if (req.method === 'POST') {
          const b = JSON.parse((await body(req)).toString());
          let id = b.id;
          if (!id) {
            const base = new Date().toISOString().slice(0, 10) + '-' + slug(b.meta && b.meta.title);
            id = base; for (let n = 2; fs.existsSync(path.join(postsDir, id)); n++) id = `${base}-${n}`;   // like the app
            fs.mkdirSync(path.join(postsDir, id, 'images'), { recursive: true });
          }
          const dir = path.join(postsDir, id);
          const m = Object.assign({ categories: [], media: {}, created: now() }, meta(dir), b.meta || {}, { modified: now() });
          if ('html' in b) fs.writeFileSync(path.join(dir, 'post.html'), b.html || '');
          fs.writeFileSync(path.join(dir, 'post.json'), JSON.stringify(m, null, 2));
          return send(res, 200, { id, meta: m });
        }
        const id = q.get('id'); if (!safe(id)) return send(res, 400, { error: 'Bad post id' });
        const dir = path.join(postsDir, id);
        const html = fs.existsSync(path.join(dir, 'post.html')) ? fs.readFileSync(path.join(dir, 'post.html'), 'utf8') : '';
        return send(res, 200, { id, meta: meta(dir), html });
      }
      case '/api/image': {
        const id = q.get('id'), name = (q.get('name') || 'image.png').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
        const dir = path.join(postsDir, id, 'images'); fs.mkdirSync(dir, { recursive: true });
        let f = name, n = 2; while (fs.existsSync(path.join(dir, f))) f = name.replace(/(\.[^.]+)$/, `-${n++}$1`);
        fs.writeFileSync(path.join(dir, f), await body(req));
        return send(res, 200, { src: 'images/' + f });
      }
      // a video arrives in pieces, like the app (see save_video_chunk in posts.rs)
      case '/api/video-chunk': {
        const id = q.get('id'), name = (q.get('name') || 'video.mp4').toLowerCase().replace(/[^a-z0-9._-]+/g, '-'), up = q.get('upload') || '';
        if (!safe(id) || !/^[A-Za-z0-9]{8,64}$/.test(up) || !/\.(mp4|m4v|mov|webm)$/.test(name)) return send(res, 400, { error: 'Unsupported video type. Use MP4, MOV, M4V or WebM videos.' });
        const dir = path.join(postsDir, id, 'videos'); fs.mkdirSync(dir, { recursive: true });
        const part = path.join(dir, `.adding-${up}.part`), offset = +q.get('offset') || 0, data = await body(req);
        if (offset === 0) fs.writeFileSync(part, data);
        else if (!fs.existsSync(part) || fs.statSync(part).size !== offset) return send(res, 400, { error: 'The video was interrupted while it was being added. Please add it again.' });
        else fs.appendFileSync(part, data);
        if (q.get('last') !== '1') return send(res, 200, {});
        let f = name, n = 2; while (fs.existsSync(path.join(dir, f))) f = name.replace(/(\.[^.]+)$/, `-${n++}$1`);
        fs.renameSync(part, path.join(dir, f));
        return send(res, 200, { src: 'videos/' + f });
      }
      case '/api/video-discard': {
        const id = q.get('id'), up = q.get('upload') || '';
        if (safe(id) && /^[A-Za-z0-9]{8,64}$/.test(up)) fs.rmSync(path.join(postsDir, id, 'videos', `.adding-${up}.part`), { force: true });
        return send(res, 200, { ok: true });
      }
      // a connected site has a few example categories (for screenshots); otherwise none
      case '/api/categories': return send(res, 200, req.method === 'POST' ? { id: 99, name: 'New', parent: 0 }
        : { categories: settings.siteUrl ? ['Desert', 'Hiking', 'Photography', 'Travel'].map((name, i) => ({ id: i + 1, name, parent: 0 })) : [] });
      case '/api/sync-scheduled': return send(res, 200, { changed: [] });
      case '/api/remote-image': {
        const r = await fetch(q.get('url'));
        if (!r.ok) return send(res, 502, { error: 'HTTP ' + r.status });
        return send(res, 200, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || 'application/octet-stream');
      }
      default: return send(res, 400, { error: 'Not available in the mock server: ' + p });
    }
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(port, () => console.log(`CrowderSphere UI on http://localhost:${port}/  (posts in ${postsDir})`));
