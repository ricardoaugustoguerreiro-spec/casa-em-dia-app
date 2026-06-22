-- Casa em Dia: marca transferências internas (Ricardo <-> Jéssica) nas transações,
-- pra separar "tudo que entrou" (bruto) de "renda líquida real" nos cards do app.

alter table public.transactions add column if not exists transferencia_interna boolean not null default false;

select 'Coluna transferencia_interna adicionada' as resultado;
