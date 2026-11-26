// itaOS service worker: makes the app installable, keeps it opening when the connection drops,
// and shows push notifications for new WhatsApp messages.
//
// Caching is deliberately small. Supabase (another origin) is never touched, so data is always live.
//  - Pages: network first; the last good copy of the app opens if the network is down.
//  - /assets/* (Vite files with a hash in the name, never change): cache first.
// Every deploy to main is picked up on the next open because pages always try the network first.
const VERSION = "itaos-v2";
const SHELL = "/app";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([new Request("/", { cache: "reload" }), new Request(SHELL, { cache: "reload" })])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        // Keep the last good homepage and app page so the installed app opens offline.
        const key = url.pathname === "/" ? "/" : url.pathname.startsWith("/app") ? SHELL : null;
        if (res.ok && key) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      } catch {
        const cached = (await caches.match(url.pathname === "/" ? "/" : SHELL)) || (await caches.match(SHELL)) || (await caches.match("/"));
        return cached || new Response("<h1>No connection</h1><p>itaOS needs the internet. Try again when you're back online.</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // Start-up scripts (theme, loaders), moved out of index.html on 26 Nov so the page can use a strict
  // script policy: network first so a deploy is picked up at once, the last good copy when offline.
  if (url.pathname.startsWith("/boot/")) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      } catch { return (await caches.match(req)) || new Response("", { headers: { "Content-Type": "text/javascript" } }); }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    })());
  }
});

// ---- Push notifications ----
// Payload (from the push-send function): { title, body, url, tag }
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  const title = d.title || "itaOS";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    tag: d.tag || undefined,          // one notification per chat: a newer message replaces the older one
    renotify: !!d.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/maskable-192.png",
    data: { url: d.url || "/app#chats" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/app#chats", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith("/app")) {
        await w.focus();
        try { await w.navigate(target); } catch { w.postMessage({ type: "open", url: target }); }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
