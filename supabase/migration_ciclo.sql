-- Casa em Dia: ciclo menstrual + registro de relações (controle pessoal da Jéssica).
-- Rode este script inteiro no SQL Editor do Supabase (cole tudo e clique em "Run").
-- Tabelas novas, privadas por padrão (RLS: só a própria pessoa lê/edita os próprios registros).

create table if not exists public.ciclos_menstruais (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data_inicio date not null,
  duracao_periodo integer not null default 5,
  duracao_ciclo integer not null default 28,
  notas text,
  created_at timestamptz not null default now()
);

create table if not exists public.registros_intimos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  preservativo boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  unique (user_id, data)
);

alter table public.ciclos_menstruais enable row level security;
alter table public.registros_intimos enable row level security;

drop policy if exists "Owner all ciclos_menstruais" on public.ciclos_menstruais;
create policy "Owner all ciclos_menstruais" on public.ciclos_menstruais
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Owner all registros_intimos" on public.registros_intimos;
create policy "Owner all registros_intimos" on public.registros_intimos
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

select 'Migração do ciclo concluída' as resultado;
