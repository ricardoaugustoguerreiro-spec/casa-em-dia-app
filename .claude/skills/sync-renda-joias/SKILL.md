---
name: sync-renda-joias
description: Sincroniza automaticamente os pagamentos recebidos no Sistema de Joias (Alfa 3D) como renda no Casa em Dia — verificação, troubleshooting e como recriar a automação se ela parar
---

# Sincronização de renda: Sistema de Joias → Casa em Dia

Esta skill existe pra você (ou uma sessão futura) verificar/recriar a ponte automática entre os dois sistemas sem precisar redescobrir o esquema do JSON de backup de novo.

## O que essa automação faz

O Ricardo administra um negócio de joias (Sistema "Alfa 3D", projeto totalmente separado do Casa em Dia). Quando ele recebe um pagamento de cliente lá, isso deve aparecer como **renda** no Casa em Dia automaticamente — sem ninguém precisar lançar manualmente.

**Não confundir com lançamento manual de renda**: o botão "+ Adicionar renda" na aba Renda do Casa em Dia é só pra renda que NÃO vem do Sistema de Joias (ex: recebimentos da Jéssica). Pagamento de cliente de joia é só desse sync — nunca lance duplicado na mão.

## Fonte dos dados (read-only, nunca escreve no Sistema de Joias)

```
H:\Meu Drive\Claud Sistema\ARQUIVOS\backups\auto\backup_auto.json
```

Esse arquivo já é gerado automaticamente pelo próprio Sistema de Joias a cada poucas horas. Estrutura relevante:

```json
{
  "savedAt": "...",
  "projects": [...],
  "cobrancas": [
    {
      "id": "cb1782223107598",
      "cliente": "ALEX",
      "data": "2026-06-23T13:58:27.598Z",
      "total": 100,
      "status": "recebido",          // ou "emitido" (cobrado mas ainda não pago)
      "dataRecebimento": "2026-06-23" // só existe quando status = recebido
    }
  ]
}
```

**Regra de negócio**: só `cobrancas` com `status == "recebido"` E `dataRecebimento` preenchida contam como renda real. `"emitido"` é cobrança enviada mas ainda não paga — não conta.

## Destino

Tabela `public.transactions` do Casa em Dia, com:
- `kind = 'renda'`
- `source = 'sistema_joias'`
- `pessoa = 'ricardo'` (sempre — renda do Ricardo é SEMPRE deste sync, nunca lançada manualmente; renda manual na aba Renda é sempre `pessoa='jessica'`)
- `date` = `dataRecebimento` da cobrança
- `description` = `"Joias - {cliente}"`
- `raw->>'cobranca_id'` = id da cobrança (chave de upsert — índice único em `supabase/migration_renda_joias.sql`, garante que nunca duplica)

**Proteção contra sobrescrever edição manual**: se o Ricardo ou a Jéssica editarem esse lançamento dentro do app (campo `edited` vira `true` automaticamente), o script **nunca mais atualiza** esse registro — só cria novos e atualiza os que ainda não foram tocados.

## O script

`Casa-em-Dia-App\scripts\sync_renda_joias.py` — lê o JSON, conecta no Postgres do Casa em Dia via `pg8000` (senha em `_segredos-nao-compartilhar\supabase.txt`), faz o upsert. Roda em segundos, imprime quantos novos/atualizados/ignorados.

```bash
cd "H:\Meu Drive\FINANÇAS\Casa-em-Dia-App"
python scripts/sync_renda_joias.py
```

## A automação periódica

Roda via **Agendador de Tarefas do Windows** (NÃO uma tarefa do Claude Code — decisão consciente, porque esse script lê um arquivo local do Drive e o Ricardo já pediu explicitamente pra não depender do Claude Code estar aberto pra automações deste projeto):

- Nome da tarefa: `CasaEmDia-SyncRendaJoias`
- Intervalo: a cada 30 minutos, infinitamente
- Executa: `python "H:\Meu Drive\FINANÇAS\Casa-em-Dia-App\scripts\sync_renda_joias.py"`

### Verificar se está rodando
```powershell
Get-ScheduledTask -TaskName "CasaEmDia-SyncRendaJoias" | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName "CasaEmDia-SyncRendaJoias" | Select-Object LastRunTime, LastTaskResult, NextRunTime
```
`LastTaskResult` deve ser `0` (sucesso). Se for diferente, o script falhou silenciosamente — rode manualmente (comando acima) pra ver o erro.

### Recriar a tarefa, se ela for removida ou parar de existir
```powershell
$pythonPath = (Get-Command python).Source
$scriptPath = "H:\Meu Drive\FINANÇAS\Casa-em-Dia-App\scripts\sync_renda_joias.py"
$action = New-ScheduledTaskAction -Execute $pythonPath -Argument "`"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName "CasaEmDia-SyncRendaJoias" -Action $action -Trigger $trigger -Description "Sincroniza cobrancas recebidas do Sistema de Joias como renda no Casa em Dia" -Force
```
Nota: `-RepetitionDuration ([TimeSpan]::MaxValue)` dá erro de XML fora do intervalo aceito pelo Agendador — usar `(New-TimeSpan -Days 3650)` (~10 anos) em vez disso.

## Troubleshooting

**Sync não acha o arquivo de backup**: confirme que `H:\Meu Drive\Claud Sistema\ARQUIVOS\backups\auto\backup_auto.json` existe e tem `savedAt` recente — se não, o problema é no Sistema de Joias (parou de gerar backup), não no Casa em Dia.

**Pagamento não apareceu na aba Renda depois de receber no Sistema de Joias**: espere até 30min (intervalo do agendamento) ou rode o script manualmente. Se ainda não aparecer, confirme no JSON que a cobrança tem `status: "recebido"` E `dataRecebimento` preenchida — cobrança só "emitida" não conta de propósito.

**`ModuleNotFoundError: No module named 'pg8000'`**: `pip install pg8000` (mesmo ambiente Python usado pelos outros scripts deste projeto).

**Valor duplicado na aba Renda**: não deveria acontecer (índice único em `raw->>'cobranca_id'` impede). Se acontecer mesmo assim, é sinal de que o índice único foi perdido — rode `supabase/migration_renda_joias.sql` de novo.
