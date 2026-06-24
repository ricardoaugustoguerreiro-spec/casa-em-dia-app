-- Previsão de gasto em grupo: várias datas com um nome em comum (ex: "Final de
-- semana" nos dias 25 e 26), pra não precisar criar uma previsão de cada vez.
alter table dia_a_dia add column if not exists grupo text;
