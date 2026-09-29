// Family Hub service worker: shows notifications, even when the app is closed.
// It doesn't cache anything, so updates you upload show up as usual.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(n.title || 'Family Hub', {
    body: n.body || '',
    tag: n.tag || undefined,
    renotify: !!n.tag,
    icon: 'icons/icon-192.png',
    data: { url: n.url || '#/home' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#/home';
  const target = new URL(hash, self.registration.scope).href;
  e.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find(w => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      open.postMessage({ go: hash });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
