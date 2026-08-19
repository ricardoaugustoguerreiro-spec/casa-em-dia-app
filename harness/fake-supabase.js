// Cliente Supabase falso, só para conferir o visual sem tocar nos dados reais.
// Serve dados sintéticos em memória; nenhuma escrita sai daqui.

const hoje = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const mes = iso(hoje).slice(0, 7);
const dia = (n) => {
  const d = new Date(hoje);
  d.setDate(n);
  return iso(d);
};

const UID = "00000000-0000-4000-8000-000000000001";

const DB = {
  profiles: [
    { id: UID, display_name: "Ricardo", color: "#B94E33", role: "admin" },
    { id: "00000000-0000-4000-8000-000000000002", display_name: "Jéssica", color: "#2C5D8F", role: "membro" },
  ],
  categories: [
    { id: "c1", name: "Casa", kind: "fixa", color: "#55606E" },
    { id: "c2", name: "Mercado", kind: "variavel", color: "#55606E" },
    { id: "c3", name: "Renda", kind: "renda", color: "#0F7A57" },
  ],
  fixed_bills: [
    { id: "b1", name: "Internet", amount: 80, due_day: 10, active: true, vence_mes_seguinte: true, category_id: "c1" },
    { id: "b2", name: "Água", amount: 55, due_day: 10, active: true, vence_mes_seguinte: true, category_id: "c1" },
    { id: "b3", name: "Luz", amount: 280, due_day: 13, active: true, vence_mes_seguinte: true, category_id: "c1" },
    { id: "b4", name: "Casa", amount: 600, due_day: 15, active: true, vence_mes_seguinte: true, category_id: "c1" },
    { id: "b5", name: "Carro", amount: 850, due_day: 25, active: true, vence_mes_seguinte: false, category_id: "c1" },
  ],
  bill_payments: [
    { id: "p1", fixed_bill_id: "b1", due_date: dia(10), amount: 80, status: "pago", paid_at: dia(7), competencia: mes },
    { id: "p2", fixed_bill_id: "b2", due_date: dia(10), amount: 55, status: "pago", paid_at: dia(7), competencia: mes },
    { id: "p3", fixed_bill_id: "b3", due_date: dia(13), amount: 280, status: "pendente", paid_at: null, competencia: mes },
    { id: "p4", fixed_bill_id: "b4", due_date: dia(15), amount: 600, status: "pendente", paid_at: null, competencia: mes },
    { id: "p5", fixed_bill_id: "b5", due_date: dia(25), amount: 850, status: "pendente", paid_at: null, competencia: mes },
  ],
  transactions: [
    { id: "t1", date: dia(3), description: "Trabalho — cliente A", amount: 1500, kind: "renda", pessoa: "ricardo", transferencia_interna: false, category_id: "c3" },
    { id: "t2", date: dia(6), description: "Trabalho — cliente B", amount: 600, kind: "renda", pessoa: "ricardo", transferencia_interna: false, category_id: "c3" },
    { id: "t3", date: dia(8), description: "Mercado da semana", amount: 214.9, kind: "variavel", pessoa: "jessica", transferencia_interna: false, category_id: "c2" },
    { id: "t4", date: dia(9), description: "Farmácia", amount: 78.4, kind: "variavel", pessoa: "ricardo", transferencia_interna: false, category_id: "c2" },
    { id: "t5", date: dia(11), description: "Gasolina", amount: 120, kind: "diaria", pessoa: "ricardo", transferencia_interna: false, category_id: "c2" },
  ],
  cartoes: [
    { id: "k1", nome: "Nubank", dia_fechamento: 5, dia_vencimento: 15, active: true, limite_credito: 8000 },
    { id: "k2", nome: "Itaú", dia_fechamento: 1, dia_vencimento: 10, active: true, limite_credito: 5000 },
  ],
  faturas_cartao: [
    { id: "f1", cartao_id: "k1", competencia: mes, due_date: dia(15), amount: 2991, status: "pendente", paid_at: null },
    { id: "f2", cartao_id: "k2", competencia: mes, due_date: dia(10), amount: 1800, status: "pago", paid_at: dia(9) },
  ],
  compras_parceladas: [
    { id: "cp1", descricao: "Ar condicionado", cartao: "Nubank", valor_parcela: 183.34, parcela_inicio: dia(1), parcela_fim: "2026-10-01", total_parcelas: 3, grupo: null, data_compra: dia(1) },
    { id: "cp2", descricao: "Passagem", cartao: "Nubank", valor_parcela: 487.22, parcela_inicio: dia(1), parcela_fim: "2026-12-01", total_parcelas: 5, grupo: null, data_compra: dia(1) },
    { id: "cp3", descricao: "Tênis", cartao: "Itaú", valor_parcela: 90.32, parcela_inicio: dia(1), parcela_fim: "2026-10-01", total_parcelas: 4, grupo: null, data_compra: dia(1) },
  ],
  dia_a_dia: [
    { id: "d1", data: dia(11), descricao: "Feira", valor: 62, observacao: "Nubank", status: "realizado", owner_id: UID, grupo: null },
  ],
  events: [
    { id: "e1", title: "Dentista", starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 36e5).toISOString(), owner_id: UID, tipo: "pessoal", origem: "manual", color: "#2C5D8F" },
  ],
  tarefas_joias: [
    { id: "j1", titulo: "Anel solitário", cliente: "ANDERSON", prazo: dia(hoje.getDate() + 2), status: "aberto", origem: "sistema_joias" },
    { id: "j2", titulo: "Pingente", cliente: "VICTOR", prazo: null, status: "aberto", origem: "sistema_joias" },
  ],
  balances: [],
  dias_menstruacao: [],
  registros_intimos: [],
  dismissed_insights: [],
  eventos_silenciados: [],
  imports: [],
};

const ok = (data) => Promise.resolve({ data, error: null });

function query(table) {
  let rows = (DB[table] || []).map((r) => ({ ...r }));
  const api = {
    select() { return api; },
    eq(col, val) { rows = rows.filter((r) => r[col] === val); return api; },
    in(col, vals) { rows = rows.filter((r) => vals.includes(r[col])); return api; },
    gte(col, val) { rows = rows.filter((r) => r[col] >= val); return api; },
    lte(col, val) { rows = rows.filter((r) => r[col] <= val); return api; },
    order(col, opts = {}) {
      const asc = opts.ascending !== false;
      rows.sort((a, b) => ((a[col] ?? "") > (b[col] ?? "") ? 1 : -1) * (asc ? 1 : -1));
      return api;
    },
    limit(n) { rows = rows.slice(0, n); return api; },
    maybeSingle() { return ok(rows[0] ?? null); },
    single() { return ok(rows[0] ?? null); },
    insert(payload) {
      const arr = Array.isArray(payload) ? payload : [payload];
      const novos = arr.map((p, i) => ({ id: `${table}-novo-${Date.now()}-${i}`, ...p }));
      DB[table] = [...(DB[table] || []), ...novos];
      rows = novos;
      return api;
    },
    update(payload) { rows = rows.map((r) => ({ ...r, ...payload })); return api; },
    upsert(payload) { return api.insert(payload); },
    delete() { return api; },
    then(resolve, reject) { return ok(rows).then(resolve, reject); },
  };
  return api;
}

const sessao = {
  access_token: "harness",
  user: { id: UID, email: "preview@casaemdia.local" },
};

export const supabase = {
  from: (table) => query(table),
  auth: {
    getSession: () => ok({ session: sessao }),
    getUser: () => ok({ user: sessao.user }),
    onAuthStateChange: (cb) => {
      setTimeout(() => cb("SIGNED_IN", sessao), 0);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    signInWithPassword: () => ok({ session: sessao, user: sessao.user }),
    signUp: () => ok({ session: sessao, user: sessao.user }),
    signOut: () => ok(null),
  },
};
