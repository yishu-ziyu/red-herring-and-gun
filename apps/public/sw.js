/*
 * Self-unregistering service worker. The offline cache was removed (#139).
 * Browsers that installed the old worker still check this URL for updates; this version
 * deletes every cache it owns and unregisters itself. It does not reload open pages:
 * the next normal page load goes straight to the network.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
  );
});
