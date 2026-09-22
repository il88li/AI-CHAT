/* ═══════════════════════════════════════════════════════════
   خَيال — Service Worker v14.3
   مسؤوليات محدودة: cache للأصول الثابتة فقط، لا API
   ═══════════════════════════════════════════════════════════ */
const CACHE = 'khayal-v14-3';
const STATIC_ASSETS = [
  '/static/css/01-tokens.css?v=14.3',
  '/static/css/02-base.css?v=14.3',
  '/static/css/03-components.css?v=14.3',
  '/static/css/04-views.css?v=14.3',
  '/static/css/05-responsive.css?v=14.3',
  '/static/app.js?v=14.3',
  '/static/sounds.js?v=14.3',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/icon-maskable-192.png',
  '/static/icon-maskable-512.png',
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
        }).catch(() => cached || Response.error());
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