const CACHE_NAME = '25x5-cache-v3'; // Увеличьте версию, чтобы старый кэш сбросился
const urlsToCache = [
  '/',
  '/static/css/style.css',
  '/static/js/script.js',
  '/static/favicon.svg',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.error('Cache addAll failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Игнорируем запросы от расширений браузера
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Игнорируем POST/PUT/DELETE запросы (Cache API поддерживает только GET)
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response; // Возвращаем из кэша, если найдено
        }

        // Иначе идем в сеть и кэшируем результат
        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
      })
  );
});