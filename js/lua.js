// Fase da lua calculada pra qualquer data (sem precisar de API externa nem cadastro manual).
// Baseado na idade da lua em relação a uma lua nova de referência conhecida (06/01/2000, 18:14 UTC)
// e no ciclo sinódico médio (29.530588853 dias). Funciona pra qualquer ano, passado ou futuro.

const LUA_NOVA_REF = Date.UTC(2000, 0, 6, 18, 14);
const CICLO_SINODICO = 29.530588853;

const FASES = [
  { nome: "Lua Nova", emoji: "🌑" },
  { nome: "Crescente", emoji: "🌒" },
  { nome: "Quarto Crescente", emoji: "🌓" },
  { nome: "Crescente Gibosa", emoji: "🌔" },
  { nome: "Lua Cheia", emoji: "🌕" },
  { nome: "Minguante Gibosa", emoji: "🌖" },
  { nome: "Quarto Minguante", emoji: "🌗" },
  { nome: "Minguante", emoji: "🌘" },
];

export function faseLua(dataISO) {
  const [y, m, d] = dataISO.split("-").map(Number);
  const dataUTC = Date.UTC(y, m - 1, d, 12); // meio-dia UTC: evita virar de dia por fuso
  const diasDesdeRef = (dataUTC - LUA_NOVA_REF) / 86400000;
  const idadeDias = ((diasDesdeRef % CICLO_SINODICO) + CICLO_SINODICO) % CICLO_SINODICO;
  const indice = Math.floor((idadeDias / CICLO_SINODICO) * 8) % 8;
  return { ...FASES[indice], idadeDias, indice };
}

// true só nos dias "marcantes" (nova ou cheia), pra destacar no calendário sem poluir com as 8 fases.
export function luaMarcante(dataISO) {
  const { indice } = faseLua(dataISO);
  return indice === 0 ? "nova" : indice === 4 ? "cheia" : null;
}
