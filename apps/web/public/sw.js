/* FR-18 — the service worker that shows a web push notification.
 *
 * Deliberately tiny: it renders what the server sent and focuses the event
 * when tapped. Anything cleverer here is code that runs outside the app's
 * lifecycle and is very hard to debug.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Where Are They', {
      body: payload.body || '',
      tag: payload.data && payload.data.kind ? payload.data.kind : 'wat',
      // Collapse repeats of the same kind rather than stacking them up.
      renotify: false,
      data: payload.data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
