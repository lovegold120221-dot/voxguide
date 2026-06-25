const APP_VERSION = '1.0.0';
const CACHE_NAME = 'beatrice-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-eburon.svg',
  '/sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // Always go to network for version check
  if (url.pathname === '/api/version') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const ct = response.headers.get('Content-Type') || '';
          const isCacheable =
            ct.includes('javascript') ||
            ct.includes('css') ||
            ct.includes('svg') ||
            ct.includes('image') ||
            ct.includes('font') ||
            event.request.url.includes('.js') ||
            event.request.url.includes('.css') ||
            event.request.url.includes('.svg') ||
            event.request.url.includes('.woff2') ||
            event.request.url.includes('.png') ||
            event.request.method === 'GET' &&
            (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.json');

          if (isCacheable) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => cached || caches.match('/'));
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_VERSION') {
    const clientVersion = event.data.version;
    const updateAvailable = clientVersion !== APP_VERSION;
    event.source?.postMessage({
      type: 'VERSION_RESPONSE',
      currentVersion: APP_VERSION,
      updateAvailable
    });
  }
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
