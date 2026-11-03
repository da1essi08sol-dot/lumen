// Lets Lumen Web open instantly and work as an installed app. App files are cached; film data always comes live from TMDB.
const CACHE = 'lumen-web-__VERSION__';
const FILES = ['./', 'index.html', 'phone.js', 'phone.css', 'backend.js', 'tmdb.js', 'shared/icons.js', 'shared/theme-phone.css', 'shared/fonts.css', 'shared/fonts/bricolage.ttf', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // newest version when online, saved copy when not
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
