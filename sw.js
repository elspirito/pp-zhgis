/* ============================================================
   Service worker ПП-каталога рецептов
   Стратегии:
   - навигация: сеть → кэш → офлайн-страница
   - css/js/данные: stale-while-revalidate
   - фотографии блюд: cache-first с ограничением объёма
   ============================================================ */

const VERSION = 'v1';
const SHELL_CACHE = `pp-shell-${VERSION}`;
const IMG_CACHE = `pp-images-${VERSION}`;
const MAX_IMAGES = 220;

const SHELL = [
  './',
  './index.html',
  './offline.html',
  './assets/style.css',
  './assets/app.js',
  './data/recipes.js',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // кэшируем по одному: один недоступный файл не должен ломать установку
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== IMG_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'CLEAR_IMAGES') {
    event.waitUntil(caches.delete(IMG_CACHE));
  }
});

async function trimImages() {
  const cache = await caches.open(IMG_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_IMAGES) return;
  const excess = keys.length - MAX_IMAGES;
  for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response('Нет сети', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      trimImages();
    }
    return response;
  } catch (e) {
    const shell = await caches.open(SHELL_CACHE);
    const placeholder = await shell.match('./assets/icons/icon-192.png');
    return placeholder || new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if (url.pathname.includes('/assets/img/')) {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  if (/\.(css|js|webmanifest|png|jpg|jpeg|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
