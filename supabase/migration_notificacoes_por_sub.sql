-- Casa em Dia: muda idempotência de notificações de "por chave global" para
-- "por (chave, sub_id)", permitindo retry individual por dispositivo.
-- Antes: se dispositivo A recebia, a chave era marcada e dispositivo B nunca recebia.
-- Depois: cada subscription tem sua própria linha de controle.
-- Rode este script no SQL Editor do Supabase ou via scripts/rodar_migration.py.

-- Apaga a tabela antiga (as chaves antigas causariam duplicidade pois mudam de formato)
drop table if exists public.notificacoes_enviadas;

-- Recria com chave composta (chave, sub_id)
create table public.notificacoes_enviadas (
  chave      text not null,
  sub_id     uuid not null,
  enviado_em timestamptz not null default now(),
  primary key (chave, sub_id)
);

-- RLS ligado sem nenhuma policy: só o service_role (backend) acessa — igual à versão anterior.
alter table public.notificacoes_enviadas enable row level security;

select 'Migração notificacoes_por_sub concluída' as resultado;
