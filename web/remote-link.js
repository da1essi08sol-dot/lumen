// Lumen Web's phone remote: the same remote as the laptop's (public/remote/remote.js), but instead of the laptop's
// WebSocket and /api/ address it reaches the TV page straight over WebRTC (see relay.js on the TV side). Loaded as
// a plain script before remote.js; it stands in for fetch('/api/…') and for remote.js's WebSocket.
(() => {
  window.LUMEN_REMOTE_WEB = true;
  const q = new URLSearchParams(location.search);
  try { if (q.get('tv')) localStorage.setItem('lumen.tv', q.get('tv')); } catch {}
  const tvId = () => { try { return localStorage.getItem('lumen.tv'); } catch { return null; } };
  const peerOpts = () => { try { return { debug: 0, ...(JSON.parse(localStorage.getItem('lumen.peer')) || {}) }; } catch { return { debug: 0 }; } };
  let peer = null, conn = null, ready = null, failNow = null, sock = null, rid = 0;
  const waiting = new Map();

  function drop() {
    const c = conn; conn = null; ready = null;
    try { c?.close(); } catch {}
    for (const w of waiting.values()) w.reject(new Error('Lost the TV'));
    waiting.clear();
    sock?._closed();
  }
  function link() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      if (!tvId()) { ready = null; return reject(new Error('Scan the code on the TV with this phone’s Camera first.')); }
      if (!window.Peer) { ready = null; return reject(new Error('The remote could not load. Check this phone’s internet.')); }
      const timer = setTimeout(() => failNow?.(new Error('Can’t reach the TV. Is Lumen open on the phone that’s showing it, with its screen on?')), 15000);
      failNow = (e) => { clearTimeout(timer); failNow = null; drop(); reject(e); };
      const go = () => {
        const c = peer.connect(tvId(), { serialization: 'json', reliable: true });
        conn = c;
        c.on('open', () => { clearTimeout(timer); failNow = null; resolve(c); });
        c.on('data', onData);
        c.on('close', () => { if (conn === c) drop(); });
        c.on('error', () => { if (conn === c) (failNow ? failNow(new Error('Can’t reach the TV.')) : drop()); });
      };
      if (!peer || peer.destroyed) {
        peer = new window.Peer(undefined, peerOpts());
        peer.on('error', (e) => { const f = failNow; if (f) f(new Error(e.type === 'peer-unavailable' ? 'Can’t find the TV. Is Lumen open on the phone that’s showing it?' : 'Can’t reach the TV. Check this phone’s internet.')); if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { try { peer.destroy(); } catch {} } });
        peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch {} });
      }
      if (peer.open) go(); else peer.once('open', go);
    });
    return ready;
  }
  function onData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.rid != null) { const w = waiting.get(d.rid); if (w) { waiting.delete(d.rid); w.resolve(d); } return; }
    if (!sock) return;
    if (d.t === 'ws-open') { sock.readyState = 1; sock.onopen?.({}); return; }
    if (d.t === 'ws-denied') { sock._closed(); return; }
    sock.onmessage?.({ data: JSON.stringify(d) });
  }

  // fetch('/api/…') → the TV page
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const path = typeof input === 'string' ? input : input.url;
    if (!/^\/api\//.test(path)) return realFetch(input, init);
    const headers = init.headers || {}, token = headers['x-lumen-token'] || '';
    let body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = undefined; } }
    else if (init.body) return new Response(JSON.stringify({ error: 'Pictures can’t be sent to Lumen Web.' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const json = (status, data) => new Response(data == null ? 'null' : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    let c; try { c = await link(); } catch (e) { return json(503, { error: e.message }); }
    const id = ++rid;
    const reply = await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try { c.send({ rid: id, api: path, method: init.method || 'GET', body, token }); } catch (e) { waiting.delete(id); reject(e); }
      setTimeout(() => { if (waiting.delete(id)) reject(new Error('The TV didn’t answer.')); }, 20000);
    }).catch((e) => ({ status: 503, data: { error: e.message } }));
    return json(reply.status, reply.data);
  };

  // new WebSocket('ws://…/ws?t=token') → the same connection
  class LinkSocket {
    constructor(url) {
      this.readyState = 0; this.onopen = this.onmessage = this.onclose = this.onerror = null;
      const token = new URL(url, location.href).searchParams.get('t') || '';
      if (sock && sock !== this) sock._closed();
      sock = this;
      link().then((c) => { if (sock === this) c.send({ t: 'ws', token }); }).catch(() => this._closed());
    }
    send(s) { if (this.readyState === 1 && conn) conn.send(typeof s === 'string' ? JSON.parse(s) : s); }
    close() { this._closed(); }
    _closed() { if (this.readyState === 3) return; this.readyState = 3; if (sock === this) sock = null; this.onclose?.({}); }
  }
  window.LumenLinkSocket = LinkSocket; // remote.js uses this in place of WebSocket (PeerJS still needs the real one)
})();
