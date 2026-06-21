---
name: verify-calendario
description: Verifica o módulo de Calendário do Casa em Dia (feriados, permissões pessoal×trabalho, detecção de conflito, fuso horário, import de prazos). Gera relatório, corrige o que for seguro, e registra cada erro encontrado em lessons.md como item permanente — igual ao padrão da skill verify-casa-em-dia, mas focada só no calendário. Use quando o usuário disser "o calendário não está certo", "feriado errado", "conflito não apareceu", "Jéssica conseguiu editar trabalho", ou antes de declarar qualquer mudança no calendário como concluída.
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

### 3. RLS: Jéssica (não-admin) não pode criar/editar evento `tipo='trabalho'`
```bash
# confirme lendo a policy diretamente no SQL Editor do Supabase, ou:
grep -A5 "Insert personal events or admin" "/h/Meu Drive/FINANÇAS/Casa-em-Dia-App/supabase/migration.sql"
```
A policy deve exigir `tipo = 'pessoal' or public.is_admin()`. Também confirme no `js/app.js` que `salvarEvento()` bloqueia no cliente (`if (f.tipo === "trabalho" && !this.isAdmin) return alert(...)`) — dupla camada (UI + banco), nenhuma das duas deve faltar.

### 4. Detecção de conflito usa overlap de horário real, não só "mesmo dia"
Releia `temConflito(dataISO)` em `js/app.js` — deve comparar `starts_at`/`ends_at` de pares pessoal×trabalho com a fórmula de overlap (`p.starts < t.ends && t.starts < p.ends`), não só checar se existem eventos dos dois tipos no mesmo dia (isso geraria falso positivo pra dois eventos no mesmo dia em horários diferentes).

### 5. Import de prazos (JSON) não duplica ao reimportar o mesmo arquivo
A função `importarPrazos` deve buscar por `ref_externa` antes de inserir (`select ... eq("ref_externa", item.id)`) e fazer `update` se já existir, `insert` só se não existir. Teste: importar o mesmo arquivo duas vezes e confirmar que a contagem de eventos não dobra.

### 6. Visual: grade do ano não quebra com mês começando em dias diferentes da semana
`diasDoMes(mesIndex)` usa `new Date(ano, mes, 1).getDay()` pra calcular células vazias antes do dia 1. Teste rápido: confirme visualmente que Janeiro e Fevereiro (meses com início de semana diferente) renderizam sem desalinhar a grade de 7 colunas.

## Depois de verificar: o relatório
Mesmo formato da skill principal:
```
✅ O que está OK: ...
🔧 O que corrigi agora: ...
⚠️ O que precisa de uma decisão sua: ...
```
