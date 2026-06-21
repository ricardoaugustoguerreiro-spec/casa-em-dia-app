-- Migração do Casa em Dia: Lovable Cloud -> Supabase próprio
-- Rode este script inteiro no SQL Editor do seu novo projeto Supabase (cole tudo e clique em "Run").
-- Ele recria: tipos, tabelas, funções, triggers, políticas de segurança (RLS) e os dados já existentes.

-- ============ TIPOS ============
do $$ begin
  create type category_kind as enum ('fixa','variavel','diaria','renda');
exception when duplicate_object then null;
end $$;

-- ============ TABELAS ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Sem nome',
  color text not null default '#7c3aed',
  role text not null default 'membro', -- 'admin' ou 'membro'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind category_kind not null default 'variavel',
  keywords text[] not null default '{}',
  color text not null default '#64748b',
  icon text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fixed_bills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null default 0,
  due_day integer not null,
  category_id uuid references public.categories(id),
  active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  fixed_bill_id uuid not null references public.fixed_bills(id) on delete cascade,
  due_date date not null,
  paid_at timestamptz,
  amount numeric,
  status text not null default 'pendente',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  description text not null,
  amount numeric not null,
  category_id uuid references public.categories(id),
  source text not null default 'manual',
  account text,
  kind category_kind not null default 'variavel',
  import_id uuid,
  raw jsonb,
  edited boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  bank text,
  count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  owner_id uuid,
  location text,
  notes text,
  color text,
  tipo text not null default 'pessoal', -- 'pessoal' ou 'trabalho'
  origem text not null default 'manual', -- 'manual' ou 'formulario_vinculado'
  ref_externa text,
  status_trabalho text, -- 'aberto' | 'concluido' | 'atrasado' (só para tipo = trabalho)
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount numeric not null,
  as_of date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.dismissed_insights (
  id uuid primary key default gen_random_uuid(),
  signature text not null,
  type text not null,
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid
);

-- ============ FUNÇÕES E TRIGGERS ============
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  user_count int;
  default_name text;
  default_color text;
  default_role text;
begin
  select count(*) into user_count from public.profiles;
  if user_count = 0 then
    default_name := 'Ricardo'; default_color := '#2563eb'; default_role := 'admin';
  elsif user_count = 1 then
    default_name := 'Jéssica'; default_color := '#db2777'; default_role := 'membro';
  else
    default_name := coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1));
    default_color := '#7c3aed'; default_role := 'membro';
  end if;
  insert into public.profiles (id, display_name, color, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', default_name), default_color, default_role);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

drop trigger if exists t_profiles_upd on public.profiles;
create trigger t_profiles_upd before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists t_categories_upd on public.categories;
create trigger t_categories_upd before update on public.categories for each row execute function public.touch_updated_at();
drop trigger if exists t_fixed_bills_upd on public.fixed_bills;
create trigger t_fixed_bills_upd before update on public.fixed_bills for each row execute function public.touch_updated_at();
drop trigger if exists t_bill_payments_upd on public.bill_payments;
create trigger t_bill_payments_upd before update on public.bill_payments for each row execute function public.touch_updated_at();
drop trigger if exists t_transactions_upd on public.transactions;
create trigger t_transactions_upd before update on public.transactions for each row execute function public.touch_updated_at();
drop trigger if exists t_events_upd on public.events;
create trigger t_events_upd before update on public.events for each row execute function public.touch_updated_at();

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.fixed_bills enable row level security;
alter table public.bill_payments enable row level security;
alter table public.transactions enable row level security;
alter table public.imports enable row level security;
alter table public.events enable row level security;
alter table public.balances enable row level security;
alter table public.dismissed_insights enable row level security;

create or replace function public.is_admin()
returns boolean language sql security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- (idempotente: remove políticas antigas antes de recriar, pra poder rodar este script mais de uma vez sem erro)
drop policy if exists "Authenticated read profiles" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "All auth read categories" on public.categories;
drop policy if exists "All auth write categories" on public.categories;
drop policy if exists "All auth update categories" on public.categories;
drop policy if exists "All auth delete categories" on public.categories;
drop policy if exists "All auth read fixed_bills" on public.fixed_bills;
drop policy if exists "All auth insert fixed_bills" on public.fixed_bills;
drop policy if exists "All auth update fixed_bills" on public.fixed_bills;
drop policy if exists "All auth delete fixed_bills" on public.fixed_bills;
drop policy if exists "All auth read bill_payments" on public.bill_payments;
drop policy if exists "All auth insert bill_payments" on public.bill_payments;
drop policy if exists "All auth update bill_payments" on public.bill_payments;
drop policy if exists "All auth delete bill_payments" on public.bill_payments;
drop policy if exists "Read transactions by role" on public.transactions;
drop policy if exists "All auth insert transactions" on public.transactions;
drop policy if exists "All auth update transactions" on public.transactions;
drop policy if exists "All auth delete transactions" on public.transactions;
drop policy if exists "All auth read imports" on public.imports;
drop policy if exists "All auth insert imports" on public.imports;
drop policy if exists "All auth delete imports" on public.imports;
drop policy if exists "Read events by role" on public.events;
drop policy if exists "Insert personal events or admin" on public.events;
drop policy if exists "Update personal events or admin" on public.events;
drop policy if exists "Delete personal events or admin" on public.events;
drop policy if exists "All auth read balances" on public.balances;
drop policy if exists "All auth insert balances" on public.balances;
drop policy if exists "All auth update balances" on public.balances;
drop policy if exists "All auth delete balances" on public.balances;
drop policy if exists "All auth read dismissed" on public.dismissed_insights;
drop policy if exists "All auth insert dismissed" on public.dismissed_insights;
drop policy if exists "All auth delete dismissed" on public.dismissed_insights;

-- profiles
create policy "Authenticated read profiles" on public.profiles for select to authenticated using (true);
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- categories / fixed_bills / bill_payments / transactions: liberado pra todo autenticado (casa + cartões = visão da Jéssica também)
create policy "All auth read categories" on public.categories for select to authenticated using (true);
create policy "All auth write categories" on public.categories for insert to authenticated with check (true);
create policy "All auth update categories" on public.categories for update to authenticated using (true) with check (true);
create policy "All auth delete categories" on public.categories for delete to authenticated using (true);

create policy "All auth read fixed_bills" on public.fixed_bills for select to authenticated using (true);
create policy "All auth insert fixed_bills" on public.fixed_bills for insert to authenticated with check (true);
create policy "All auth update fixed_bills" on public.fixed_bills for update to authenticated using (true) with check (true);
create policy "All auth delete fixed_bills" on public.fixed_bills for delete to authenticated using (true);

create policy "All auth read bill_payments" on public.bill_payments for select to authenticated using (true);
create policy "All auth insert bill_payments" on public.bill_payments for insert to authenticated with check (true);
create policy "All auth update bill_payments" on public.bill_payments for update to authenticated using (true) with check (true);
create policy "All auth delete bill_payments" on public.bill_payments for delete to authenticated using (true);

-- transactions: Ricardo (admin) vê tudo; Jéssica vê tudo, EXCETO lançamentos da conta "Inter" (MEI do Ricardo)
create policy "Read transactions by role" on public.transactions for select to authenticated using (
  public.is_admin() or coalesce(account, '') <> 'Inter'
);
create policy "All auth insert transactions" on public.transactions for insert to authenticated with check (true);
create policy "All auth update transactions" on public.transactions for update to authenticated using (true) with check (true);
create policy "All auth delete transactions" on public.transactions for delete to authenticated using (true);

create policy "All auth read imports" on public.imports for select to authenticated using (true);
create policy "All auth insert imports" on public.imports for insert to authenticated with check (true);
create policy "All auth delete imports" on public.imports for delete to authenticated using (true);

-- events: pessoal liberado pros dois; trabalho só leitura pra não-admin
create policy "Read events by role" on public.events for select to authenticated using (
  tipo = 'pessoal' or public.is_admin()
);
create policy "Insert personal events or admin" on public.events for insert to authenticated with check (
  tipo = 'pessoal' or public.is_admin()
);
create policy "Update personal events or admin" on public.events for update to authenticated using (
  tipo = 'pessoal' or public.is_admin()
) with check (
  tipo = 'pessoal' or public.is_admin()
);
create policy "Delete personal events or admin" on public.events for delete to authenticated using (
  tipo = 'pessoal' or public.is_admin()
);

create policy "All auth read balances" on public.balances for select to authenticated using (true);
create policy "All auth insert balances" on public.balances for insert to authenticated with check (true);
create policy "All auth update balances" on public.balances for update to authenticated using (true) with check (true);
create policy "All auth delete balances" on public.balances for delete to authenticated using (true);

create policy "All auth read dismissed" on public.dismissed_insights for select to authenticated using (true);
create policy "All auth insert dismissed" on public.dismissed_insights for insert to authenticated with check (true);
create policy "All auth delete dismissed" on public.dismissed_insights for delete to authenticated using (true);

-- ============ DADOS (categorias, contas fixas, pagamentos, transações) ============
insert into public.categories (id, name, kind, keywords, color, icon, created_at, updated_at) values
('55991817-7c9b-4ffb-9b07-eaf9c787c1bd','Água','fixa','{agua,sabesp,copasa,saneamento}','#38bdf8',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('eb676017-372f-42f2-8d2f-438b430585d2','Alimentação','diaria','{ifood,rappi,restaurant,lanchonete,padaria,lanche,burger,pizza,mcdonald,subway,bk}','#f59e0b','utensils','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('f134c15f-20fb-4fad-8817-292171bebd58','Carro','fixa','{"parcela carro","financiamento veiculo","prestacao carro"}','#dc2626',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('c2c59015-f61f-4326-8e62-1d0972325da9','Cartão Itaú','variavel','{itau,"cartao itau"}','#ea580c',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('d12f7a54-988c-4197-8569-6d9862ef4551','Casa','fixa','{aluguel,condominio,"financiamento casa","prestacao casa"}','#8b5cf6','home','2026-06-21 14:40:04.913768+00','2026-06-21 14:40:04.913768+00'),
('bf4ccd16-a0ed-4cfb-a929-1bb3b2bd4f98','Educação','variavel','{curso,livro,udemy,alura,escola,faculdade,mensalidade}','#06b6d4','book','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('fc0facfc-eee6-4167-8204-6eef0d7a33b4','Internet','fixa','{internet,"vivo fibra","claro net","net virtua",wifi}','#6366f1',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('ad757c4b-24f1-46d3-ac41-db0cb0e3c550','IPTU','fixa','{iptu}','#94a3b8',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('5844c9d1-ce61-4a12-b4a1-f78b584609de','IPVA Carro','fixa','{ipva}','#f97316',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('d39b8fd0-c3ca-4af1-9c4f-99daa1349431','Lazer','variavel','{netflix,spotify,disney,prime,hbo,cinema,show,ingresso,steam,playstation}','#ec4899','gamepad','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('36e430c1-6cd9-424f-8ca8-f97ea3912c90','Licenciamento','fixa','{licenciamento,detran}','#fb923c',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('864d1905-bc13-4191-ba6d-7a9084e63525','Luz','fixa','{luz,energia,cemig,enel,copel,energisa,light}','#eab308',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('cdd1f951-9497-438d-89b8-6f2dc8fe223e','MEI','fixa','{mei,"das mei","simples nacional"}','#f59e0b',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('04029d2d-04aa-4773-89a0-5ef32aa4ed6f','Mercado','diaria','{mercado,supermercado,atacad,assai,carrefour,extra,"pao de acucar",hortifruti,sacolao}','#16a34a','shopping-cart','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('051f0c27-55a5-4a75-b33e-6428290740dc','Nubank','variavel','{nubank,"nu pagamentos"}','#8b5cf6',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('dece8858-08e1-4528-a982-1e763ed963c1','Outros','variavel','{}','#64748b','circle','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('9f3208c7-0106-46d8-a001-dc56a500a273','Porto','variavel','{"porto seguro","porto bank","porto cartao"}','#14b8a6',null,'2026-06-21 14:40:15.530002+00','2026-06-21 14:40:15.530002+00'),
('bf404375-389b-4729-be6d-7dae0f7daf62','Renda','renda','{salario,salário,pagamento,deposito,"transferencia recebida","pix recebido"}','#10b981','wallet','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('d8f65155-b7d0-4a77-ac78-7168b0cdc657','Saúde','variavel','{farmacia,drogaria,drogasil,panvel,raia,consult,hospital,clinica,exame,laboratorio}','#ef4444','heart-pulse','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00'),
('e8ed6dba-134f-40b8-b2b9-b95f92cb7788','Transporte','variavel','{uber,99,99app,posto,combust,gasolina,etanol,estaciona,pedagio,metro,onibus}','#0ea5e9','car','2026-06-21 14:12:37.275753+00','2026-06-21 14:12:37.275753+00')
on conflict (id) do nothing;

insert into public.fixed_bills (id, name, amount, due_day, category_id, active, created_at, updated_at) values
('edf78116-cad8-4138-9470-3b3e438f80ed','Internet',80.00,10,'fc0facfc-eee6-4167-8204-6eef0d7a33b4',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00'),
('9e31efb9-fd9d-415e-884e-97edc14f0b63','Água',55.00,10,'55991817-7c9b-4ffb-9b07-eaf9c787c1bd',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00'),
('e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','Luz',280.00,13,'864d1905-bc13-4191-ba6d-7a9084e63525',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00'),
('4149c112-e739-4d4a-b966-ed9ce4895bba','Casa',600.00,15,'d12f7a54-988c-4197-8569-6d9862ef4551',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00'),
('080004d9-e6f6-4739-a0b6-7e047fcc9ac8','IPTU',25.09,15,'ad757c4b-24f1-46d3-ac41-db0cb0e3c550',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00'),
('e7e8f860-68ae-40d5-affc-864efbd02f40','MEI',87.05,20,'cdd1f951-9497-438d-89b8-6f2dc8fe223e',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00'),
('359e03d4-bfee-488f-a5cf-724e7f92abef','Carro',850.00,25,'f134c15f-20fb-4fad-8817-292171bebd58',true,'2026-06-21 14:40:24.702862+00','2026-06-21 14:40:24.702862+00')
on conflict (id) do nothing;

insert into public.bill_payments (id, fixed_bill_id, due_date, paid_at, amount, status, created_at, updated_at) values
('d0de84cb-1034-42dd-8a92-4925495562b1','edf78116-cad8-4138-9470-3b3e438f80ed','2026-01-10',null,80.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('c815de98-8858-4a6d-b01d-1688a4700cc6','9e31efb9-fd9d-415e-884e-97edc14f0b63','2026-01-10','2026-02-10 00:00:00+00',50.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('d7d8a522-3690-4d32-a17a-d4cced8f726c','e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','2026-01-13','2026-02-10 00:00:00+00',274.95,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('91e8fc4f-dfca-4428-9f78-29d800f1256a','4149c112-e739-4d4a-b966-ed9ce4895bba','2026-01-15','2026-02-13 00:00:00+00',595.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('327d21fe-11d4-4b8c-a49a-e284c8436a59','080004d9-e6f6-4739-a0b6-7e047fcc9ac8','2026-01-15',null,25.09,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('19ec1f32-9fbd-451d-9ef3-29c279f10a4d','e7e8f860-68ae-40d5-affc-864efbd02f40','2026-01-20','2026-01-23 00:00:00+00',87.05,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('b5e70342-fd27-4dfe-abdf-a34baa0dd6b8','359e03d4-bfee-488f-a5cf-724e7f92abef','2026-01-25','2026-01-25 00:00:00+00',850.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('1f1cee7e-0a31-4ec0-833b-5ffc700ce32a','edf78116-cad8-4138-9470-3b3e438f80ed','2026-02-10','2026-03-10 00:00:00+00',80.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('af6cbcf5-3e20-433c-9edc-b91a55664b63','9e31efb9-fd9d-415e-884e-97edc14f0b63','2026-02-10','2026-03-19 00:00:00+00',51.50,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('e6a92917-8210-4901-9b5b-7e3d78d6790e','e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','2026-02-13','2026-03-19 00:00:00+00',273.33,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('7744db84-f5c0-4bdb-af4f-47e7e8ca7a3c','4149c112-e739-4d4a-b966-ed9ce4895bba','2026-02-15','2026-03-19 00:00:00+00',607.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('153988c9-3462-4f41-ad7f-48c9d54090f4','080004d9-e6f6-4739-a0b6-7e047fcc9ac8','2026-02-15','2026-03-19 00:00:00+00',25.84,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('b14fab64-073a-4bbf-89bd-a70172e679e7','e7e8f860-68ae-40d5-affc-864efbd02f40','2026-02-20','2026-02-25 00:00:00+00',87.91,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('36434606-d778-4f0e-b13f-f55b3d1c46e0','359e03d4-bfee-488f-a5cf-724e7f92abef','2026-02-25','2026-02-25 00:00:00+00',850.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('6909ac55-5f19-4d85-a53d-f52c16728aa1','9e31efb9-fd9d-415e-884e-97edc14f0b63','2026-03-10','2026-04-08 00:00:00+00',50.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('25cd086b-2b03-45a8-891a-f9f94833bdc4','edf78116-cad8-4138-9470-3b3e438f80ed','2026-03-10','2026-04-08 00:00:00+00',80.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('4909b510-1d0c-4b3c-a57f-884e4f1b761b','e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','2026-03-13','2026-04-08 00:00:00+00',282.77,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('890bbcb6-2008-413f-89d4-0d0f978d6d11','080004d9-e6f6-4739-a0b6-7e047fcc9ac8','2026-03-15',null,25.09,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('5f8e0b07-c53b-4941-8b00-f23e7934819e','4149c112-e739-4d4a-b966-ed9ce4895bba','2026-03-15','2026-04-08 00:00:00+00',600.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('b12f8385-22df-4142-8812-2f6ddfcfc52e','e7e8f860-68ae-40d5-affc-864efbd02f40','2026-03-20','2026-04-08 00:00:00+00',87.05,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('9b340275-bbb7-4686-94c9-737ae35a6611','359e03d4-bfee-488f-a5cf-724e7f92abef','2026-03-25','2026-03-25 00:00:00+00',850.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('c0412f9c-965c-479b-8a2d-41adc2f2fcd9','9e31efb9-fd9d-415e-884e-97edc14f0b63','2026-04-10',null,55.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('a615c44a-604c-4728-91b1-494f6025e7e3','edf78116-cad8-4138-9470-3b3e438f80ed','2026-04-10','2026-05-08 00:00:00+00',80.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('17810fa2-7293-4844-b2e2-9a66eb67b810','e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','2026-04-13','2026-05-08 00:00:00+00',272.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('f8a71e5a-8ee6-4be4-a38c-6bf0896c9355','4149c112-e739-4d4a-b966-ed9ce4895bba','2026-04-15','2026-05-09 00:00:00+00',593.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('64e0a6c5-b466-4cc2-887b-9eb58efcfdad','080004d9-e6f6-4739-a0b6-7e047fcc9ac8','2026-04-15','2026-05-09 00:00:00+00',25.09,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('b491f7ec-cc9d-4368-a787-dd66fe953ce4','e7e8f860-68ae-40d5-affc-864efbd02f40','2026-04-20','2026-05-09 00:00:00+00',87.05,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('c7ccbec7-736a-4f45-893b-5aa31fc51a35','359e03d4-bfee-488f-a5cf-724e7f92abef','2026-04-25','2026-04-25 00:00:00+00',850.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('4b191302-979f-433d-914e-e26e9f14ec80','edf78116-cad8-4138-9470-3b3e438f80ed','2026-05-10','2026-06-06 00:00:00+00',80.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('3f1b0dde-e547-4c88-af49-5a7f7b37bc4f','9e31efb9-fd9d-415e-884e-97edc14f0b63','2026-05-10','2026-06-06 00:00:00+00',71.36,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('1f794be7-af52-4585-98bb-2fa4f37ff62c','e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','2026-05-13','2026-06-16 00:00:00+00',286.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('bd40c4b3-5c81-44c0-a24f-42a2db5e24c0','4149c112-e739-4d4a-b966-ed9ce4895bba','2026-05-15','2026-06-16 00:00:00+00',606.45,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('77aa1f73-d5d2-4aaa-b643-29daf0833a05','080004d9-e6f6-4739-a0b6-7e047fcc9ac8','2026-05-15','2026-06-06 00:00:00+00',25.09,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('bba0662e-1493-4b0a-9654-7b70a43674de','e7e8f860-68ae-40d5-affc-864efbd02f40','2026-05-20','2026-06-18 00:00:00+00',87.05,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('1ebd176f-bc02-4320-9d7e-50bb971aa6b6','359e03d4-bfee-488f-a5cf-724e7f92abef','2026-05-25','2026-05-25 00:00:00+00',850.00,'pago','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('f080f6a5-6964-4e04-9132-70f5c8124da8','9e31efb9-fd9d-415e-884e-97edc14f0b63','2026-06-10',null,55.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('b73e9167-f9b6-40da-99af-ada9d73e6ac0','edf78116-cad8-4138-9470-3b3e438f80ed','2026-06-10',null,80.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('bb422b51-f382-4251-8415-5c313b24513f','e09c6b22-f5e0-4c10-a7b7-d0d4e33989e6','2026-06-13',null,280.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('c6355aa2-182e-401c-9296-a60844586202','080004d9-e6f6-4739-a0b6-7e047fcc9ac8','2026-06-15',null,25.09,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('a4269525-e53a-49de-b5f4-ed60b5faf385','4149c112-e739-4d4a-b966-ed9ce4895bba','2026-06-15',null,600.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('13ffc760-67bc-4902-b0fb-4176b885749c','e7e8f860-68ae-40d5-affc-864efbd02f40','2026-06-20',null,87.05,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00'),
('44a0e7b0-ddd8-4588-bf63-6e1ad864ca1c','359e03d4-bfee-488f-a5cf-724e7f92abef','2026-06-25',null,850.00,'pendente','2026-06-21 14:40:53.069473+00','2026-06-21 14:40:53.069473+00')
on conflict (id) do nothing;

insert into public.transactions (id, date, description, amount, category_id, source, account, kind, raw, created_at, updated_at) values
('a15a1af3-2518-4a8b-a366-cfcfdde4b72c','2026-02-04','Fatura Cartão Itaú – Janeiro/2026',4324.00,'c2c59015-f61f-4326-8e62-1d0972325da9','manual','Itaú','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('b6222ba7-e665-4021-865c-455299374188','2026-02-10','IPVA Carro – parcela 1/3',578.50,'5844c9d1-ce61-4a12-b4a1-f78b584609de','manual',null,'fixa','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('d21694f1-a3f9-4914-b63a-b720d0adbba9','2026-02-13','Fatura Nubank – Janeiro/2026',96.00,'051f0c27-55a5-4a75-b33e-6428290740dc','manual','Nubank','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('cb1be042-ded9-4cfe-b88a-b206291ba175','2026-03-07','Fatura Cartão Itaú – Fevereiro/2026',5314.00,'c2c59015-f61f-4326-8e62-1d0972325da9','manual','Itaú','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('8c3c3f92-3644-4e20-9f84-f09c8c474806','2026-03-12','IPVA Carro – parcela 2/3',578.50,'5844c9d1-ce61-4a12-b4a1-f78b584609de','manual',null,'fixa','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('a115591f-b433-41a6-b5eb-d2acd8e987cb','2026-03-19','Licenciamento anual do carro',35.62,'36e430c1-6cd9-424f-8ca8-f97ea3912c90','manual',null,'fixa','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('1bdae3b2-2cb9-4ef3-8ccb-ddba72ccb93e','2026-04-07','Fatura Porto – Março/2026',106.09,'9f3208c7-0106-46d8-a001-dc56a500a273','manual','Porto','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('99f94cfa-8310-41b5-8022-f93e97d9a2e9','2026-04-07','Fatura Nubank – Março/2026',125.00,'051f0c27-55a5-4a75-b33e-6428290740dc','manual','Nubank','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('0e51c7d0-25c9-4db7-96b7-a48bd9b78f5b','2026-04-07','Fatura Cartão Itaú – Março/2026',6624.00,'c2c59015-f61f-4326-8e62-1d0972325da9','manual','Itaú','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('4bcc2be3-1270-4f88-b5c5-25b0b7bdba25','2026-04-07','IPVA Carro – parcela 3/3',578.50,'5844c9d1-ce61-4a12-b4a1-f78b584609de','manual',null,'fixa','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('620c5a70-cbd9-4011-b7f9-8ceb60295e47','2026-05-07','Fatura Porto – Abril/2026',534.00,'9f3208c7-0106-46d8-a001-dc56a500a273','manual','Porto','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('4be65dc3-44e0-43a2-a0d6-a4b3cd2a0fc6','2026-05-08','Fatura Nubank – Abril/2026',125.00,'051f0c27-55a5-4a75-b33e-6428290740dc','manual','Nubank','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('65506238-bcd1-4d96-8e79-d5279f3839f5','2026-05-08','Fatura Cartão Itaú – Abril/2026',5077.00,'c2c59015-f61f-4326-8e62-1d0972325da9','manual','Itaú','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('78f06343-9fc2-4a05-9fd3-dbd12e6b2e3d','2026-06-05','Fatura Porto – Maio/2026',592.00,'9f3208c7-0106-46d8-a001-dc56a500a273','manual','Porto','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('b9a9193e-2d3a-4abd-beb3-f5dc64ff2f01','2026-06-06','Fatura Cartão Itaú – Maio/2026',7450.00,'c2c59015-f61f-4326-8e62-1d0972325da9','manual','Itaú','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('0207efa9-c8aa-47eb-a034-18409b78ce26','2026-06-15','Fatura Nubank – Maio/2026',125.00,'051f0c27-55a5-4a75-b33e-6428290740dc','manual','Nubank','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('4734616e-782a-424a-81f4-b0674f05e282','2026-07-04','Fatura Nubank – Junho/2026',1196.00,'051f0c27-55a5-4a75-b33e-6428290740dc','manual','Nubank','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('91ced2cb-6632-4bbe-9bb0-fe010dd60803','2026-07-04','Fatura Cartão Itaú – Junho/2026',2888.00,'c2c59015-f61f-4326-8e62-1d0972325da9','manual','Itaú','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00'),
('be777cd3-22a1-4589-ad26-0eac52da6cd5','2026-07-10','Fatura Porto – Junho/2026',308.00,'9f3208c7-0106-46d8-a001-dc56a500a273','manual','Porto','variavel','{"origem":"planilha_2026"}','2026-06-21 15:32:49.439382+00','2026-06-21 15:32:49.439382+00')
on conflict (id) do nothing;

-- IMPORTANTE: o cadastro de Ricardo e Jéssica (login/senha) é recriado quando cada um se cadastrar de novo
-- no app novo (Settings > Authentication do Supabase cuida disso). O trigger acima já dá 'admin' pro primeiro
-- cadastro (Ricardo) e 'membro' pro segundo (Jéssica) automaticamente, na ordem em que entrarem primeiro.

-- ============ FIM ============
select 'Migração concluída' as resultado;
