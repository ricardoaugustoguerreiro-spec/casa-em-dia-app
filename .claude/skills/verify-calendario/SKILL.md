---
name: verify-calendario
description: Verifica o módulo de Calendário do Casa em Dia (feriados, permissões pessoal×trabalho, detecção de conflito, fuso horário, import de prazos, fase da lua, ciclo menstrual da Jéssica). Gera relatório, corrige o que for seguro, e registra cada erro encontrado em lessons.md como item permanente — igual ao padrão da skill verify-casa-em-dia, mas focada só no calendário. Use quando o usuário disser "o calendário não está certo", "feriado errado", "conflito não apareceu", "Jéssica conseguiu editar trabalho", "fase da lua errada", "ciclo errado", ou antes de declarar qualquer mudança no calendário como concluída.
---

# Verificação do Calendário — Casa em Dia

Sub-skill de [[verify-casa-em-dia]], focada só no módulo de calendário (`js/feriados.js` + a parte de calendário em `js/app.js` + a seção `<!-- CALENDÁRIO -->` em `index.html`). Leia `lessons.md` desta pasta antes de começar — mesma regra: todo erro novo gera entrada em `lessons.md` E item correspondente no checklist abaixo.

## Checklist de verificação

### 1. Cálculo de feriados está certo
```bash
python3 -c "
def pascoa(ano):
    a=ano%19; b=ano//100; c=ano%100; d=b//4; e=b%4; f=(b+8)//25; g=(b-f+1)//3
    h=(19*a+b-d-g+15)%30; i=c//4; k=c%4; l=(32+2*e+2*i-h-k)%7; m=(a+11*h+22*l)//451
    mes=(h+l-7*m+114)//31; dia=(h+l-7*m+114)%31+1
    return ano,mes,dia
for ano in range(2024,2030): print(ano, pascoa(ano))
"
```
Compare com datas reais conhecidas (ex: Páscoa 2026 = 5 de abril). Se não bater, o algoritmo de Meeus/Jones/Butcher em `js/feriados.js` foi alterado incorretamente.

### 2. Fuso horário não desloca dia/hora dos eventos (lição verificada em 21/06/2026 — não é bug, mas pode virar um se o código mudar)
O app escreve e lê `starts_at`/`ends_at` sempre como STRING, nunca via `new Date(...).toLocaleString()`. Se algum dia alguém adicionar uma conversão de timezone real (ex: `new Date(ev.starts_at).getHours()` em vez de `ev.starts_at.slice(11,16)`), isso PODE introduzir deslocamento de dia/hora, porque o banco grava em UTC e o app não informa o fuso do usuário ao escrever. Teste real (rodar de novo se mudar essa parte do código):
```bash
SECFILE="/h/Meu Drive/FINANÇAS/Casa-em-Dia-App/_segredos-nao-compartilhar/supabase.txt"
URL=$(grep "Project URL" "$SECFILE" | sed 's/Project URL: //')
KEY=$(awk '/Service_role key/{getline; print}' "$SECFILE")
RESP=$(curl -s -X POST "$URL/rest/v1/events" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"title":"TESTE_APAGAR","starts_at":"2026-06-22T09:00:00","ends_at":"2026-06-22T10:00:00","tipo":"pessoal"}')
echo "$RESP"
ID=$(echo "$RESP" | python -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
curl -s -X DELETE "$URL/rest/v1/events?id=eq.$ID" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```
Esperado: `starts_at` volta exatamente `2026-06-22T09:00:00+00:00` — se vier com hora diferente de `09:00`, há um bug de fuso introduzido.

### 3. RLS: calendário individual — cada um só vê o próprio evento, exceto quando `conjunto=true` (mudou em 22/06/2026)
O modelo antigo (RLS por `tipo='trabalho'`+admin) foi substituído por dono+conjunto: `owner_id = auth.uid() or conjunto = true`. Confirme:
```bash
grep -A5 "Read own or conjunto events\|Insert own events" "/h/Meu Drive/FINANÇAS/Casa-em-Dia-App/supabase/migration_calendario_individual.sql"
```
Teste real: como Jéssica (ou simulando), um evento criado por Ricardo com `conjunto=false` NÃO deve aparecer pra ela; com `conjunto=true` deve aparecer pros dois. `js/app.js` → `salvarEvento()` deve sempre mandar `owner_id: this.uid` em eventos novos (nunca deixar o cliente mandar outro `owner_id`), e `podeEditar(ev)` deve ser `ev.owner_id === this.uid || ev.conjunto` — não existe mais gating por `isAdmin`/`tipo` na edição.

### 4. Detecção de conflito usa overlap de horário real, não só "mesmo dia"
Releia `temConflito(dataISO)` em `js/app.js` — desde 22/06/2026 compara QUALQUER par de eventos visíveis (não só pessoal×trabalho) com a fórmula de overlap (`a.starts < b.ends && b.starts < a.ends`). Como cada usuário só carrega os próprios eventos + conjuntos (RLS), o conflito calculado no cliente já reflete só o que aquele usuário pode ver — não precisa filtrar por tipo.

### 5. Import de prazos (JSON) não duplica ao reimportar o mesmo arquivo
A função `importarPrazos` deve buscar por `ref_externa` antes de inserir (`select ... eq("ref_externa", item.id)`) e fazer `update` se já existir, `insert` só se não existir. Teste: importar o mesmo arquivo duas vezes e confirmar que a contagem de eventos não dobra.

### 6. Visual: grade do ano não quebra com mês começando em dias diferentes da semana
`diasDoMes(mesIndex)` usa `new Date(ano, mes, 1).getDay()` pra calcular células vazias antes do dia 1. Teste rápido: confirme visualmente que Janeiro e Fevereiro (meses com início de semana diferente) renderizam sem desalinhar a grade de 7 colunas.

### 7. Fase da lua (adicionado 21/06/2026) está calculada certo pra qualquer ano
`faseLua()`/`luaMarcante()` em `js/lua.js` usam idade da lua a partir de uma lua nova de referência (06/01/2000 18:14 UTC) + ciclo sinódico de 29.530588853 dias — não depende de tabela cadastrada, então funciona em qualquer ano passado/futuro. Teste rápido:
```bash
node -e "
const ref = Date.UTC(2000,0,6,18,14), sin = 29.530588853;
function fase(iso){ const [y,m,d]=iso.split('-').map(Number); const dt=Date.UTC(y,m-1,d,12); const idade=(((dt-ref)/86400000)%sin+sin)%sin; return idade.toFixed(1); }
console.log('2026-06-21 (deveria ser por volta de nova/cheia, confira num site de fases da lua):', fase('2026-06-21'));
"
```
Compare o resultado com um calendário lunar real (ex. timeanddate.com) pra essa data — se a fase relatada (`luaDoDia(dataISO).nome`) não bater com a realidade em mais de ~1 dia de diferença, o algoritmo ou a data de referência foi alterada incorretamente.

### 8. Ciclo menstrual (redesenhado 22/06/2026): marcação dia a dia, não "início + duração estimada"
- A tabela `ciclos_menstruais` (data_inicio fixa) foi REMOVIDA. Hoje a fonte de verdade é `dias_menstruacao` (um registro por dia marcado) — a Jéssica toca no dia, no painel do dia, em "Marcar como dia de menstruação". Se um dia marcado não aparecer destacado no calendário, confirme primeiro se o registro existe em `dias_menstruacao` antes de suspeitar do cálculo.
- `streaksMenstruacao` (getter em `js/app.js`) agrupa os dias marcados em sequências consecutivas; `configCiclo` deriva `duracaoCiclo` (média dos intervalos entre o início de cada sequência) e `duracaoPeriodo` (média da duração das sequências) — só fica "baseado em histórico" com 2+ sequências registradas; com menos que isso, usa o padrão ajustável em `duracaoCicloPadrao` (client-side, não persiste no banco, é só uma estimativa de fallback).
- `faseCicloDoDia(dataISO)` retorna `"menstrual"` direto de `dias_menstruacao` quando o dia está logado (exato, não previsto) — só usa a fórmula `ovulacaoDia = duracaoCiclo - 14` pra prever período fértil/ovulação em dias futuros ou sem registro direto.
- As tabelas `dias_menstruacao` e `registros_intimos` (`supabase/migration_ciclo.sql` + `migration_calendario_individual.sql`) são dados sensíveis e devem ficar SEMPRE com RLS `using (auth.uid() = user_id)` — nunca abrir pra "all auth" como as tabelas financeiras. Confirme isso direto no SQL Editor (`select * from pg_policies where tablename in ('dias_menstruacao','registros_intimos')`) sempre que tocar nessa parte.
- Essas seções só devem aparecer no HTML quando `!isAdmin` — Ricardo (admin) nunca deve ver o painel de ciclo nem o registro íntimo, mesmo que ele logue.

### 9. Destaque do dia de hoje
O grid do calendário deve sempre marcar visualmente a data de hoje (`ehHoje(dataISO)` em `js/app.js`, comparando com `hojeISO()`) com um anel (`ring-2 ring-rose-400`), mesmo quando nenhum dia está selecionado. Teste: abrir o calendário sem clicar em nada e confirmar que o dia atual já aparece destacado, sem precisar procurar.

## Depois de verificar: o relatório
Mesmo formato da skill principal:
```
✅ O que está OK: ...
🔧 O que corrigi agora: ...
⚠️ O que precisa de uma decisão sua: ...
```
