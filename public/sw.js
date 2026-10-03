const CACHE_NAME = 'newgenev-shell-v4';
const SHELL_FILES = ['/style.css', '/fx.css', '/fx.js', '/app.js', '/control.html', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first: always try live data/pages first (this app is real-time),
// only fall back to the cached shell if the network is unreachable.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
