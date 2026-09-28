/* global self, caches, fetch, Request, Response */

// The service worker: a script the browser keeps running in the background
// for this site, and the piece that turns the website into an installable app
// (a Progressive Web App) alongside manifest.webmanifest.
//
// It deliberately does ONE thing: when there is no connection, a page load
// gets a Hebrew "no connection" page instead of the browser's own error
// screen. That matters most once the app is installed, because an installed
// app opens in its own window with no browser around it — there, the
// browser's error page looks like the app itself has broken.
//
// What it deliberately does NOT do is store the app itself. The usual PWA
// template caches index.html and the JS bundle and serves them from that
// store, so the app opens offline — but that also serves the *previous* build
// after every deploy until the new worker takes over. That is the "I have to
// hard refresh to see the deploy" problem scripts/build-vercel.mjs sets
// `no-store` to prevent. And an offline copy of this app would have nothing to
// show: orders and stock are live data, and nothing could be saved.
//
// Any request that isn't a page load (API calls, the hashed /assets/ files)
// is not touched at all, so it goes to the network exactly as it did before
// this file existed.
//
// Registered from src/main.tsx, production builds only.

// Change the number whenever offline.html changes. The browser only
// re-installs a worker whose own bytes changed, and installing is when the
// offline page is saved — so without a change here, the old page stays.
const CACHE = "ori-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  // Save the offline page now, while there is still a connection to fetch it
  // with. `cache: "reload"` skips the browser's HTTP cache, so it's always the
  // copy from this deployment.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  // Replace an older version of this file right away rather than waiting for
  // every tab to close (an installed app may never close). Safe because this
  // worker serves no app files, so two versions can't be mixed together.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete what older versions of this file saved. Only our own prefix, so
      // nothing else on this origin can be caught by it.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("ori-offline-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      // A worker that has gone to sleep takes a moment to start up. With
      // navigation preload the browser starts fetching the page at the same
      // moment it wakes the worker, instead of waiting for the worker to ask —
      // so this file adds no delay to opening the app.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Page loads only: opening the app, typing an address, a reload. Returning
  // without calling respondWith hands the request back to the browser as if
  // there were no worker at all.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        // The fetch navigation preload already started — or, in a browser
        // without preload, an ordinary one.
        const preloaded = await event.preloadResponse;
        return preloaded ?? (await fetch(event.request));
      } catch {
        // Only reached with no network at all. A 404 or a 500 is still a
        // response from the server, so it goes through above untouched.
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? Response.error();
      }
    })(),
  );
});
