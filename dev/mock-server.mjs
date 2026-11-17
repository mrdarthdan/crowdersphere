// Runs the editor UI in a normal browser against a stand-in back end, for development and tests.
//   node dev/mock-server.mjs [postsDir] [port]
// Posts are real folders in postsDir (same format as the app). WordPress calls are not available.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'ui');
const postsDir = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cs-posts-')));
const port = +(process.argv[3] || 47999);
const TOKEN = 'dev';
fs.mkdirSync(postsDir, { recursive: true });
let settings = { siteUrl: '', username: '', hasPassword: false, postsDir, maxImageWidth: 1920, version: 'dev', prefs: {} };

const safe = n => /^[A-Za-z0-9._-]+$/.test(n || '') && !/^\.+$/.test(n);
const now = () => new Date().toISOString().slice(0, 19);
const meta = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'post.json'), 'utf8')); } catch { return {}; } };
const slug = t => (t || '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'untitled';
const MIME = { '.js': 'application/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.html': 'text/html' };

function body(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }
function send(res, code, data, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), q = u.searchParams, p = u.pathname;
  try {
    if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(path.join(UI, 'index.html'), 'utf8').replace('__API_TOKEN__', TOKEN), 'text/html');
    if (/^\/((vendor\/)?[a-z0-9-]+\.(js|ico))$/.test(p)) return send(res, 200, fs.readFileSync(path.join(UI, p)), MIME[path.extname(p)]);
    if (p.startsWith('/files/')) {
      const [id, d, f] = p.slice(7).split('/').map(decodeURIComponent);
      if (!safe(id) || d !== 'images' || !safe(f)) return send(res, 404, '', 'text/plain');
      return send(res, 200, fs.readFileSync(path.join(postsDir, id, 'images', f)), MIME[path.extname(f)] || 'application/octet-stream');
    }
    // a stand-in for a picture on another website (no CORS headers), for the Word export test
    if (p === '/remote.png') return send(res, 200, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'), 'image/png');
    if (!p.startsWith('/api/')) return send(res, 404, 'Not found', 'text/plain');
    switch (p) {
      case '/api/heartbeat': case '/api/bye': return send(res, 200, { ok: true });
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
          if (!id) { id = new Date().toISOString().slice(0, 10) + '-' + slug(b.meta && b.meta.title); fs.mkdirSync(path.join(postsDir, id, 'images'), { recursive: true }); }
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
      case '/api/categories': return send(res, 200, req.method === 'POST' ? { id: 99, name: 'New', parent: 0 } : { categories: [] });
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
