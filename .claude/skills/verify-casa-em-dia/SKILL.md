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
grep -n "<input" index.html
```
Todo `<input>` de texto/senha/email visível ao usuário deve ter `text-base` (16px) ou maior — menor que isso o iOS Safari dá zoom automático ao focar, o que parece "bug" pro usuário.

### 8. Teste funcional mínimo (se possível)
Se houver navegador disponível via Chrome MCP/computer-use, abra a URL pública (NUNCA `file://`, módulos JS não carregam nesse protocolo) e confira:
- Tela de login aparece (não fica em branco)
- Console do navegador sem erros vermelhos (`mcp__Claude_in_Chrome__read_console_messages` se disponível)
- Login ou cadastro completa e mostra o dashboard

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
