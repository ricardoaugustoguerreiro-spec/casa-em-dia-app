---
name: verify-casa-em-dia
description: Verifica o app Casa em Dia (HTML/JS estático no GitHub Pages + Supabase) procurando erros reais — arquivos 404, código morto, dessincronia entre Drive/git/GitHub, problemas de PWA/iOS/Android, RLS quebrado. Gera relatório, corrige o que for seguro corrigir sozinho, e registra toda falha encontrada em lessons.md para nunca mais checar isso "de cabeça" — toda lição se torna um item permanente do checklist. Use quando o usuário disser "o app não carregou", "verifica o app", "achei um bug", "roda a skill de verificação", ou antes de anunciar qualquer deploy como concluído.
---

# Verificação do Casa em Dia

Esta skill existe porque esse projeto já teve dois bugs reais de deploy (arquivos novos não enviados pro GitHub; código morto deixado no HTML). O objetivo não é só achar erro uma vez — é que **cada erro encontrado vire um item permanente do checklist abaixo**, pra essa classe de erro nunca mais passar sem ser pega.

## Antes de tudo: leia o histórico

Leia `lessons.md` (nesta mesma pasta) inteiro antes de começar. Cada lição vira um passo de verificação obrigatório nas seções abaixo — se uma lição nova aparecer durante esta execução, **adicione um passo de checklist permanente correspondente nesta skill**, não só registre no log. O log sem virar checklist não previne recorrência.

## Caminho do projeto
`H:\Meu Drive\FINANÇAS\Casa-em-Dia-App`

## Checklist de verificação (rode tudo, não pare no primeiro erro)

### 1. Sincronia Drive ↔ git ↔ GitHub ↔ Pages (causa do bug dos ícones)
```bash
cd "/h/Meu Drive/FINANÇAS/Casa-em-Dia-App"
git status --short                      # qualquer linha aqui = arquivo criado/editado e NÃO commitado
git log origin/main..HEAD --oneline     # commits locais não enviados ainda
git log HEAD..origin/main --oneline     # commits remotos que sua cópia local não tem (não deveria haver, é repo só seu)
```
Se `git status` mostrar qualquer coisa: **isso é um bug** — significa que o que está no Drive é diferente do que está publicado. Faça `git add -A && git commit -m "..." && git push` antes de declarar qualquer tarefa como concluída.

### 2. Todo arquivo referenciado existe e responde 200 no site publicado
Liste todo `src=`, `href=` de `index.html` e `manifest.json`, e teste cada um contra a URL pública:
```bash
BASE="https://ricardoaugustoguerreiro-spec.github.io/casa-em-dia-app"
for f in "" "manifest.json" "sw.js" "js/config.js" "js/supabaseClient.js" "js/app.js" \
         "icons/icon.svg" "icons/icon-192.png" "icons/icon-512.png" "icons/icon-180.png"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/$f")
  echo "$f -> $code"
done
```
Qualquer coisa diferente de 200 é bug. (Histórico: `icons/icon-192.png` deu 404 porque os PNGs foram gerados depois do primeiro push e ninguém fez o segundo push — ver lessons.md #1.)

### 3. Código morto / placeholders esquecidos
```bash
grep -n "TODO\|FIXME\|console.log(\"debug\|\$root ? ''" index.html js/*.js
```
Qualquer expressão Alpine que não faz nada (tipo `x-text="algumaCoisa ? '' : ''"`) é lixo deixado de uma edição anterior — remover.

### 4. Segredos nunca vazaram pro repositório público
```bash
git log --all -p -- '*.html' '*.js' '*.json' | grep -iE "service_role|postgresql://postgres:|MazaRicardo" && echo "ALERTA: segredo no histórico do git!" || echo "ok, nenhum segredo encontrado no histórico"
ls .gitignore && cat .gitignore   # confirmar que _segredos-nao-compartilhar/ está listado
```
Isso é crítico porque o repositório é **público** — qualquer coisa commitada por engano fica visível pra sempre (mesmo apagando depois, o histórico do git guarda).

### 5. Config do Supabase aponta pro projeto certo
```bash
cat js/config.js
```
Confirme que a URL é a do projeto atual (`aynteobslozppsjxgheo.supabase.co` na criação deste projeto — se o projeto Supabase for recriado um dia, este arquivo PRECISA ser atualizado, senão o app conecta no banco errado/morto).

### 6. PWA instalável (critérios mínimos do Chrome/Android)
- `manifest.json` tem `icons` com pelo menos um PNG ≥192x192 e um ≥512x512 (SVG sozinho não é suficiente em todo Android)
- `index.html` tem `<link rel="manifest">`, `apple-touch-icon` apontando pra um PNG (não SVG — iOS ignora SVG em apple-touch-icon)
- `sw.js` existe, está registrado no `index.html`, e a lista `ASSETS` inclui todo arquivo novo que a app passou a usar

### 7. Campos de formulário não disparam zoom indesejado no iPhone
```bash
grep -n 'type="text"\|type="email"\|type="password"\|<textarea' index.html
```
Todo `<input>` de texto/senha/email e todo `<textarea>` visível ao usuário deve ter `text-base` (16px) ou maior — menor que isso o iOS Safari dá zoom automático ao focar, o que parece "bug" pro usuário. (Histórico: lição #9 — os campos novos do formulário de evento do calendário, Título/Local/Notas, foram criados com `text-sm` e escaparam dessa checagem porque o grep original só buscava `<input` sem checar a classe nem cobrir `<textarea>`.)

### 7b. Verificar acesso à URL pública direto do ambiente
Sessões remotas (Claude Code on the web) podem ter a política de rede do sandbox bloqueando `*.github.io` (`curl` retorna 403 com `x-deny-reason: host_not_allowed`, mesmo `github.com` funcionando). Isso **não é o site quebrado** — é só essa sessão não tendo saída de rede liberada pro domínio do GitHub Pages. Nesse caso, registrar a limitação explicitamente pro usuário em vez de reportar como "site fora do ar", e pedir confirmação visual de quem tem acesso real (navegador do usuário, ou uma sessão/ambiente sem essa restrição).

### 8. Teste funcional mínimo (se possível)
Se houver navegador disponível via Chrome MCP/computer-use, abra a URL pública (NUNCA `file://`, módulos JS não carregam nesse protocolo) e confira:
- Tela de login aparece (não fica em branco)
- Console do navegador sem erros vermelhos (`mcp__Claude_in_Chrome__read_console_messages` se disponível)
- Login ou cadastro completa e mostra o dashboard

### 9. O service worker não pode mascarar uma versão antiga (causa do bug mais sério até agora — lição #5)
Antes de confiar em QUALQUER teste (local ou em produção), limpe o estado anterior do navegador:
```js
// rodar via mcp__Claude_in_Chrome__javascript_tool antes de testar
const regs = await navigator.serviceWorker.getRegistrations();
for (const r of regs) await r.unregister();
const keys = await caches.keys();
for (const k of keys) await caches.delete(k);
```
E revise `sw.js`: `index.html` e qualquer `.js`/`.html` (código que muda) DEVEM usar estratégia **network-first** (busca a rede, só cai pro cache se offline). Cache-first só é aceitável pra ícones/manifest, que praticamente nunca mudam. Se algum dia `sw.js` voltar a ter `index.html`/`*.js` numa lista cache-first, isso é regressão da lição #5 — corrigir imediatamente.

### 10. Alpine.js: nunca depender de ordem entre `<script defer>` e `<script type="module">`
O app deve importar o Alpine via ESM (`import Alpine from "https://esm.sh/alpinejs@..."`) dentro do próprio `js/app.js`, registrar `Alpine.data(...)` e só então chamar `Alpine.start()` manualmente — tudo no mesmo módulo, em sequência garantida. Se algum dia aparecer uma tag `<script src=".../alpinejs/...">` solta no `index.html` de novo, é regressão da lição #5 — o bug "appState is not defined" vai voltar.

### 11. Checklist único de configuração de Authentication (causa das lições #6 e #7 — duas travas seguidas)
Toda vez que um projeto Supabase novo for criado (este ou outro futuro), confirmar **de uma vez só**, não uma a uma conforme o usuário tropeça:
- "Confirm email" desligado em Authentication → Providers → Email (senão: erro "Email not confirmed" — lição #6)
- "Allow new users to sign up" ligado em Authentication → Sign In / Up (senão: erro "Signups not allowed for this instance" — lição #7)
- Qualquer outra trava de Auth visível na mesma tela, revisar de passagem já que está lá
- Lembrar que este projeto NÃO tem servidor de e-mail (SMTP) configurado — qualquer fluxo que dependa de e-mail chegar (confirmação, recuperação de senha) vai travar até isso ser revisado
- Se um usuário relatar qualquer mensagem de erro ao logar/cadastrar que não reconheço, a primeira suspeita deve ser configuração do painel de Auth, não bug de código — esse projeto já teve 2 casos assim em sequência.

### 12. Erros de "caminho/link errado" que se repetem precisam de artefato físico, não só de aviso (lição #8)
Confirme que estes dois arquivos existem e estão corretos na pasta `H:\Meu Drive\FINANÇAS`:
```bash
cat "/h/Meu Drive/FINANÇAS/Abrir Casa em Dia.url"   # deve apontar pra URL pública do GitHub Pages
ls "/h/Meu Drive/FINANÇAS/QR-code-Casa-em-Dia.png"  # deve existir
```
Se a URL do app mudar um dia (novo domínio, novo repositório), **atualize esses dois arquivos também** — eles são a forma como o usuário acessa o app no dia a dia, não só uma mensagem de chat que rola pra cima e se perde.
Regra geral por trás disso: se um mesmo erro de usuário (caminho errado, link errado, confundir dois arquivos parecidos) se repetir depois de já ter sido explicado uma vez, a resposta certa na segunda vez é mudar o ambiente (criar atalho, renomear arquivo, mover pasta), não só explicar de novo.

### 13. Calendário tem skill própria
Tudo relacionado a feriados, permissões pessoal×trabalho, conflito de horário, fuso horário e import de prazos do calendário tem checklist e histórico dedicados em `.claude\skills\verify-calendario\` (SKILL.md + lessons.md) — rode essa sub-skill quando o problema for especificamente do módulo de calendário, em vez de tentar cobrir tudo aqui.

### 14. Expressões `:class`/`:style`/`x-show` grandes podem quebrar SILENCIOSAMENTE (lição #11)
Alpine engole erro de sintaxe numa expressão e simplesmente não aplica o binding — sem erro visível no app, só um `console.warn` que ninguém vê se não checar. Depois de editar qualquer ternário encadeado grande (mais de 2-3 níveis) ou converter pra sintaxe de array `:class="[...]"`:
1. Conte parênteses abertos vs fechados na expressão isolada (rápido de fazer manualmente ou com `s.count('(') == s.count(')')` em Python).
2. Suba o app no preview local (`H:\Meu Drive\FINANÇAS\.claude\launch.json`) e cheque `console_logs` nível warn/error — não confie só em screenshot, esse tipo de bug não aparece visualmente até você comparar com/sem a correção lado a lado.
3. Se o preview ficar travado/servindo 404 sem motivo aparente, é processo python órfão de uma sessão anterior — mate por PID (porta 8731) e chame `preview_start` de novo, não é bug do app.

## Depois de verificar: o relatório

Produza um relatório curto pro usuário com este formato:
```
✅ O que está OK: ...
🔧 O que corrigi agora: ...
⚠️ O que precisa de uma decisão sua: ...
```
Não enrole — se está tudo ok, diga isso em 1 frase e pare.

## Registrando uma lição nova

Sempre que achar um bug que não estava nesta checklist, faça as duas coisas (não uma só):
1. Acrescente uma entrada em `lessons.md` (data, o que quebrou, causa raiz, correção).
2. Acrescente um passo correspondente na seção "Checklist de verificação" acima, pra essa skill já nascer sabendo procurar esse erro da próxima vez. Edite este próprio arquivo SKILL.md para isso.

Isso é o que torna o sistema redundante: a skill não depende da memória de quem está rodando — o checklist cresce a cada execução e cobre cada vez mais classes de erro.
