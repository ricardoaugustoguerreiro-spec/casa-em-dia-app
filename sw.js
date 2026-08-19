const CACHE = "casa-em-dia-v37";
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

// Notificações push foram removidas do app (06/08/2026) — este service worker
// cuida só do cache offline. Se um push antigo chegar de alguma assinatura que
// ainda não expirou, não há handler: o navegador ignora e nada é exibido.
