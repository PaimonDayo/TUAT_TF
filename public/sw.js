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

// 既に開いているウィンドウ（インストール済みPWA含む）を探して前面に出し、そこで遷移する。
// openWindow だけだとタップのたびにアプリがもう1枚開いてしまう。
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/notices';
  event.waitUntil((async () => {
    const target = new URL(raw, self.location.origin);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== target.origin) continue;
      try {
        if ('navigate' in client) {
          const navigated = await client.navigate(target.href);
          if (navigated && 'focus' in navigated) {
            await navigated.focus();
            return;
          }
        }
        await client.focus();
        return;
      } catch {
        // WindowClient.navigate() が未実装・拒否される環境（一部のiOS）向けの保険。
        try {
          await client.focus();
          return;
        } catch {
          // このウィンドウは使えないので次の候補へ。
        }
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

// ブラウザの都合で購読が作り直された（endpointが変わった）ときに、
// 新しい購読でサーバーへ登録し直す。これを受け取り損ねると、その端末は
// 見た目は通知オンのまま二度と配信されない。
// iOSでは発火しないことがあるので、本体はアプリ側の PushSubscriptionSync が担う保険。
function swUrlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      let subscription = event.newSubscription || null;
      if (!subscription) {
        const res = await fetch('/api/push/vapid', { cache: 'no-store' });
        if (!res.ok) return;
        const { key } = await res.json();
        if (!key) return;
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: swUrlBase64ToUint8Array(key),
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth) return;
      await fetch('/api/push/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
    } catch {
      // 未ログイン・通信不調などはここでは直せない。次にアプリを開いたときに直る。
    }
  })());
});