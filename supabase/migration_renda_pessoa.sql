-- Separa renda do Ricardo (sempre automática, vinda do Sistema de Joias) da
-- renda da Jéssica (lançada manualmente na aba Renda).
alter table transactions add column if not exists pessoa text;
update transactions set pessoa = 'ricardo' where kind = 'renda' and pessoa is null;
