self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: '/icon.png',
      data: data.data || {}
    };
    event.waitUntil(self.registration.showNotification(data.title || '新しい通知', options));
  } catch (e) {
    // text fallback
    event.waitUntil(self.registration.showNotification(event.data.text()));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
