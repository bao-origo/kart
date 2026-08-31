// Offline shell for the map. Everything is relative, so the same file works from
// a GitHub Pages project subpath as from the domain root.
//
// Bump CACHE when the shell changes; the old cache is dropped on activate.
const CACHE = 'kart-v2';

// The shell only. The plan PNGs are ~500 kB each and there are six of them, so
// they are cached as they are opened instead of on install — every floor you have
// looked at once stays available offline.
const SHELL = ['./', 'index.html', 'rooms.json', 'names.json', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Stale-while-revalidate: answer from the cache when there is something there, so
// the map opens instantly and offline, and refresh it in the background for the
// next load.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(response => {
      if (response.ok) cache.put(e.request, response.clone());
      return response;
    // Offline: fall back to whatever is cached. Nothing cached either, so the
    // request genuinely fails — without this the background refresh would also
    // reject unhandled on every offline load.
    }).catch(() => cached || Response.error());
    return cached || fresh;
  }));
});
