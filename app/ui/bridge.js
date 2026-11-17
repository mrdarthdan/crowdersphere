/* CrowderSphere bridge: lets the editor talk to whichever back end it is running on.
 *
 *  - Desktop app (Tauri): calls the Rust commands in src-tauri through Tauri's IPC, and loads
 *    pictures through the private csfiles: protocol.
 *  - Original PowerShell version: calls the local web server at /api/... as before.
 *
 * The editor only uses CS.api(), CS.fileUrl(), CS.relFromUrl() and CS.onCloseRequested(),
 * so it doesn't need to know which one it is on.
 */
(function () {
  "use strict";
  const T = window.__TAURI__;
  const tauri = !!(T && T.core && T.core.invoke);

  // Tauri serves custom protocols as http://<scheme>.localhost/ on Windows and <scheme>://localhost/ elsewhere
  const filesRoot = !tauri ? '/files/' : (/Windows/i.test(navigator.userAgent) ? 'http://csfiles.localhost/' : 'csfiles://localhost/');

  function fileUrl(postId, rel) { return filesRoot + encodeURIComponent(postId) + '/' + rel; }
  function filesBase(postId) { return (tauri ? filesRoot : location.origin + filesRoot) + encodeURIComponent(postId || '_') + '/'; }

  // Turn a displayed picture address back into the post-relative path stored in post.html ("images/x.jpg")
  function relFromUrl(src) {
    if (!src) return null;
    if (src.startsWith(filesRoot)) {
      const m = src.slice(filesRoot.length).match(/^[^/]+\/(images\/[^?#]+)$/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    const m = src.match(/^\/files\/[^/]+\/(images\/[^?#]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function bytesOf(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (body && typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
    return new Uint8Array(0);
  }

  // Map the editor's original /api/... calls onto Tauri commands
  async function tauriApi(path, opts) {
    const invoke = T.core.invoke;
    const url = new URL(path, 'http://app.invalid');
    const q = url.searchParams;
    const json = opts.json;
    const raw = async (cmd) => invoke(cmd, await bytesOf(opts.body), {
      headers: { 'x-id': encodeURIComponent(q.get('id') || ''), 'x-name': encodeURIComponent(q.get('name') || '') }
    });
    switch (url.pathname) {
      case '/api/settings':       return json !== undefined ? invoke('save_settings', { body: json }) : invoke('get_settings');
      case '/api/test':           return invoke('test_connection');
      case '/api/posts':          return invoke('list_posts');
      case '/api/post':           return json !== undefined ? invoke('save_post', { body: json }) : invoke('get_post', { id: q.get('id') || '' });
      case '/api/delete':         return invoke('delete_post', { id: q.get('id') || '' });
      case '/api/image':          return raw('save_image');
      case '/api/export':         return raw('export_docx');
      case '/api/openfile':       return invoke('open_export', { id: q.get('id') || '', name: q.get('name') || '' });
      case '/api/categories':     return json !== undefined ? invoke('add_category', { name: String(json.name || '') }) : invoke('get_categories');
      case '/api/publish':        return invoke('publish', { body: json || {} });
      case '/api/sync-scheduled': return invoke('sync_scheduled');
      case '/api/open':           return invoke('open_folder', { id: q.get('id') || null });
      case '/api/browse':         return invoke('browse_folder', { start: q.get('start') || null });
      case '/api/openurl':        return invoke('open_url', { url: q.get('url') || '' });
      case '/api/heartbeat':
      case '/api/bye':            return { ok: true };   // only the PowerShell version needs these
      default: throw new Error('Unknown API call ' + url.pathname);
    }
  }

  async function api(path, opts = {}) {
    try { return (await tauriApi(path, opts)) || {}; }
    catch (e) { throw (e instanceof Error ? e : new Error(String(e))); }
  }

  // Desktop app: the window asks the editor to save before it closes
  function onCloseRequested(save) {
    if (!tauri || !T.event) return;
    T.event.listen('cs-close-requested', async () => {
      try { await save(); } catch (e) {}
      try { await T.core.invoke('quit'); } catch (e) {}
    });
  }

  window.CS = { tauri, api, fileUrl, filesBase, relFromUrl, onCloseRequested };
})();
