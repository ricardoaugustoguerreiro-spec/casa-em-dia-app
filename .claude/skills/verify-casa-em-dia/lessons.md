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

## #8 — 21/06/2026 — Usuário abriu `file://` de novo, mesmo já tendo sido avisado (lição #2 se repetiu)
**O que quebrou:** mesmo depois de explicado na lição #2, o usuário voltou a abrir `index.html` direto da pasta do Drive (clicando duas vezes / via @-mention no Claude) em vez da URL pública. Avisar uma vez por texto não foi suficiente — é fácil de esquecer porque o arquivo "parece" o app (mesmo nome, mesmo ícone na pasta).
**Causa raiz:** não existia nenhum atalho físico e óbvio na pasta que levasse direto pro link certo. A única forma de acessar era lembrar/copiar a URL de uma mensagem antiga.
**Correção (permanente, não é só aviso de novo):**
  - Criado `H:\Meu Drive\FINANÇAS\Abrir Casa em Dia.url` — um atalho de internet de verdade (não é o `index.html`), com ícone próprio, que abre direto no navegador para a URL pública. Clicar nele não tem como cair no erro de `file://`.
  - Criado `H:\Meu Drive\FINANÇAS\QR-code-Casa-em-Dia.png` — QR code apontando pra mesma URL, pra abrir em celular/tablet sem digitar nem confundir link.
**Prevenção (novo item no checklist abaixo):** sempre que esse tipo de confusão (caminho errado, link errado, abrir arquivo local em vez de site) acontecer, a solução correta não é só explicar de novo em texto — é criar um artefato físico na pasta (atalho, QR code, ícone) que elimine a possibilidade do erro se repetir. Aplica-se a qualquer "o usuário continua fazendo X errado" — preferir consertar o ambiente a repetir a instrução.

## #9 — 21/06/2026 — Campos novos do calendário (Título, Local, Notas) com `text-sm` disparavam zoom no iPhone
**O que quebrou:** nada visível em desktop, mas no iPhone, ao tocar nos campos "Título", "Local (opcional)" ou "Notas (opcional)" do formulário de novo compromisso do calendário, o Safari daria zoom automático na tela (comportamento padrão do iOS para qualquer campo de texto com fonte menor que 16px).
**Causa raiz:** esses três campos foram adicionados junto com o módulo de calendário usando `class="... text-sm"` (14px), em vez de seguir o padrão já usado nos campos de login (`text-base`, 16px). O item 7 do checklist já existia, mas o comando de verificação (`grep -n "<input" index.html`) só listava as tags e dependia de inspeção visual da classe — não falhava automaticamente, e não cobria `<textarea>`.
**Correção:** trocado `text-sm` por `text-base` nos três campos (`index.html`, formulário de evento do calendário).
**Prevenção (novo item no checklist, agora item 7 reescrito):** o grep do item 7 agora filtra direto por `type="text"|type="email"|type="password"|<textarea` (os elementos que realmente importam) em vez de todo `<input`, o que torna mais fácil notar a classe de cada um numa lista curta. Qualquer campo de texto/textarea novo deve nascer com `text-base`, nunca `text-sm` ou menor.

## #10 — 21/06/2026 — Sandbox remoto bloqueia `*.github.io` (curl/WebFetch retornam 403)
**O que quebrou:** ao tentar verificar a URL pública do app a partir de uma sessão do Claude Code on the web, todo request (WebFetch e `curl` via Bash) para `https://ricardoaugustoguerreiro-spec.github.io/...` voltou HTTP 403, em todo arquivo testado (`index.html`, `manifest.json`, `sw.js`, etc.) — parecia que o site inteiro tinha saído do ar.
**Causa raiz:** não é o site — é a política de rede (egress) do ambiente sandbox dessa sessão, que bloqueia o host `*.github.io` (header de resposta `x-deny-reason: host_not_allowed`). Confirmado comparando com `https://github.com` (200 OK) e `https://example.com` (também 403) no mesmo ambiente — domínios fora da allowlist do proxy retornam 403 uniforme, independente do path.
**Correção:** nenhuma no código do app. Relatar ao usuário que a verificação ao vivo não foi possível **a partir desse ambiente específico**, sem afirmar que o site está fora do ar, e pedir para o próprio usuário confirmar abrindo a URL no navegador dele (que não tem essa restrição).
**Prevenção (novo item no checklist abaixo, item 7b):** antes de declarar "site fora do ar" com base em 403 de dentro de uma sessão remota, testar se a mesma sessão consegue acessar outro domínio conhecido (`github.com`) — se sim e o domínio alvo não, é bloqueio de rede do ambiente, não bug do site.

## #11 — 22/06/2026 — Expressão `:class` do calendário quebrada silenciosamente (parêntese faltando)
**O que quebrou:** ao adicionar o destaque visual do "dia de hoje" no calendário, a expressão `:class="!dia ? ... : (...)"` foi convertida pra sintaxe de array (`:class="[...]"`) e ficou faltando um parêntese de fechamento antes da vírgula. Resultado: TODA a coloração de fundo do calendário (conflito em vermelho, menstruação em rosa, período fértil em azul-claro, feriado em cinza) parou de funcionar — mas sem nenhum erro visível no app, só um `console.warn` (`Alpine Expression Error: Unexpected token ']'`) repetido a cada dia do calendário renderizado. Passou por duas sessões sem ser notado porque nenhuma tinha checado o console do navegador, só screenshots.
**Causa raiz:** Alpine engole erros de expressão e simplesmente não aplica o binding, deixando o elemento só com a `class` estática — o app continua "funcionando" visualmente o suficiente pra não levantar suspeita numa olhada rápida.
**Correção:** balanceado o parêntese (`new Function` com a expressão extraída — contar `(` vs `)` confirma rápido um desbalanceamento como esse).
**Prevenção (novo item no checklist abaixo, item 8):** sempre que editar uma expressão `:class`/`:style`/`x-show` grande (múltiplos ternários encadeados, ou convertida pra array), depois de salvar: (1) contar parênteses abertos vs fechados na expressão isolada, e (2) checar `console_logs` (nível warn/error) do preview antes de declarar pronto — esse tipo de erro NUNCA aparece em screenshot, só em log.

## #12 — 22/06/2026 — Tabela nova criada no banco mas esquecida na tarefa de backup
**O que quebrou:** nada visível pro usuário, mas a tarefa agendada `backup-casa-em-dia` rodou de verdade no dia 22/06 (`lastRunAt` registrado) e NÃO deixou nenhum arquivo novo na pasta `Backups-CasaEmDia` — o último arquivo era do dia 21. Investigando, a lista de tabelas hardcoded no `SKILL.md` da tarefa (`profiles, categories, fixed_bills, bill_payments, transactions, imports, events, balances, dismissed_insights`) não foi atualizada quando criamos `dias_menstruacao`, `registros_intimos`, `push_subscriptions`, `notificacoes_enviadas`, `compras_parceladas` ao longo da sessão — passaram 5+ tabelas novas sem reflexo na rotina de backup.
**Causa raiz:** nenhum processo força lembrar de atualizar a skill de backup quando uma `create table` nova é aplicada no Supabase — é fácil esquecer porque a tabela funciona perfeitamente no app sem isso.
**Correção:** rodei o backup manualmente pro dia 22 (com todas as 14 tabelas atuais) e atualizei a lista de tabelas no `SKILL.md` da tarefa agendada (`C:\Users\ricar\.claude\scheduled-tasks\backup-casa-em-dia\SKILL.md`), incluindo instrução pra sempre confirmar no disco que o arquivo foi mesmo criado.
**Prevenção (novo item no checklist abaixo, item 15):** toda vez que uma `migration_*.sql` deste projeto criar uma tabela nova (`create table public.X`), atualizar NO MESMO MOMENTO a lista de tabelas em `C:\Users\ricar\.claude\scheduled-tasks\backup-casa-em-dia\SKILL.md` — não deixar pra depois, porque "depois" é exatamente quando isso passa em branco.

## #13 — 23/06/2026 — Push enviado com sucesso pelo servidor mas não chega no celular (Xiaomi/MIUI)
**O que quebrou:** notificação Web Push não aparecia no celular Xiaomi Redmi da Jéssica, mesmo com tudo correto do lado do app: `push_subscriptions` válida no banco, endpoint FCM correto, envio retornando sucesso sem nenhum erro. Parecia bug de código, mas não era.
**Causa raiz:** o gerenciador de bateria agressivo do MIUI (Xiaomi) bloqueia, por padrão, notificações de apps/PWAs em segundo plano — o navegador (Chrome) é "congelado" pelo sistema antes de poder processar e exibir o push recebido. Isso acontece silenciosamente: nem o servidor, nem o navegador, nem o app reportam erro algum, porque a entrega via FCM foi bem-sucedida — o bloqueio ocorre depois, dentro do próprio Android/MIUI.
**Correção (no celular, não no código):**
  1. Configurações > Apps > Gerenciar apps > Chrome (ou navegador usado) > Economia de bateria > **Sem restrições**.
  2. App "Segurança" (Security) do MIUI > Permissões > Início automático (Autostart) > ativar para o Chrome/navegador.
  3. Configurações > Notificações > Chrome > garantir que notificações estão permitidas e sem restrição adicional.
  4. Abrir o app/lista de recentes e "travar" (lock, ícone de cadeado) o Chrome para impedir que o MIUI o encerre em segundo plano.
**Prevenção (novo item no checklist abaixo, item 16):** sempre que push não chegar em Android e toda a cadeia do lado do servidor (banco, endpoint, envio sem erro) estiver confirmada como correta, suspeitar IMEDIATAMENTE de gerenciador de bateria do fabricante (MIUI/Xiaomi, mas também ColorOS/Oppo, OneUI/Samsung, EMUI/Huawei têm variantes do mesmo problema) antes de procurar bug no código — é a causa mais comum de "push enviado mas não chega" em Android e não deixa rastro de erro em lugar nenhum. Orientar o usuário a verificar economia de bateria, início automático e notificações nas configurações do celular.
