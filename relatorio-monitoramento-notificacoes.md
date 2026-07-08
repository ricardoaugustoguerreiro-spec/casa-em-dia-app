# Relatório de monitoramento — notificações push Casa em Dia

Monitoramento iniciado em 2026-06-28 16:5x, checando a cada ~10 min se o workflow
`notificar.yml` está rodando com sucesso e investigando possíveis causas de
notificações não chegarem no celular (iOS do Ricardo / Xiaomi da Jéssica).

## Contexto fixo (não muda a cada checagem)

**iOS (Ricardo):**
- Web Push só funciona no Safari/iOS se o app estiver **instalado como PWA**
  (Compartilhar → "Adicionar à Tela de Início"). Aberto só pelo navegador, sem
  instalar, o iOS NUNCA entrega push — isso é limitação do sistema, não bug do app.
- Precisa iOS 16.4+.
- Depois de instalado, é preciso abrir o app (ícone na tela de início) pelo menos
  uma vez e tocar em "Ativar notificações" pra gerar a subscription.
- Se o Ricardo desinstalar/reinstalar o PWA, ou limpar dados do Safari, a
  subscription antiga fica inválida e precisa ativar de novo.

**Xiaomi/MIUI (Jéssica):**
- MIUI tem otimização de bateria agressiva que mata processos em segundo plano,
  incluindo o serviço que recebe push do navegador.
- Precisa: Configurações → Apps → Chrome (ou navegador usado) → Bateria →
  "Sem restrições" + desativar "Otimização de bateria" pra esse app.
- Também precisa ativar "Autostart" pro Chrome em Configurações de segurança do MIUI.
- Sem isso, o push pode ser enviado pelo servidor com sucesso e mesmo assim nunca
  aparecer no celular — não tem como diagnosticar isso pelo lado do servidor/GitHub.

## Checagens

### Checagem 1 — 2026-06-28 ~16:56 (logo após correção das secrets)
- Último run do workflow: **sucesso** (run 28329129210, iniciado 16:46:31Z)
- Run anterior (15:46): falha — era a falha crônica por falta de secrets, já corrigida
- Conclusão: workflow voltou a funcionar no lado do servidor. Lado servidor = OK.
- Pendente verificar: se as notificações estão de fato chegando nos dois celulares
  (isso eu não consigo verificar remotamente — depende do Ricardo/Jéssica confirmarem
  ou de logs futuros mostrarem erro de push por dispositivo).

### Checagem 2 — 2026-06-28 17:00
- Run mais recente: **sucesso** (run 28329479334, iniciado 16:59:52Z)
- Run anterior também sucesso (16:46:31Z)
- 2 sucessos consecutivos desde a correção das secrets — workflow estável no lado servidor.
- Nenhuma falha nova pra investigar nesta rodada.

### Investigação extra — 2026-06-28 17:1x: "notificação não chegou no meu celular" (Ricardo)

**Diagnóstico:** enviei um push de teste real (fora do fluxo normal do `notificar.py`,
direto via `pywebpush` local) pra cada subscription cadastrada no banco
(`push_subscriptions`), usando as mesmas chaves VAPID do app:

- iPhone do Ricardo (endpoint `web.push.apple.com/...`, subscription de 22/Jun): **HTTP 201 — Apple aceitou, e a notificação "Teste de diagnóstico" chegou no celular dele.** Subscription válida, push funcionando 100%.
- Celular da Jéssica (endpoint `fcm.googleapis.com/...`, único subscription com esse `user_id`): **HTTP 201 — Google aceitou.** Aguardando confirmação dela se apareceu (MIUI pode bloquear silenciosamente mesmo com a entrega aceita pelo FCM — ver seção "Xiaomi/MIUI" acima).

**Causa raiz da notificação que não chegou antes:** consultei a tabela
`notificacoes_enviadas` (controle de idempotência) e tem 11 chaves `conta:<id>`
e 1 `pergunta_gasto:2026-06-23` já marcadas como enviadas. Isso confirma que,
durante o período em que o workflow falhava (secrets faltando), o script
**nunca chegava a marcar nada como enviado** — porque ele quebra (`carregar_config`)
antes de chegar no loop de envio. Ou seja, nenhuma notificação real foi
"perdida silenciosamente": ela simplesmente nunca foi tentada, e agora que o
workflow voltou a funcionar (16:46 em diante), as próximas contas/eventos
dentro da janela (`JANELA_CONTA_DIAS=1`, `JANELA_EVENTO_MIN=30`) serão
enviadas normalmente no próximo ciclo de 15 min.

**Conclusão:** não tem bug pendente no lado do servidor nem nas subscriptions
atuais. Se uma notificação específica "não chegar" de novo, os passos pra
diagnosticar são:
1. Conferir se o workflow rodou com sucesso perto do horário esperado (checagens deste relatório).
2. Conferir se a `chave` daquela notificação já está em `notificacoes_enviadas` — se sim, ela já foi "tentada" (mas pode ter falhado silenciosamente em só um dispositivo, porque o código usa `any()` — basta UM dispositivo receber pra marcar como enviada pra todos, então o outro pode nunca ter recebido e não vai ser re-tentado). **Esse é o único ponto frágil real da arquitetura atual** — vale considerar mudar a idempotência para ser por (chave, subscription) em vez de só por chave, se isso voltar a acontecer.
3. Se confirmado que o servidor entregou (como nos testes de hoje) mas o celular não mostrou nada, o problema é local: permissão de notificação, modo Foco/Não Perturbe (iOS) ou otimização de bateria/autostart (Xiaomi MIUI).

### Atualização — Jéssica não recebeu o push de teste (Xiaomi)

O push pro endpoint FCM da Jéssica foi aceito (HTTP 201) mas não apareceu no celular dela.
Investigação extra: o ícone do app na tela dela foi instalado originalmente pelo
**navegador nativo Mi Browser**, antes do Chrome ser definido como padrão. Um PWA
instalado fica vinculado ao motor do navegador usado na instalação — trocar o
padrão depois não migra o ícone existente. O Mi Browser tem suporte a Web Push
em background muito mais instável/agressivamente bloqueado pela MIUI que o Chrome,
e isso é invisível tanto pro Google/FCM (que reporta sucesso) quanto pro nosso código.

**Plano em andamento:** pedir pra Jéssica apagar o ícone atual, abrir o link pelo
Chrome, reinstalar via "Adicionar à tela inicial" do Chrome, e ativar notificações
de novo nesse novo ícone. Isso vai gerar uma subscription nova (created_at de hoje)
na tabela `push_subscriptions`, que poderemos testar de novo.
Considerou-se WhatsApp Business API como alternativa, mas é mais caro/burocrático
(precisa número comercial verificado, regras de janela de 24h) — só vale explorar
se a reinstalação via Chrome não resolver.
**Status:** aguardando a Jéssica reinstalar o app pelo Chrome.

### Checagem 3 — 2026-06-28 ~17:1x
- Run mais recente continua sendo o de 16:59:52Z (**sucesso**) — ainda não rodou um novo ciclo agendado nesta checagem.
- Nenhuma falha nova pra investigar.

### Mudança de código — 2026-06-28 ~17:2x
Implementado a pedido do Ricardo: lembrete de evento de hora em hora (antes só
30min antes, uma vez) + botão "Desligar avisos deste evento" por notificação.
Detalhes técnicos: tabela nova `eventos_silenciados` (RLS por user_id), action
`silenciar_evento` no `sw.js`, handler `processarSilenciarEventoNaUrl()` no
`app.js`, e `notificar.py` agora usa `chave = evento:<id>:<hora_cheia>` em vez
de uma única chave por evento. Commit `21451b0`, já com push pro `main`.
Próximas execuções do workflow devem usar essa lógica nova.

### Auditoria de segurança — 2026-06-28 ~17:3x (a pedido do Ricardo)

**Vulnerabilidade crítica encontrada e corrigida:** cadastro público estava
aberto no Supabase Auth (sem aprovação/confirmação manual). Como a chave anon
está exposta no repo público do GitHub (por design, é "segura" só se RLS
estiver correto), qualquer pessoa podia se cadastrar e, combinado com policies
de RLS escritas como `USING (true)` pra "qualquer autenticado", ler/editar
`transactions`, `balances`, `fixed_bills`, `bill_payments`, `categories`,
`compras_parceladas`, `imports`, `dismissed_insights`, `tarefas_joias` e
`profiles` — incluindo descrições de transações com nome completo, agência e
conta bancária.

Validado criando 2 contas de teste reais (apagadas depois): a 1ª, antes da
correção, leu transações de verdade; a 2ª, depois da correção, veio vazia em
tudo. Corrigido criando a função `is_household()` (checa se `auth.uid()` é um
dos dois UIDs reais — Ricardo `691ba2e0...`, Jéssica `8a74c2bb...`) e
reescrevendo todas as policies `USING (true)` pra usar essa função.

**Pendente (decisão do Ricardo):** ainda não desativamos o cadastro público em
si no painel do Supabase (Authentication → Settings) — ficou só a trava no
banco. Recomendo fazer isso também como defesa em profundidade.

Nada encontrado de errado no lado do GitHub: nenhum segredo real foi commitado
no histórico, e os workflows só disparam por `schedule`/`workflow_dispatch`
(não por `pull_request`), então não há risco de exfiltração de secrets via PR
de fork.

### Validação final da correção de segurança — 2026-06-28 ~17:4x

Ricardo desativou "Allow new users to sign up" no painel do Supabase
(Authentication → Sign In/Providers). Revalidei tudo:

- Tentativa de cadastro novo → `signup_disabled` (bloqueado, como esperado).
- Leitura anônima (sem login nenhum, só com a chave anon pública) em
  `transactions` e `profiles` → vazio nos dois.
- Endpoint de login normal (e-mail/senha) continua respondendo normalmente.

**Status de segurança: as duas camadas de defesa estão ativas** — cadastro
fechado (Auth settings) + RLS restrito a `is_household()` (defesa em
profundidade, caso algum dia um cadastro indevido volte a existir). Vulnerabilidade
crítica considerada **resolvida**.

### Checagem 4 — 2026-06-28 ~17:3x
- Run mais recente **ainda** é o de 16:59:52Z (run 28329479334, sucesso) — já
  passou bastante tempo (~30min+) sem um novo run agendado, o que é estranho
  pra um cron de `*/15 9-23 * * *`. Pode ser atraso normal do agendador de
  cron do GitHub Actions sob carga (GitHub não garante pontualidade exata pra
  schedules, principalmente em repositórios free/sem muita atividade), ou o
  workflow_dispatch manual anterior pode ter "resetado" o próximo disparo.
  Vou continuar observando — se passar de 1h sem nenhum run novo, vale
  investigar se o schedule ainda está ativo (Settings → Actions → o cron pode
  ser desabilitado automaticamente após 60 dias de repositório totalmente
  inativo, mas não é o caso aqui pelo histórico recente de commits/runs).

### Checagem 5 — 2026-06-28 ~17:4x
- Run mais recente AINDA é o de 16:59:52Z (run 28329479334, sucesso) — agora
  ~45min sem novo ciclo.
- Confirmei via API que o workflow está `state: active` (não foi desabilitado).
  Isso é um atraso conhecido do agendador de cron do GitHub Actions em
  repositórios no plano free — o GitHub não garante pontualidade exata pra
  `schedule`, e cron de alta frequência (`*/15min`) costuma atrasar mais sob
  carga do serviço. Não é um bug do nosso código. Vou continuar observando;
  se passar de 1h sem nenhum run novo, considerar simplificar o cron (ex: não
  usar dois blocos de cron separados) ou aceitar o atraso como limitação da
  plataforma free.

### Checagem 6 — 2026-06-28 ~17:5x
- Run mais recente do `notificar.yml` AINDA é o de 16:59:52Z — agora ~55min
  sem novo ciclo agendado (esperado a cada 15min).
- Confirmei que o GitHub Actions do repo está funcionando normalmente em
  geral: o workflow "pages build and deployment" rodou às 17:22:42Z (disparado
  pelo nosso push de código) com sucesso. Ou seja, não é uma falha geral do
  Actions nem do repo — é especificamente o `schedule` do `notificar.yml` que
  está atrasado. Continua parecendo atraso do agendador de cron do GitHub
  (conhecido em workflows de alta frequência), não bug nosso. Seguindo
  observação.

### Checagem 7 — 2026-06-28 ~18:0x
- Run mais recente do `notificar.yml` AINDA é o de 16:59:52Z — já mais de **1h**
  sem novo ciclo (limite que eu mesmo tinha marcado pra investigar mais a fundo).
- Confirmei: branch default é `main` (correto), o arquivo `.github/workflows/notificar.yml`
  existe normalmente nesse branch (sha `00826de...`), sem erro de sintaxe óbvio.
- Não tenho como inspecionar a fila interna de schedules do GitHub (isso é
  infraestrutura interna deles, sem endpoint público de diagnóstico). A causa
  mais provável continua sendo atraso conhecido do agendador de cron do
  GitHub Actions — é um problema documentado e recorrente da plataforma
  (especialmente em crons de alta frequência como `*/15min`), não algo que dá
  pra corrigir do nosso lado além de disparar manualmente quando precisar.
- **Ação meramente informativa, não vou disparar manualmente sem pedir** —
  mas se quiser, posso pedir pro Ricardo clicar em "Run workflow" de novo, ou
  podemos simplesmente esperar o GitHub se recuperar (normalmente volta a
  rodar sozinho). Vou continuar monitorando.

### Checagem 8 — 2026-06-28 18:08
- **Novo run apareceu:** 28331309244, iniciado 18:08:28Z, **sucesso**. Já roda
  com o commit `21451b0` (o do lembrete horário + botão de silenciar evento).
- Confirma a teoria da checagem anterior: era só atraso do agendador de cron
  do GitHub (ficou ~1h09min sem rodar entre 16:59:52Z e 18:08:28Z), não uma
  falha real. Voltou a funcionar sozinho, sem precisar de intervenção manual.
- Workflow estável e usando o código novo. Nenhuma falha pra investigar.

### Checagem 9 — 2026-06-28 ~18:2x
- Run mais recente continua sendo o de 18:08:28Z (sucesso) — ainda não rodou
  um novo ciclo nesta checagem (~15-20min depois, dentro do esperado pro
  intervalo de 15min, sem atraso anormal desta vez).
- Nenhuma falha pra investigar.

### Checagem 10 — 2026-06-28 ~18:3x
- Run mais recente continua sendo o de 18:08:28Z (sucesso) — ~25-30min sem
  novo ciclo. Ainda dentro de uma margem razoável de atraso do cron. Sem
  falha pra investigar.

### Checagem 11 — 2026-06-28 ~18:4x
- Run mais recente continua sendo o de 18:08:28Z (sucesso) — ~40min sem novo
  ciclo, voltando a entrar na faixa de atraso já vista antes (padrão de atraso
  recorrente do agendador de cron do GitHub, não falha nossa). Sem falha pra
  investigar.

### Checagem 12 — 2026-06-28 ~18:5x
- Run mais recente continua sendo o de 18:08:28Z (sucesso) — agora ~50min sem
  novo ciclo. Mesmo padrão de atraso do agendador de cron do GitHub, sem
  indício de falha real (workflow `state: active`, nenhuma falha nos últimos
  3 runs). Sem ação necessária.
