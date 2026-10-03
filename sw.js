const VERSION = 'nomera-v2-web-1';
const ASSETS = ['.', './index.html', './styles.css', './app.js', './ui.js', './core.js',
  './game-data.js', './storage.js', './feedback.js', './favicon.svg', './icon.png', './manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('nomera-v2-web-')
    && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // A fresh online page loads updated modules; a complete cached game stays playable offline.
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(VERSION).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request))
    ?? (event.request.mode === 'navigate' ? await caches.match('./index.html') : Response.error())));
});
