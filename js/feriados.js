// Feriados nacionais brasileiros, calculados pra qualquer ano (sem precisar cadastrar manualmente).
// Inclui fixos + móveis (baseados na Páscoa, calculada pelo algoritmo de Meeus/Jones/Butcher).

function calcularPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function adicionarDias(data, dias) {
  const d = new Date(data);
  d.setDate(d.getDate() + dias);
  return d;
}

function fmt(data) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function feriadosDoAno(ano) {
  const pascoa = calcularPascoa(ano);
  const feriados = {
    [`${ano}-01-01`]: "Ano Novo",
    [`${ano}-04-21`]: "Tiradentes",
    [`${ano}-05-01`]: "Dia do Trabalho",
    [`${ano}-09-07`]: "Independência do Brasil",
    [`${ano}-10-12`]: "Nossa Senhora Aparecida",
    [`${ano}-11-02`]: "Finados",
    [`${ano}-11-15`]: "Proclamação da República",
    [`${ano}-11-20`]: "Consciência Negra",
    [`${ano}-12-25`]: "Natal",
  };
  feriados[fmt(adicionarDias(pascoa, -47))] = "Carnaval";
  feriados[fmt(adicionarDias(pascoa, -46))] = "Quarta-feira de Cinzas";
  feriados[fmt(adicionarDias(pascoa, -2))] = "Sexta-feira Santa";
  feriados[fmt(pascoa)] = "Páscoa";
  feriados[fmt(adicionarDias(pascoa, 60))] = "Corpus Christi";
  return feriados;
}

const cacheFeriados = {};
export function nomeFeriado(dataISO) {
  const ano = parseInt(dataISO.slice(0, 4), 10);
  if (!cacheFeriados[ano]) cacheFeriados[ano] = feriadosDoAno(ano);
  return cacheFeriados[ano][dataISO] || null;
}
