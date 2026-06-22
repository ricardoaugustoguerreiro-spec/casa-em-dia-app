---
name: rodar
description: Skill de automação e publicação do Casa em Dia — roda sozinha qualquer migration SQL pendente, executa as checklists de verificação (verify-casa-em-dia + verify-calendario), e publica no GitHub Pages (git add/commit/push). Use sempre que o usuário disser "roda a skill rodar", "atualiza o app", "publica", "sobe pro ar", "termina e publica", "deploy", ou ao final de qualquer sessão de edição em index.html/js/*.js/supabase/*.sql deste projeto — não espere o usuário pedir cada passo separadamente.
---

# Rodar — automação completa do Casa em Dia

Esta skill existe pra fazer o ciclo inteiro "código mudou → banco atualizado → verificado → publicado" sem o usuário precisar pedir cada etapa. Ela **importa** (lê e executa) as skills de verificação já existentes deste projeto — não duplica o conteúdo delas.

## Skills importadas (ler e seguir o checklist de cada uma)
- `.claude\skills\verify-casa-em-dia\SKILL.md` — checklist geral (sincronia git, 404, segredos, PWA, service worker, Alpine).
- `.claude\skills\verify-calendario\SKILL.md` — sub-checklist específico do módulo de calendário (só relevante se algo nessa área mudou).

Leia o `lessons.md` de cada uma antes de rodar — elas crescem a cada execução, então o checklist de hoje pode ter passos que não existiam na última vez que esta skill "rodar" foi atualizada.

## Pipeline (rode tudo, na ordem, sem pular etapa)

### 1. Migrations SQL pendentes
```bash
cd "/h/Meu Drive/FINANÇAS/Casa-em-Dia-App"
for f in supabase/migration_*.sql; do
  nome=$(basename "$f")
  grep -q "$nome" supabase/migrations_aplicadas.txt 2>/dev/null && continue
  echo "PENDENTE: $nome"
done
```
Para cada arquivo listado como pendente, rode:
```bash
python scripts/rodar_migration.py supabase/migration_NOME.sql
```
Isso conecta direto no Postgres via `pg8000` (senha lida de `_segredos-nao-compartilhar/supabase.txt`) e, se der certo, já marca o arquivo em `supabase/migrations_aplicadas.txt` — não precisa fazer isso manualmente. Se `pg8000` não estiver instalado no ambiente, rode `pip install -q pg8000` primeiro.

Depois de rodar qualquer migration nova que crie tabela (`create table`), atualizar a lista de tabelas em `C:\Users\ricar\.claude\scheduled-tasks\backup-casa-em-dia\SKILL.md` (regra já documentada na lição #12 de `verify-casa-em-dia`).

### 2. Verificação
Execute o checklist completo de `verify-casa-em-dia\SKILL.md`. Se a mudança recente tocou em calendário/feriados/ciclo/conflito de agenda, execute também `verify-calendario\SKILL.md`. Corrija o que for seguro corrigir sozinho; o que não for, vire um item em "⚠️ precisa de decisão sua" no relatório final.

### 3. Versão do service worker
```bash
grep "const CACHE" sw.js
git diff --stat -- index.html js/ sw.js manifest.json
```
Se `index.html`, qualquer arquivo em `js/` ou `manifest.json` mudaram desde o último commit e o número de `CACHE` em `sw.js` **não** foi incrementado nesta mesma sessão, incremente agora (ex: `casa-em-dia-v5` → `casa-em-dia-v6`). Sem isso, usuários com o app já instalado continuam vendo a versão antiga em cache.

### 4. Publicar (git)
```bash
git status --short
git add -A
git commit -m "<resumo objetivo do que mudou, em português>"
git push
```
Se `git status --short` não mostrar nada, não há nada novo pra publicar — não crie commit vazio.

### 5. Relatório final
Mesmo formato das skills de verificação:
```
✅ O que está OK: ...
🔧 O que rodei/corrigi agora: ... (migrations aplicadas, versão do sw.js, commit feito)
⚠️ O que precisa de uma decisão sua: ...
```
Inclua sempre: quais migrations rodaram nesta execução (ou "nenhuma pendente"), se o commit foi feito e o hash/resumo, e se a verificação achou algo.

## Quando NÃO rodar automaticamente
Mesmo esta skill sendo "automática", sempre **avise antes de** `git push` se for a primeira vez na sessão — depois disso, pushes seguintes na mesma sessão de trabalho não precisam de nova confirmação, a menos que o usuário tenha pedido explicitamente pra revisar cada passo. Nunca rode migrations que alterem dados reais existentes (`update`/`delete` em massa) sem mostrar antes o que o SQL faz — `alter table add column` e `create table` são seguros de rodar direto; `update`/`delete` sem `where` por id específico merecem uma frase de aviso antes.

## Registrando uma lição nova
Se esta skill encontrar um problema no próprio pipeline (ex: `pg8000` falha por algum motivo novo, git push pede merge, sw.js já estava na versão certa e eu incrementei à toa), registre em `lessons.md` desta mesma pasta (crie o arquivo se não existir, seguindo o padrão de `verify-casa-em-dia\lessons.md`) e adicione um passo correspondente nesta checklist.
