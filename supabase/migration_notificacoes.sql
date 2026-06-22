-- Casa em Dia: notificações push (lembrete de contas/prazos, eventos do calendário, conflitos de agenda).
-- Rode este script inteiro no SQL Editor do Supabase (cole tudo e clique em "Run").

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Owner all push_subscriptions" on public.push_subscriptions;
create policy "Owner all push_subscriptions" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- log de notificações já enviadas, pra não duplicar (só o backend com service_role acessa, por isso RLS sem nenhuma policy).
create table if not exists public.notificacoes_enviadas (
  chave text primary key,
  enviado_em timestamptz not null default now()
);

alter table public.notificacoes_enviadas enable row level security;

select 'Migração de notificações concluída' as resultado;
