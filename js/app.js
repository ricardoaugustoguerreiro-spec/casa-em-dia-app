import { supabase } from "./supabaseClient.js";
import Alpine from "https://esm.sh/alpinejs@3.14.3";
import { nomeFeriado } from "./feriados.js";

export const CARTOES_FAMILIA = [
  "Itaú Ricardo",
  "Itaú Jéssica",
  "Itaú Pão de Açúcar",
  "Nubank",
  "Porto (Ricardo)",
];

function animateCount(el, target, duration = 700) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    const current = target * eased;
    el.textContent = current.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

Alpine.data("appState", () => ({
    // auth
    view: "loading", // loading | login | app
    authMode: "entrar", // entrar | criar
    email: "",
    password: "",
    showPassword: false,
    authError: "",
    authLoading: false,
    emailLocked: false,

    // app data
    profile: null,
    isAdmin: false,
    fixedBills: [],
    billPayments: [],
    categories: [],
    transactions: [],
    cardTotals: [],
    grandTotalCards: 0,
    loadingData: true,
    abaAtual: "financeiro", // financeiro | calendario

    // calendário
    events: [],
    anoCalendario: new Date().getFullYear(),
    diaSelecionado: null, // 'AAAA-MM-DD'
    eventoEditando: null,
    formEvento: { title: "", data: "", hora_inicio: "09:00", hora_fim: "10:00", tipo: "pessoal", location: "", notes: "", status_trabalho: "aberto" },

    async init() {
      const lembrado = localStorage.getItem("casa-em-dia:lastEmail");
      if (lembrado) {
        this.email = lembrado;
        this.emailLocked = true;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await this.loadAfterLogin();
      } else {
        this.view = "login";
      }
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session && this.view !== "app") {
          localStorage.setItem("casa-em-dia:lastEmail", session.user.email);
          this.emailLocked = true;
          await this.loadAfterLogin();
        }
        if (!session) {
          this.view = "login";
          this.profile = null;
        }
      });
    },

    trocarDeConta() {
      localStorage.removeItem("casa-em-dia:lastEmail");
      this.emailLocked = false;
      this.email = "";
      this.password = "";
      this.authMode = "entrar";
    },

    togglePassword() {
      this.showPassword = !this.showPassword;
    },

    async submitAuth() {
      this.authError = "";
      this.authLoading = true;
      try {
        if (this.authMode === "entrar") {
          const { error } = await supabase.auth.signInWithPassword({
            email: this.email,
            password: this.password,
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.auth.signUp({
            email: this.email,
            password: this.password,
          });
          if (error) throw error;
        }
        // não chama loadAfterLogin aqui: o listener onAuthStateChange (em init())
        // já detecta o login e carrega os dados — evita carregar tudo duas vezes.
      } catch (e) {
        this.authError = traduzErroAuth(e.message);
      } finally {
        this.authLoading = false;
      }
    },

    async logout() {
      await supabase.auth.signOut();
      this.view = "login";
      this.profile = null;
    },

    async loadAfterLogin() {
      this.loadingData = true;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (uid) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", uid)
          .maybeSingle();
        this.profile = profile;
        this.isAdmin = profile?.role === "admin";
      }
      this.view = "app";
      await this.loadDashboard();
      this.loadingData = false;
      this.$nextTick(() => this.animateCards());
    },

    async loadDashboard() {
      const [{ data: categories }, { data: fixedBills }, { data: billPayments }, { data: transactions }, { data: events }] =
        await Promise.all([
          supabase.from("categories").select("*").order("name"),
          supabase.from("fixed_bills").select("*").order("due_day"),
          supabase.from("bill_payments").select("*").order("due_date", { ascending: false }),
          supabase.from("transactions").select("*").order("date", { ascending: false }),
          supabase.from("events").select("*").order("starts_at"),
        ]);
      this.categories = categories || [];
      this.fixedBills = fixedBills || [];
      this.billPayments = billPayments || [];
      this.transactions = transactions || [];
      this.events = events || [];

      const byAccount = {};
      for (const t of this.transactions) {
        const key = t.account || "Sem conta definida";
        byAccount[key] = (byAccount[key] || 0) + Number(t.amount);
      }
      this.cardTotals = Object.entries(byAccount).map(([nome, total]) => ({ nome, total }));
      this.grandTotalCards = this.cardTotals.reduce((s, c) => s + c.total, 0);
    },

    animateCards() {
      const cards = document.querySelectorAll("[data-card-value]");
      cards.forEach((card, i) => {
        card.style.opacity = "0";
        card.style.transform = "translateY(8px)";
        setTimeout(() => {
          card.style.transition = "opacity .4s ease, transform .4s ease";
          card.style.opacity = "1";
          card.style.transform = "translateY(0)";
          const target = parseFloat(card.dataset.cardValue);
          const valEl = card.querySelector(".valor-animado");
          if (valEl) animateCount(valEl, target);
        }, i * 140);
      });
    },

    async excluirTransacao(id) {
      if (!confirm("Excluir este lançamento? Não tem como desfazer.")) return;
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.transactions = this.transactions.filter((t) => t.id !== id);
      this.recalcularCards();
    },

    async excluirPagamento(id) {
      if (!confirm("Excluir este lançamento de conta fixa? Não tem como desfazer.")) return;
      const { error } = await supabase.from("bill_payments").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.billPayments = this.billPayments.filter((p) => p.id !== id);
    },

    recalcularCards() {
      const byAccount = {};
      for (const t of this.transactions) {
        const key = t.account || "Sem conta definida";
        byAccount[key] = (byAccount[key] || 0) + Number(t.amount);
      }
      this.cardTotals = Object.entries(byAccount).map(([nome, total]) => ({ nome, total }));
      this.grandTotalCards = this.cardTotals.reduce((s, c) => s + c.total, 0);
    },

    async exportarBackup() {
      const [{ data: categories }, { data: fixedBills }, { data: billPayments }, { data: transactions }, { data: events }] =
        await Promise.all([
          supabase.from("categories").select("*"),
          supabase.from("fixed_bills").select("*"),
          supabase.from("bill_payments").select("*"),
          supabase.from("transactions").select("*"),
          supabase.from("events").select("*"),
        ]);
      const backup = {
        gerado_em: new Date().toISOString(),
        categories: categories || [],
        fixed_bills: fixedBills || [],
        bill_payments: billPayments || [],
        transactions: transactions || [],
        events: events || [],
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const hoje = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `casa-em-dia-backup-${hoje}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    abrirImportarBackup() {
      this.$refs.inputBackup.click();
    },

    async importarBackup(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (!confirm("Importar este backup vai adicionar/atualizar dados no banco atual. Continuar?")) {
        event.target.value = "";
        return;
      }
      try {
        const texto = await file.text();
        const backup = JSON.parse(texto);
        for (const tabela of ["categories", "fixed_bills", "bill_payments", "transactions", "events"]) {
          const linhas = backup[tabela];
          if (Array.isArray(linhas) && linhas.length) {
            const { error } = await supabase.from(tabela).upsert(linhas, { onConflict: "id" });
            if (error) throw new Error(`${tabela}: ${error.message}`);
          }
        }
        alert("Backup importado com sucesso.");
        await this.loadDashboard();
        this.$nextTick(() => this.animateCards());
      } catch (e) {
        alert("Erro ao importar backup: " + e.message);
      } finally {
        event.target.value = "";
      }
    },

    // ===================== CALENDÁRIO =====================

    nomesMeses: ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"],

    anoAnterior() { this.anoCalendario--; },
    anoSeguinte() { this.anoCalendario++; },

    diasDoMes(mesIndex) {
      const ano = this.anoCalendario;
      const primeiroDiaSemana = new Date(ano, mesIndex, 1).getDay();
      const totalDias = new Date(ano, mesIndex + 1, 0).getDate();
      const celulas = [];
      for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
      for (let d = 1; d <= totalDias; d++) {
        const dataISO = `${ano}-${String(mesIndex + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        celulas.push(dataISO);
      }
      return celulas;
    },

    eventosDoDia(dataISO) {
      if (!dataISO) return [];
      return this.events.filter((e) => e.starts_at && e.starts_at.slice(0, 10) === dataISO);
    },

    feriadoDoDia(dataISO) {
      return dataISO ? nomeFeriado(dataISO) : null;
    },

    temConflito(dataISO) {
      const evs = this.eventosDoDia(dataISO);
      const pessoal = evs.filter((e) => e.tipo === "pessoal");
      const trabalho = evs.filter((e) => e.tipo === "trabalho");
      for (const p of pessoal) {
        for (const t of trabalho) {
          if (new Date(p.starts_at) < new Date(t.ends_at) && new Date(t.starts_at) < new Date(p.ends_at)) {
            return true;
          }
        }
      }
      return false;
    },

    selecionarDia(dataISO) {
      if (!dataISO) return;
      this.diaSelecionado = dataISO;
      this.eventoEditando = null;
      this.formEvento = { title: "", data: dataISO, hora_inicio: "09:00", hora_fim: "10:00", tipo: "pessoal", location: "", notes: "", status_trabalho: "aberto" };
    },

    editarEvento(ev) {
      this.eventoEditando = ev;
      this.diaSelecionado = ev.starts_at.slice(0, 10);
      this.formEvento = {
        title: ev.title,
        data: ev.starts_at.slice(0, 10),
        hora_inicio: ev.starts_at.slice(11, 16),
        hora_fim: ev.ends_at.slice(11, 16),
        tipo: ev.tipo,
        location: ev.location || "",
        notes: ev.notes || "",
        status_trabalho: ev.status_trabalho || "aberto",
      };
    },

    podeEditar(ev) {
      return this.isAdmin || ev.tipo === "pessoal";
    },

    async salvarEvento() {
      const f = this.formEvento;
      if (!f.title || !f.data) return alert("Preencha pelo menos o título e a data.");
      if (f.tipo === "trabalho" && !this.isAdmin) return alert("Só o administrador pode criar eventos de trabalho.");
      const payload = {
        title: f.title,
        starts_at: `${f.data}T${f.hora_inicio}:00`,
        ends_at: `${f.data}T${f.hora_fim}:00`,
        tipo: f.tipo,
        location: f.location || null,
        notes: f.notes || null,
        status_trabalho: f.tipo === "trabalho" ? f.status_trabalho : null,
        origem: this.eventoEditando?.origem || "manual",
      };
      let error;
      if (this.eventoEditando) {
        ({ error } = await supabase.from("events").update(payload).eq("id", this.eventoEditando.id));
      } else {
        ({ error } = await supabase.from("events").insert(payload));
      }
      if (error) return alert("Erro ao salvar evento: " + error.message);
      await this.recarregarEventos();
      this.diaSelecionado = null;
      this.eventoEditando = null;
    },

    async excluirEvento(ev) {
      if (!confirm(`Excluir "${ev.title}"? Não tem como desfazer.`)) return;
      const { error } = await supabase.from("events").delete().eq("id", ev.id);
      if (error) return alert("Erro ao excluir: " + error.message);
      await this.recarregarEventos();
    },

    async recarregarEventos() {
      const { data } = await supabase.from("events").select("*").order("starts_at");
      this.events = data || [];
    },

    // métricas de produtividade (só sobre eventos tipo = trabalho)
    get prazosAbertos() {
      return this.events.filter((e) => e.tipo === "trabalho" && e.status_trabalho === "aberto").length;
    },
    get prazosConcluidos() {
      return this.events.filter((e) => e.tipo === "trabalho" && e.status_trabalho === "concluido").length;
    },
    get conflitosNoAno() {
      const dias = new Set(this.events.map((e) => e.starts_at.slice(0, 10)));
      let n = 0;
      for (const d of dias) if (this.temConflito(d)) n++;
      return n;
    },

    // importação de prazos do sistema de joias (JSON manual, só admin)
    abrirImportarPrazos() {
      this.$refs.inputPrazos.click();
    },

    async importarPrazos(event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const texto = await file.text();
        const itens = JSON.parse(texto);
        if (!Array.isArray(itens)) throw new Error("O arquivo precisa ser uma lista [ {id, titulo, prazo, status}, ... ]");
        let criados = 0, atualizados = 0;
        for (const item of itens) {
          const { data: existente } = await supabase.from("events").select("id").eq("ref_externa", item.id).maybeSingle();
          const payload = {
            title: item.titulo,
            starts_at: `${item.prazo}T09:00:00`,
            ends_at: `${item.prazo}T10:00:00`,
            tipo: "trabalho",
            origem: "formulario_vinculado",
            ref_externa: item.id,
            status_trabalho: item.status || "aberto",
          };
          if (existente) {
            await supabase.from("events").update(payload).eq("id", existente.id);
            atualizados++;
          } else {
            await supabase.from("events").insert(payload);
            criados++;
          }
        }
        alert(`Prazos importados: ${criados} novos, ${atualizados} atualizados.`);
        await this.recarregarEventos();
      } catch (e) {
        alert("Erro ao importar prazos: " + e.message);
      } finally {
        event.target.value = "";
      }
    },

    statusBadgeClass(status) {
      return status === "pago"
        ? "bg-green-100 text-green-800"
        : "bg-amber-100 text-amber-800";
    },

    fmtMoeda(v) {
      return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    },

    fmtData(d) {
      if (!d) return "—";
      const [y, m, day] = d.split("-");
      return `${day}/${m}/${y}`;
    },

    billName(fixedBillId) {
      return this.fixedBills.find((b) => b.id === fixedBillId)?.name || "—";
    },
  })
);

// Importamos o Alpine como módulo (em vez de tag <script defer>) justamente pra
// garantir que Alpine.data("appState", ...) acima SEMPRE rode antes de Alpine.start().
// Eliminamos assim a corrida de carregamento que causava "appState is not defined".
window.Alpine = Alpine;
Alpine.start();

function traduzErroAuth(msg) {
  if (!msg) return "Erro ao entrar. Tente de novo.";
  if (msg.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("User already registered")) return "Esse e-mail já tem cadastro. Use 'Entrar'.";
  if (msg.includes("Password should be at least")) return "Senha precisa ter pelo menos 6 caracteres.";
  if (msg.includes("Email not confirmed")) return "Este e-mail ainda não foi confirmado. Fale com o administrador do app.";
  if (msg.includes("Signups not allowed")) return "Cadastro de novas contas está desativado no momento. Fale com o administrador do app.";
  if (msg.includes("Unable to validate email address")) return "Esse e-mail não parece válido. Confira e tente de novo.";
  if (msg.includes("Email rate limit exceeded")) return "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.";
  if (msg.includes("User not found")) return "Não encontramos uma conta com esse e-mail.";
  if (msg.includes("Network")) return "Falha de conexão. Confira sua internet e tente de novo.";
  return "Erro ao entrar: " + msg;
}
