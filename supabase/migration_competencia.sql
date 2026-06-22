-- Migração: mês de competência separado da data de vencimento real.
-- Rode no SQL Editor do Supabase (projeto aynteobslozppsjxgheo).

-- fixed_bills: marca quais contas vencem no mês SEGUINTE ao mês de competência
-- (ex: água/luz/internet/IPTU fechados em junho mas com boleto vencendo em julho)
alter table public.fixed_bills
  add column if not exists vence_mes_seguinte boolean not null default false;

-- bill_payments: mês de competência (a despesa "pertence" a esse mês),
-- independente do due_date (que pode cair no mês seguinte)
alter table public.bill_payments
  add column if not exists competencia text;

-- backfill: até agora due_date sempre coincidia com o mês de competência
update public.bill_payments
  set competencia = to_char(due_date, 'YYYY-MM')
  where competencia is null;

alter table public.bill_payments
  alter column competencia set not null;

select 'Migração de competência concluída' as resultado;
