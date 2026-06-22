-- Casa em Dia: calendários individuais (cada um só vê o próprio, exceto quando marcado
-- como "compromisso conjunto") + marcação diária de menstruação.
-- Rode este script inteiro no SQL Editor do Supabase (cole tudo e clique em "Run").

-- ============ EVENTS: dono + conjunto ============
alter table public.events add column if not exists conjunto boolean not null default false;

-- backfill de dados antigos (criados antes dessa mudança, quando não existia "dono"):
-- eventos tipo='trabalho' eram só do admin -> dono = admin, não conjunto.
-- eventos tipo='pessoal' eram visíveis pros dois -> marca como conjunto, pra ninguém perder visibilidade de repente.
update public.events set owner_id = (select id from public.profiles where role = 'admin' limit 1)
  where owner_id is null and tipo = 'trabalho';
update public.events set owner_id = (select id from public.profiles where role = 'admin' limit 1), conjunto = true
  where owner_id is null and tipo = 'pessoal';

drop policy if exists "Read events by role" on public.events;
drop policy if exists "Insert personal events or admin" on public.events;
drop policy if exists "Update personal events or admin" on public.events;
drop policy if exists "Delete personal events or admin" on public.events;

create policy "Read own or conjunto events" on public.events for select to authenticated using (
  owner_id = auth.uid() or conjunto = true
);
create policy "Insert own events" on public.events for insert to authenticated with check (
  owner_id = auth.uid()
);
create policy "Update own or conjunto events" on public.events for update to authenticated using (
  owner_id = auth.uid() or conjunto = true
) with check (
  owner_id = auth.uid() or conjunto = true
);
create policy "Delete own or conjunto events" on public.events for delete to authenticated using (
  owner_id = auth.uid() or conjunto = true
);

-- ============ MENSTRUAÇÃO: marcação dia a dia ============
create table if not exists public.dias_menstruacao (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  created_at timestamptz not null default now(),
  unique (user_id, data)
);

alter table public.dias_menstruacao enable row level security;

drop policy if exists "Owner all dias_menstruacao" on public.dias_menstruacao;
create policy "Owner all dias_menstruacao" on public.dias_menstruacao
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============ LIMPEZA ============
-- substituído por dias_menstruacao (marcação dia a dia, em vez de "início + duração estimada").
drop table if exists public.ciclos_menstruais;

select 'Migração de calendário individual + dias de menstruação concluída' as resultado;
