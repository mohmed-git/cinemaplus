/*
 * Self-unregistering service worker.
 *
 * A previous build shipped a third-party ad-network service worker here
 * (it imported an external script and intercepted every fetch on the site).
 * That kind of worker can serve different responses to crawlers vs. users,
 * which search engines treat as cloaking and which can suppress indexing.
 *
 * This replacement does the opposite of the old one: it takes control, then
 * immediately unregisters itself and clears any caches it created, so any
 * browser that still has the old worker installed is cleaned up on next visit.
 * The site itself does NOT register this worker anywhere.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) {}
      try {
        await self.registration.unregister();
      } catch (_) {}
      try {
        const clients = await self.clients.matchAll();
        clients.forEach((client) => client.navigate(client.url));
      } catch (_) {}
    })()
  );
});

// Never intercept network requests — always let them hit the network directly.
