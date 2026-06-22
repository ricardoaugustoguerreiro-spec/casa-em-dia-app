import { supabase } from "./supabaseClient.js";
import Alpine from "https://esm.sh/alpinejs@3.14.3";
import { nomeFeriado } from "./feriados.js";
import { faseLua, luaMarcante } from "./lua.js";
import { VAPID_PUBLIC_KEY } from "./config.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

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
    uid: null,
    notificacaoStatus: "default", // default | granted | denied | unsupported
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
    formEvento: { title: "", data: "", hora_inicio: "09:00", hora_fim: "10:00", tipo: "pessoal", conjunto: false, location: "", notes: "", status_trabalho: "aberto" },

    // ciclo menstrual (privado, marcado dia a dia) + registro íntimo
    diasMenstruacao: [],
    duracaoCicloPadrao: 28,
    editandoDuracaoCiclo: false,
    formDuracaoCiclo: 28,
    registrosIntimos: [],

    async init() {
      this.atualizarStatusNotificacao();
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

    // ===================== NOTIFICAÇÕES PUSH =====================

    atualizarStatusNotificacao() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        this.notificacaoStatus = "unsupported";
        return;
      }
      this.notificacaoStatus = Notification.permission; // 'default' | 'granted' | 'denied'
    },

    async ativarNotificacoes() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        this.notificacaoStatus = "unsupported";
        return alert("Esse navegador/dispositivo não suporta notificações push. No iPhone, o app precisa estar instalado na tela inicial (Adicionar à Tela de Início) e o iOS precisa ser 16.4 ou mais novo.");
      }
      const permissao = await Notification.requestPermission();
      this.notificacaoStatus = permissao;
      if (permissao !== "granted") return;

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }
      const json = subscription.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: this.uid,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
        { onConflict: "user_id,endpoint" }
      );
      if (error) return alert("Erro ao ativar notificações: " + error.message);
      alert("Notificações ativadas! Você vai receber avisos de contas/prazos vencendo, eventos do calendário e conflitos de agenda.");
    },

    async loadAfterLogin() {
      this.loadingData = true;
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      this.uid = uid || null;
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
      const [{ data: categories }, { data: fixedBills }, { data: billPayments }, { data: transactions }, { data: events }, { data: diasMenstruacao }, { data: registrosIntimos }] =
        await Promise.all([
          supabase.from("categories").select("*").order("name"),
          supabase.from("fixed_bills").select("*").order("due_day"),
          supabase.from("bill_payments").select("*").order("due_date", { ascending: false }),
          supabase.from("transactions").select("*").order("date", { ascending: false }),
          supabase.from("events").select("*").order("starts_at"),
          supabase.from("dias_menstruacao").select("*").order("data"),
          supabase.from("registros_intimos").select("*").order("data", { ascending: false }),
        ]);
      this.categories = categories || [];
      this.fixedBills = fixedBills || [];
      this.billPayments = billPayments || [];
      this.transactions = transactions || [];
      this.events = events || [];
      this.diasMenstruacao = diasMenstruacao || [];
      this.registrosIntimos = registrosIntimos || [];

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

    hojeISO() {
      return new Date().toISOString().slice(0, 10);
    },

    ehHoje(dataISO) {
      return dataISO === this.hojeISO();
    },

    luaDoDia(dataISO) {
      return dataISO ? faseLua(dataISO) : null;
    },

    luaMarcanteDoDia(dataISO) {
      return dataISO ? luaMarcante(dataISO) : null;
    },

    // ===================== CICLO MENSTRUAL (privado, marcado dia a dia) =====================

    addDias(dataISO, n) {
      const d = new Date(dataISO + "T00:00:00");
      d.setDate(d.getDate() + n);
      return d.toISOString().slice(0, 10);
    },

    diffDias(de, para) {
      return Math.round((new Date(para + "T00:00:00") - new Date(de + "T00:00:00")) / 86400000);
    },

    diaDeMenstruacao(dataISO) {
      return this.diasMenstruacao.some((d) => d.data === dataISO);
    },

    async marcarDiaMenstruacao(dataISO) {
      if (this.diaDeMenstruacao(dataISO)) {
        const { error } = await supabase.from("dias_menstruacao").delete().eq("user_id", this.uid).eq("data", dataISO);
        if (error) return alert("Erro ao desmarcar: " + error.message);
      } else {
        const { error } = await supabase.from("dias_menstruacao").insert({ user_id: this.uid, data: dataISO });
        if (error) return alert("Erro ao marcar: " + error.message);
      }
      await this.loadDashboard();
    },

    // agrupa os dias marcados em "ciclos" (sequências consecutivas) pra aprender a duração real
    get streaksMenstruacao() {
      const datas = [...new Set(this.diasMenstruacao.map((d) => d.data))].sort();
      const streaks = [];
      for (const d of datas) {
        const atual = streaks[streaks.length - 1];
        if (atual && this.addDias(atual.fim, 1) === d) {
          atual.fim = d;
          atual.duracao++;
        } else {
          streaks.push({ inicio: d, fim: d, duracao: 1 });
        }
      }
      return streaks;
    },

    get configCiclo() {
      const streaks = this.streaksMenstruacao;
      if (!streaks.length) return null;
      const ultimo = streaks[streaks.length - 1];
      let duracaoCiclo = this.duracaoCicloPadrao;
      if (streaks.length >= 2) {
        const gaps = [];
        for (let i = 1; i < streaks.length; i++) gaps.push(this.diffDias(streaks[i - 1].inicio, streaks[i].inicio));
        duracaoCiclo = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }
      const duracaoPeriodo = Math.round(streaks.reduce((a, s) => a + s.duracao, 0) / streaks.length) || 5;
      return { inicioUltimoCiclo: ultimo.inicio, duracaoCiclo, duracaoPeriodo, baseadoEmHistorico: streaks.length >= 2 };
    },

    faseCicloDoDia(dataISO) {
      if (!dataISO) return null;
      if (this.diaDeMenstruacao(dataISO)) return "menstrual";
      const cfg = this.configCiclo;
      if (!cfg) return null;
      const diff = this.diffDias(cfg.inicioUltimoCiclo, dataISO);
      const duracaoCiclo = cfg.duracaoCiclo;
      const diaDoCiclo = (((diff % duracaoCiclo) + duracaoCiclo) % duracaoCiclo) + 1;
      const ovulacaoDia = duracaoCiclo - 14;
      const fertilInicio = ovulacaoDia - 5;
      const fertilFim = ovulacaoDia + 1;
      if (diaDoCiclo === ovulacaoDia) return "ovulacao";
      if (diaDoCiclo >= fertilInicio && diaDoCiclo <= fertilFim) return "fertil";
      return null;
    },

    get cicloInfo() {
      const cfg = this.configCiclo;
      if (!cfg) return null;
      const hoje = this.hojeISO();
      const diff = this.diffDias(cfg.inicioUltimoCiclo, hoje);
      const duracaoCiclo = cfg.duracaoCiclo;
      const diaDoCiclo = (((diff % duracaoCiclo) + duracaoCiclo) % duracaoCiclo) + 1;
      const ovulacaoDia = duracaoCiclo - 14;
      const fertilInicio = ovulacaoDia - 5;
      const fertilFim = ovulacaoDia + 1;

      let fase;
      if (this.diaDeMenstruacao(hoje)) fase = "Menstruação";
      else if (diaDoCiclo === ovulacaoDia) fase = "Ovulação";
      else if (diaDoCiclo >= fertilInicio && diaDoCiclo <= fertilFim) fase = "Período fértil";
      else if (diaDoCiclo < fertilInicio) fase = "Fase folicular";
      else fase = "Fase lútea";

      const ciclosCompletos = Math.floor(diff / duracaoCiclo) + 1;
      const inicioCicloAtual = this.addDias(cfg.inicioUltimoCiclo, (ciclosCompletos - 1) * duracaoCiclo);

      return {
        diaDoCiclo,
        duracaoCiclo,
        fase,
        baseadoEmHistorico: cfg.baseadoEmHistorico,
        fertilInicio: this.addDias(inicioCicloAtual, fertilInicio - 1),
        fertilFim: this.addDias(inicioCicloAtual, fertilFim - 1),
        ovulacao: this.addDias(inicioCicloAtual, ovulacaoDia - 1),
        proximaMenstruacao: this.addDias(inicioCicloAtual, duracaoCiclo),
      };
    },

    abrirEditarDuracaoCiclo() {
      this.formDuracaoCiclo = this.configCiclo?.duracaoCiclo || this.duracaoCicloPadrao;
      this.editandoDuracaoCiclo = true;
    },

    salvarDuracaoCiclo() {
      this.duracaoCicloPadrao = Number(this.formDuracaoCiclo) || 28;
      this.editandoDuracaoCiclo = false;
    },

    intimoDoDia(dataISO) {
      return this.registrosIntimos.find((r) => r.data === dataISO) || null;
    },

    async salvarIntimo(dataISO, preservativo) {
      const { error } = await supabase
        .from("registros_intimos")
        .upsert({ user_id: this.uid, data: dataISO, preservativo }, { onConflict: "user_id,data" });
      if (error) return alert("Erro ao salvar registro: " + error.message);
      await this.loadDashboard();
    },

    async excluirIntimo(dataISO) {
      const { error } = await supabase
        .from("registros_intimos")
        .delete()
        .eq("user_id", this.uid)
        .eq("data", dataISO);
      if (error) return alert("Erro ao excluir registro: " + error.message);
      await this.loadDashboard();
    },

    // conflito = dois eventos que eu vejo (meus ou conjuntos) com horário sobreposto no mesmo dia
    temConflito(dataISO) {
      const evs = this.eventosDoDia(dataISO);
      for (let i = 0; i < evs.length; i++) {
        for (let j = i + 1; j < evs.length; j++) {
          const a = evs[i], b = evs[j];
          if (new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at)) return true;
        }
      }
      return false;
    },

    selecionarDia(dataISO) {
      if (!dataISO) return;
      this.diaSelecionado = dataISO;
      this.eventoEditando = null;
      this.formEvento = { title: "", data: dataISO, hora_inicio: "09:00", hora_fim: "10:00", tipo: "pessoal", conjunto: false, location: "", notes: "", status_trabalho: "aberto" };
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
        conjunto: ev.conjunto,
        location: ev.location || "",
        notes: ev.notes || "",
        status_trabalho: ev.status_trabalho || "aberto",
      };
    },

    podeEditar(ev) {
      return ev.owner_id === this.uid || ev.conjunto;
    },

    async salvarEvento() {
      const f = this.formEvento;
      if (!f.title || !f.data) return alert("Preencha pelo menos o título e a data.");
      const payload = {
        title: f.title,
        starts_at: `${f.data}T${f.hora_inicio}:00`,
        ends_at: `${f.data}T${f.hora_fim}:00`,
        tipo: f.tipo,
        conjunto: !!f.conjunto,
        location: f.location || null,
        notes: f.notes || null,
        status_trabalho: f.tipo === "trabalho" ? f.status_trabalho : null,
        origem: this.eventoEditando?.origem || "manual",
      };
      if (!this.eventoEditando) payload.owner_id = this.uid;
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
            conjunto: false,
            origem: "formulario_vinculado",
            ref_externa: item.id,
            status_trabalho: item.status || "aberto",
          };
          if (existente) {
            await supabase.from("events").update(payload).eq("id", existente.id);
            atualizados++;
          } else {
            await supabase.from("events").insert({ ...payload, owner_id: this.uid });
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
