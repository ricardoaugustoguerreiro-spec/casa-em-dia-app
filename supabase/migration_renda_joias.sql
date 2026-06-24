-- Permite upsert seguro de transações sincronizadas do Sistema de Joias
-- (cada cobrança recebida só entra uma vez, identificada por raw->>'cobranca_id').
create unique index if not exists transactions_cobranca_id_uniq
  on transactions ((raw->>'cobranca_id'))
  where raw->>'cobranca_id' is not null;
