-- Casa em Dia: tabela para silenciar lembretes de evento específico.
-- O usuário clica em "Desligar avisos" na notificação e não recebe mais
-- lembretes daquele evento (por hora) sem cancelar o evento em si.
-- Rode este script no SQL Editor do Supabase ou via scripts/rodar_migration.py.

create table if not exists public.eventos_silenciados (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.eventos_silenciados enable row level security;

drop policy if exists "Owner all eventos_silenciados" on public.eventos_silenciados;
create policy "Owner all eventos_silenciados" on public.eventos_silenciados
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

select 'Migração eventos_silenciados concluída' as resultado;
