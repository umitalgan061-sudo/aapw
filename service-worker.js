// ══ WESTEROS SERVICE WORKER v4 — iOS VIDEO FIX + OFFLINE APP SHELL ══
// Video (mp4): SW BYPASS — iOS Safari Range request için direkt ağa git
// Resimler: cache-first
// App shell (html/css/js/manifest): network-first, offline'da cache'e düş
// Diğer: network-first

const SW_VERSION = 'westeros-media-v3';
const MEDIA_CACHE = 'westeros-media-v3';
const SHELL_CACHE = 'westeros-shell-v1';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css',
    './ios-pwa-fix.css',
    './script.js',
    './manifest.json',
    './logo.png'
];

// 3D mode's own app shell — precached separately (own cache.addAll call, own catch) so a failure
// here can never block the 2D shell above from installing. Only currently-loaded-by-code files:
// no character/creature model/animation assets (those aren't fetched by any code until FAZ 4/6/7).
const GAME3D_SHELL_FILES = [
    './game3d.html',
    './game3d.css',
    './src/3d/game3d.js',
    './src/3d/eventBus.js',
    './src/3d/state.js',
    './src/3d/assetLoader.js',
    './src/3d/config.js',
    './src/3d/camera.js',
    './src/3d/sky.js',
    './src/3d/world/terrain.js',
    './src/3d/world/chunkManager.js',
    './src/3d/vendor/three/three.module.js',
    './src/3d/vendor/three/LICENSE',
    './src/3d/vendor/three/addons/loaders/GLTFLoader.js',
    './src/3d/vendor/three/addons/utils/BufferGeometryUtils.js',
    './src/3d/vendor/three/addons/controls/OrbitControls.js'
];

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
    event.waitUntil(
        Promise.all([
            caches.open(SHELL_CACHE)
                .then(cache => cache.addAll(SHELL_FILES))
                .catch(() => {}), // offline ilk kurulum: sessizce geç, sonraki ziyaretlerde tamamlanır
            // Ayrı addAll + ayrı catch: 3D shell'in önbelleğe alınması başarısız olsa bile (örn. bir
            // dosya geçici olarak erişilemez), yukarıdaki kritik 2D shell kurulumunu asla engellemez.
            caches.open(SHELL_CACHE)
                .then(cache => cache.addAll(GAME3D_SHELL_FILES))
                .catch(() => {}),
        ])
    );
    self.skipWaiting();
});

// ── MESSAGE (index.html: reg.waiting.postMessage({type:'SKIP_WAITING'})) ──
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ── ACTIVATE ──
self.addEventListener('activate', (event) => {
    const KEEP = [MEDIA_CACHE, SHELL_CACHE];
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => !KEEP.includes(key))
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

    // Diğer (app shell dahil): network-first, başarısız olursa shell cache'e düş
    const isSameOrigin = url.origin === self.location.origin;
    event.respondWith(
        fetch(event.request, { cache: 'no-store' }).then(response => {
            if (isSameOrigin && response && response.status === 200 && event.request.method === 'GET') {
                const clone = response.clone();
                caches.open(SHELL_CACHE).then(cache => cache.put(event.request, clone)).catch(() => {});
            }
            return response;
        }).catch(() => {
            return caches.match(event.request).then(cached => {
                if (cached) return cached;
                if (event.request.destination === 'document') {
                    return caches.match('./index.html').then(shellDoc => shellDoc || new Response(
                        '<html><body style="background:#06040a;color:#c8960a;font-family:serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:18px;">İnternet bağlantısı yok</body></html>',
                        { headers: { 'Content-Type': 'text/html' } }
                    ));
                }
            });
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