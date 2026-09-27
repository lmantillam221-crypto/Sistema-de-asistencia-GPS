/* Service worker: la app abre al instante y funciona con mala señal. La API nunca se guarda en caché. */
const VERSION = 'nc-v2.2.0';
const BASE = ['/', '/index.html', '/css/app.css', '/css/movil.css', '/css/marca.css', '/assets/logo.webp', '/assets/icon-192.png', '/manifest.webmanifest',
  '/js/colaborador/main.js', '/js/colaborador/gps.js', '/js/core/api.js', '/js/core/ui.js', '/js/core/util.js', '/shared/tiempo.js', '/shared/geo.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/panel')) return;
  // Red primero (siempre la versión más nueva); si no hay internet, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
