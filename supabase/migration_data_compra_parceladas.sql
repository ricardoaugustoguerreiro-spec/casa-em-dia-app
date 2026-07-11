-- Casa em Dia: dia exato da compra em compras_parceladas.
-- Cadastro manual agora pede "dia da compra" + "quantas parcelas" em vez de
-- 1ª/última parcela (mês) — o app calcula parcela_inicio/parcela_fim sozinho.
-- Guardamos o dia exato aqui pra referência (aparece no card da parcela).

alter table public.compras_parceladas add column if not exists data_compra date;

select 'Coluna data_compra adicionada em compras_parceladas' as resultado;
