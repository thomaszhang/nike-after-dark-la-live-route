"use strict";

const CACHE = "nike-la-route-v42";
const SHELL = [
  "./",
  "index.html",
  "styles.css?v=25",
  "app.js?v=38",
  "course-elevation.js?v=1",
  "heading-smoothing.js?v=1",
  "route-data.js?v=2",
  "leaflet.css?v=1.9.4",
  "leaflet.js?v=1.9.4",
  "marker-icon.png",
  "marker-icon-2x.png",
  "marker-shadow.png",
  "manifest.webmanifest",
  "icon.svg",
  "icon-180.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        const copy = response.clone();
        if (new URL(event.request.url).origin === location.origin) {
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      }))
      .catch(error => {
        if (event.request.mode === "navigate") return caches.match("./");
        throw error;
      }),
  );
});
