const RUN205_CACHE = 'westeros-canonical-dev-run205-v1';
const RUN205_SCOPE_PREFIX = new URL('./', self.registration.scope).pathname;
const RUN205_SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(RUN205_CACHE).then(cache => cache.addAll(RUN205_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(RUN205_SCOPE_PREFIX)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
