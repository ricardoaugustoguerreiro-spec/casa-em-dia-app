-- Casa em Dia: compras parceladas no cartão (pra saber o que falta pagar mês a mês).

create table if not exists public.compras_parceladas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  cartao text,
  valor_parcela numeric not null,
  parcela_inicio date not null, -- mês (qualquer dia) da 1ª parcela
  parcela_fim date not null,    -- mês (qualquer dia) da última parcela
  total_parcelas integer,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.compras_parceladas enable row level security;

drop policy if exists "All auth read compras_parceladas" on public.compras_parceladas;
drop policy if exists "All auth insert compras_parceladas" on public.compras_parceladas;
drop policy if exists "All auth update compras_parceladas" on public.compras_parceladas;
drop policy if exists "All auth delete compras_parceladas" on public.compras_parceladas;
create policy "All auth read compras_parceladas" on public.compras_parceladas for select to authenticated using (true);
create policy "All auth insert compras_parceladas" on public.compras_parceladas for insert to authenticated with check (true);
create policy "All auth update compras_parceladas" on public.compras_parceladas for update to authenticated using (true) with check (true);
create policy "All auth delete compras_parceladas" on public.compras_parceladas for delete to authenticated using (true);

select 'Tabela compras_parceladas criada' as resultado;
