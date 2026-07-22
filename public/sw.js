const CACHE_PREFIX = 'tuat-tf-';
const OFFLINE_CACHE = 'tuat-tf-public-offline-v1';
const OFFLINE_ASSETS = ['/offline', '/branding/summer-icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== OFFLINE_CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

// Never cache authenticated HTML, RSC payloads, or API responses.
// For failed navigations, serve only the public offline explanation page.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(async () =>
      (await caches.match('/offline')) || Response.error(),
    ),
  );
});
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/branding/summer-icon-192.png',
      data: data.data || {},
    };
    event.waitUntil(self.registration.showNotification(data.title || '新しい通知', options));
  } catch {
    event.waitUntil(self.registration.showNotification(event.data.text()));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});