const CACHE = "casa-em-dia-v4";
const ASSETS = [
  "./manifest.json",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // HTML/JS (navegação e código do app) -> sempre rede primeiro, nunca trava em versão antiga.
  // Só cai pro cache se estiver offline de verdade.
  const isAppCode = event.request.mode === "navigate" || event.request.url.endsWith(".js") || event.request.url.endsWith(".html");
  if (isAppCode) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Ícones/manifest (raramente mudam) -> cache primeiro, mais rápido.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ===================== NOTIFICAÇÕES PUSH =====================

self.addEventListener("push", (event) => {
  let dados = { title: "Casa em Dia", body: "Você tem uma novidade no app." };
  if (event.data) {
    try {
      dados = event.data.json();
    } catch (e) {
      dados.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(dados.title || "Casa em Dia", {
      body: dados.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: dados.url || "./index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
