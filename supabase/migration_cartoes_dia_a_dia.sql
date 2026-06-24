-- Cartões da família, com dia de fechamento/vencimento próprios — usados pra calcular
-- a competência certa da fatura (mês de uso real), mesmo pagando no mês seguinte.
create table if not exists cartoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  dia_fechamento integer not null,
  dia_vencimento integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table cartoes enable row level security;
create policy "cartoes_select_all" on cartoes for select using (auth.role() = 'authenticated');
create policy "cartoes_write_all" on cartoes for all using (auth.role() = 'authenticated');

insert into cartoes (nome, dia_fechamento, dia_vencimento) values
  ('Itaú Ricardo', 3, 10),
  ('Itaú Jéssica', 3, 10),
  ('Itaú Pão de Açúcar', 3, 10),
  ('Nubank', 8, 15),
  ('Porto (Ricardo)', 3, 10)
on conflict (nome) do nothing;

-- Fatura mensal de cada cartão, igual padrão de bill_payments (uma linha por
-- cartão por competência), editável na aba Contas Fixas.
create table if not exists faturas_cartao (
  id uuid primary key default gen_random_uuid(),
  cartao_id uuid not null references cartoes(id) on delete cascade,
  competencia text not null, -- "AAAA-MM" do mês de uso (não o mês de pagamento)
  due_date date,
  amount numeric not null default 0,
  status text not null default 'pendente', -- pendente | pago
  paid_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (cartao_id, competencia)
);

alter table faturas_cartao enable row level security;
create policy "faturas_cartao_select_all" on faturas_cartao for select using (auth.role() = 'authenticated');
create policy "faturas_cartao_write_all" on faturas_cartao for all using (auth.role() = 'authenticated');

-- Dia a dia: gasto real lançado manualmente (cartão/pix do dia a dia) OU previsão
-- de gasto futuro (Jéssica planeja um valor numa data futura; quando o dia chega,
-- edita pro valor real e status passa pra "realizado").
create table if not exists dia_a_dia (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  descricao text not null,
  valor numeric not null,
  observacao text,
  status text not null default 'realizado', -- previsto | realizado
  owner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dia_a_dia enable row level security;
create policy "dia_a_dia_select_all" on dia_a_dia for select using (auth.role() = 'authenticated');
create policy "dia_a_dia_write_all" on dia_a_dia for all using (auth.role() = 'authenticated');
