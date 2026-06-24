-- Limite de crédito de cada cartão, pra alertar quando a fatura do mês se
-- aproxima/passa do limite (sinal de estouro antes de virar fatura).
alter table cartoes add column if not exists limite_credito numeric;
update cartoes set limite_credito = 2037 where nome = 'Itaú Ricardo';
update cartoes set limite_credito = 12409 where nome = 'Itaú Jéssica (Pão de Açúcar)';
