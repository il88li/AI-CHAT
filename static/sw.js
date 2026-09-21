/* ═══════════════════════════════════════════════════════════
   خَيال — Service Worker v7.2
   مسؤوليات محدودة: cache للأصول الثابتة فقط، لا API
   ═══════════════════════════════════════════════════════════ */
const CACHE = 'khayal-v7-2';
const STATIC_ASSETS = [
  '/static/style.css?v=8',
  '/static/app.js?v=8.0.0',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] skip', url, err))
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // ⛔ لا تلمس الـ API أبداً — دع المتصفح يتعامل معه مباشرة
  if (url.pathname.startsWith('/api/')) return;

  // ⛔ لا تلمس الطلبات غير GET
  if (req.method !== 'GET') return;

  // ⛔ لا تلمس النطاقات الخارجية
  if (url.origin !== self.location.origin) return;

  // ✅ فقط الأصول الثابتة: cache-first
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // كل شيء آخر: network-first
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (req.mode === 'navigate' && res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || Response.error()))
  );
});