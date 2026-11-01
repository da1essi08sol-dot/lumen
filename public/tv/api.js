// Data access for the TV page. All TMDB traffic goes through the local server.
export const cfg = { imageBase: 'https://image.tmdb.org/t/p' };

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(path, init); }
  catch { throw Object.assign(new Error('The TV server is not responding. Is Lumen still running on this computer?'), { status: 0 }); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { status: res.status });
  return data;
}

export const img = (p, size = 'w342') => (p ? `${cfg.imageBase}/${size}${p}` : null);

// Small TTL cache for section data so tab switching is instant.
const cache = new Map();
export async function cached(key, fn, ttl = 10 * 60e3) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
export const peek = (key) => cache.get(key)?.v;
export const invalidate = (prefix = '') => { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };

// WebSocket to the server with automatic reconnection.
export function connect(onMessage, onStatus) {
  let ws, delay = 800, alive = false;
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws?role=tv`);
    ws.onopen = () => { delay = 800; alive = true; onStatus?.(true); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => { if (alive) onStatus?.(false); alive = false; setTimeout(open, delay); delay = Math.min(delay * 1.6, 6000); };
    ws.onerror = () => ws.close();
  };
  open();
  return { send: (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); } };
}
