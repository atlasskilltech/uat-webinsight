// Minimal service worker for the Live domain monitor's down-alerts.
//
// It exists so the page can show OS-level notifications via
// registration.showNotification(), which is the only way to show a
// notification on Android (new Notification() is unsupported there). We do NOT
// receive server pushes here — notifications are triggered from the dashboard
// page while it is open. Clicking a notification focuses/opens the dashboard.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = "/operations";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Focus an already-open dashboard tab if we have one.
        if (client.url.includes("/operations") && "focus" in client) return client.focus();
      }
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(target);
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
