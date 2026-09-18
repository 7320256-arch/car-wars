const CACHE_NAME = 'car-wars-v2';
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest', './favicon.svg', './apple-touch-icon.png',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-192-maskable.png', './icons/icon-512-maskable.png',
  './css/style.css', './js/core.js', './js/math3d.js', './js/textures.js', './js/primitives.js',
  './js/renderer.js', './js/meshes.js', './js/mapdata.js', './js/world.js', './js/entities.js',
  './js/ui.js', './js/audio.js', './js/game.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
