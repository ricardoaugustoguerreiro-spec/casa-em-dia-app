# Lições aprendidas — Casa em Dia

Cada entrada aqui deve ter um passo correspondente no checklist de SKILL.md.
Não basta registrar a lição — se não virou checklist, ela vai se repetir.

## #1 — 21/06/2026 — Ícones PNG novos não publicados (404 em produção)
**O que quebrou:** usuário abriu o app, ícone do PWA não carregava / instalação não funcionava corretamente.
**Causa raiz:** os arquivos `icons/icon-192.png`, `icon-512.png`, `icon-180.png` foram gerados localmente DEPOIS do primeiro `git push`. Ficaram só no disco (Google Drive), nunca foram enviados pro GitHub. O site publicado continuava com a versão antiga do manifest referenciando arquivos que não existiam no repositório remoto.
**Correção:** `git add -A && git commit && git push` dos arquivos faltantes.
**Prevenção (já no checklist, item 1 e 2):** sempre rodar `git status --short` antes de declarar qualquer entrega como "publicada"/"concluída" — arquivo criado localmente não é arquivo publicado até o push confirmar.

## #2 — 21/06/2026 — Usuário abriu o app via `file://` em vez da URL pública
**O que quebrou:** página em branco, nada carregava.
**Causa raiz:** não é bug do código — `type="module"` (ES Modules) é bloqueado por CORS quando a página é aberta direto do disco (`file:///H:/...`). Só funciona servido por http(s).
**Correção:** nenhuma no código; orientar o usuário a sempre usar a URL pública do GitHub Pages, nunca abrir o `index.html` clicando duas vezes nele.
**Prevenção (já no checklist, item 8):** ao testar/diagnosticar, sempre confirmar a URL usada antes de investigar o código — `file://` explica 100% dos casos de "tela branca total, sem nenhum dado".

## #3 — 21/06/2026 — Código morto (`x-text="$root ? '' : ''"`) deixado no HTML
**O que quebrou:** nada visível pro usuário, mas é sinal de edição apressada deixando lixo no código — esse tipo de coisa acumula e dificulta manutenção futura.
**Correção:** removido.
**Prevenção (já no checklist, item 3):** grep por padrões de placeholder/expressão Alpine vazia antes de qualquer entrega.

## #4 — 21/06/2026 — Carregamento duplicado de dados ao logar/cadastrar
**O que quebrou:** `submitAuth()` chamava `loadAfterLogin()` diretamente E o listener `onAuthStateChange` também chamava, gerando uma corrida e consultas duplicadas ao banco no momento do login.
**Causa raiz:** duas fontes de verdade pra "o que fazer quando loga" — o listener de auth e a função de submit do formulário.
**Correção:** removida a chamada direta em `submitAuth()`; `onAuthStateChange` é agora a única fonte de verdade para reagir a mudanças de sessão.
**Prevenção:** ao adicionar uma nova ação que depende de estado de sessão, sempre perguntar "isso já não é coberto pelo onAuthStateChange?" antes de chamar de outro lugar.

## #5 — 21/06/2026 — Página em branco com erro "appState is not defined" (o bug mais sério até agora)
**O que quebrou:** usuário abriu a URL pública correta (não era o erro #2) e a tela ficou em branco, com erro no console `Alpine Expression Error / Uncaught ReferenceError: appState is not defined`.
**Causa raiz dupla:**
  1. Corrida de carregamento: `<script defer src=".../alpinejs.../cdn.min.js">` e `<script type="module" src="js/app.js">` não garantem que o módulo registre `Alpine.data("appState", ...)` antes do Alpine iniciar e tentar avaliar `x-data="appState"` no HTML. A tentativa de corrigir com `window.deferLoadingAlpine` não resolveu (ou não foi a causa real isolada — ver item 2).
  2. **Pior**: durante a investigação, descobri que meu PRÓPRIO service worker (`sw.js`) tinha cacheado `index.html` e `js/app.js` na instalação (estavam na lista `ASSETS`) com estratégia cache-first. Isso significa que TODA correção que eu fizesse no código ficaria invisível pro usuário (e pra mim testando) até alguém limpar manualmente o cache do navegador — um service worker mal projetado pode mascarar para sempre qualquer deploy novo.
**Correção:**
  1. Trocada a tag `<script>` do Alpine por `import Alpine from "https://esm.sh/alpinejs@3.14.3"` dentro do próprio `js/app.js`, chamando `Alpine.data(...)` e só then `Alpine.start()` manualmente, no mesmo módulo, eliminando qualquer possibilidade de corrida de carregamento.
  2. Reescrito `sw.js`: HTML e `.js` agora usam estratégia **network-first** (sempre busca a rede antes, só cai pro cache se estiver offline). Cache-first ficou reservado só pra ícones/manifest, que raramente mudam.
**Prevenção (novos itens no checklist abaixo):**
  - Sempre testar localmente com DevTools / `javascript_tool` rodando `navigator.serviceWorker.getRegistrations()` + `caches.keys()` antes de confiar em qualquer teste — um SW antigo pode estar mascarando a versão real.
  - Nunca colocar `index.html` ou arquivos `.js` que mudam com frequência na lista cache-first de um service worker — só assets verdadeiramente estáticos (ícones, fontes).
  - Preferir importar bibliotecas via ESM dentro do próprio módulo de app, em vez de depender de ordem entre `<script defer>` e `<script type="module">` na tag HTML — a ordem entre eles, embora especificada, é uma fonte de bug sutil e difícil de depurar.

## #6 — 21/06/2026 — Login falhava com "Email not confirmed" mesmo com senha certa
**O que quebrou:** usuário tentou logar/cadastrar e o Supabase Auth bloqueou com erro "Email not confirmed". Senha e e-mail estavam certos — não era bug de código nenhum, é configuração padrão do projeto Supabase: por padrão, "Confirm email" vem ATIVADO em todo projeto novo, e como não há servidor de e-mail (SMTP) configurado, o e-mail de confirmação nunca chega — o usuário fica permanentemente bloqueado sem saber por quê.
**Causa raiz:** ao criar um projeto Supabase novo do zero, "Confirm email" vem ligado por padrão em Authentication → Providers → Email. Eu recomendei desligar isso bem no início do projeto (antes de rodar a migração), mas isso é uma configuração do painel do Supabase que eu não consigo mudar programaticamente (não existe ferramenta MCP para isso) — só o usuário pode, e a recomendação inicial não foi suficiente porque foi feita de forma passiva (uma frase numa lista), não como bloqueio explícito antes de liberar o cadastro.
**Correção:** orientar o usuário a desligar "Confirm email" em Authentication → Providers → Email, e rodar `delete from auth.users where email = '...'` no SQL Editor para liberar o e-mail já tentado (a exclusão cascateia pra `profiles` por causa do `on delete cascade`).
**Prevenção (novo item no checklist abaixo):** sempre que um projeto Supabase for criado do zero (este ou outro futuro), confirmar ATIVAMENTE (perguntando ao usuário "você já desligou X?", não só recomendando de passagem) que "Confirm email" foi desligado ANTES de orientar o primeiro cadastro — ou, melhor ainda, testar com uma chamada de signUp e checar se o erro "Email not confirmed" aparece, em vez de assumir que a recomendação anterior foi seguida.

## #7 — 21/06/2026 — "Signups not allowed for this instance" (segunda trava de Auth seguida)
**O que quebrou:** depois de corrigir a lição #6, novo cadastro falhou com "Signups not allowed for this instance".
**Causa raiz:** outra configuração do painel do Supabase (Authentication → Sign In / Up → "Allow new users to sign up"), desligada por padrão ou desligada junto quando outra opção de auth foi tocada. Mesma categoria de problema da lição #6: configuração do painel, não bug de código — mas é a SEGUNDA trava de autenticação consecutiva que pega o usuário de surpresa.
**Correção:** ativar "Allow new users to sign up" no painel.
**Prevenção (novo item no checklist abaixo):** ao configurar qualquer projeto Supabase novo do zero, fazer uma checagem ÚNICA e explícita de TODAS as configurações de Authentication relevantes de uma vez (confirm email, allow signups, e qualquer outra trava parecida), em vez de descobrir uma por vez conforme o usuário tropeça nelas. Perguntar/checar tudo de auth na mesma conversa em que o projeto é criado.
