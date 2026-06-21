import { supabase } from "./supabaseClient.js";

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

document.addEventListener("alpine:init", () => {
  Alpine.data("appState", () => ({
    // auth
    view: "loading", // loading | login | app
    authMode: "entrar", // entrar | criar
    email: "",
    password: "",
    showPassword: false,
    authError: "",
    authLoading: false,

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

    async init() {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await this.loadAfterLogin();
      } else {
        this.view = "login";
      }
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session && this.view !== "app") {
          await this.loadAfterLogin();
        }
        if (!session) {
          this.view = "login";
          this.profile = null;
        }
      });
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
      const [{ data: categories }, { data: fixedBills }, { data: billPayments }, { data: transactions }] =
        await Promise.all([
          supabase.from("categories").select("*").order("name"),
          supabase.from("fixed_bills").select("*").order("due_day"),
          supabase.from("bill_payments").select("*").order("due_date", { ascending: false }),
          supabase.from("transactions").select("*").order("date", { ascending: false }),
        ]);
      this.categories = categories || [];
      this.fixedBills = fixedBills || [];
      this.billPayments = billPayments || [];
      this.transactions = transactions || [];

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
  }));
});

function traduzErroAuth(msg) {
  if (!msg) return "Erro ao entrar.";
  if (msg.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (msg.includes("User already registered")) return "Esse e-mail já tem cadastro. Use 'Entrar'.";
  if (msg.includes("Password should be at least")) return "Senha precisa ter pelo menos 6 caracteres.";
  return msg;
}
