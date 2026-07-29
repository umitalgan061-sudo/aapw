// ══ WESTEROS SERVICE WORKER v3 — iOS VIDEO FIX ══
// Video (mp4): SW BYPASS — iOS Safari Range request için direkt ağa git
// Resimler: cache-first
// Diğer: network-first

const SW_VERSION = 'westeros-media-v3';
const MEDIA_CACHE = 'westeros-media-v3';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg'];

function isVideoRequest(url) {
    return VIDEO_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));
}

function isImageRequest(url) {
    return IMAGE_EXTENSIONS.some(ext => url.pathname.toLowerCase().endsWith(ext));
}

function isFirebaseRequest(url) {
    return url.hostname.includes('firestore.googleapis.com') ||
           url.hostname.includes('firebaseio.com') ||
           url.hostname.includes('firebase.googleapis.com') ||
           url.hostname.includes('googleapis.com');
}

// ── INSTALL ──
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// ── ACTIVATE ──
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== MEDIA_CACHE)
                    .map(key => {
                        return caches.delete(key);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// ── FETCH ──
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Firebase: bypass
    if (isFirebaseRequest(url)) return;

    // *** VIDEO: tamamen bypass — iOS Safari Range request için SW'den geçirme ***
    if (isVideoRequest(url)) {
        return; // SW hiçbir şey yapmaz, tarayıcı direkt ağa gider
    }

    // Resimler: cache-first
    if (isImageRequest(url)) {
        event.respondWith(
            caches.open(MEDIA_CACHE).then(cache => {
                return cache.match(event.request).then(cached => {
                    if (cached) {
                        return cached;
                    }
                    return fetch(event.request).then(response => {
                        if (response && response.status === 200) {
                            cache.put(event.request, response.clone()).catch(() => {});
                        }
                        return response;
                    }).catch(() => new Response('', { status: 503 }));
                });
            })
        );
        return;
    }

    // Diğer: network-first
    event.respondWith(
        fetch(event.request, { cache: 'no-store' }).catch(() => {
            if (event.request.destination === 'document') {
                return new Response(
                    '<html><body style="background:#06040a;color:#c8960a;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:18px;">İnternet bağlantısı yok</body></html>',
                    { headers: { 'Content-Type': 'text/html' } }
                );
            }
        })
    );
});

// ── PUSH ──
self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    event.waitUntil(self.registration.showNotification(
        data.title || 'Westeros',
        { body: data.body || 'Yeni bir olay gerçekleşti', icon: data.icon || 'logo.png', tag: data.tag || 'westeros-notification' }
    ));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(list => {
            for (const c of list) { if ('focus' in c) return c.focus(); }
            if (clients.openWindow) return clients.openWindow('./');
        })
    );
});