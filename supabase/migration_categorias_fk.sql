-- Casa em Dia: corrige FK de categoria pra "ON DELETE SET NULL".
-- Sem isso, excluir uma categoria em uso (Ajustes > Categorias) dava erro de
-- violação de chave estrangeira, contradizendo o aviso da UI ("lançamentos
-- continuam, só perdem a categorização").

alter table public.fixed_bills drop constraint if exists fixed_bills_category_id_fkey;
alter table public.fixed_bills add constraint fixed_bills_category_id_fkey
  foreign key (category_id) references public.categories(id) on delete set null;

alter table public.transactions drop constraint if exists transactions_category_id_fkey;
alter table public.transactions add constraint transactions_category_id_fkey
  foreign key (category_id) references public.categories(id) on delete set null;

select 'FK de categoria corrigida (ON DELETE SET NULL)' as resultado;
