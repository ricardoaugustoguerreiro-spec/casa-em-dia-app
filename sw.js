const CACHE = "casa-em-dia-v46";
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

  // Bibliotecas de fora (Tailwind, Alpine, supabase-js) -> guarda a cópia na
  // primeira vez e serve do cache depois, atualizando por baixo. Sem isso o app
  // simplesmente NÃO ABRE sem internet: o Alpine vem de fora e é ele que
  // desenha a tela. O manifest promete funcionar offline; isto é o que cumpre.
  const url = new URL(event.request.url);
  const ehBibliotecaDeFora = url.hostname === "cdn.tailwindcss.com" || url.hostname === "esm.sh";
  if (ehBibliotecaDeFora) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const daRede = fetch(event.request)
          .then((res) => {
            // O <script> do Tailwind vem de outro dominio sem CORS: a resposta
            // e "opaca" (status 0, res.ok falso) mas serve perfeitamente para
            // executar. Sem esta segunda condicao, o Tailwind nunca era guardado
            // e o app abria offline sem estilo nenhum.
            if (res && (res.ok || res.type === "opaque")) {
              const copia = res.clone();
              caches.open(CACHE).then((cache) => cache.put(event.request, copia));
            }
            return res;
          })
          .catch(() => cached);
        return cached || daRede;
      })
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
