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

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export const CARTOES_FAMILIA = [
  "Itaú Ricardo",
  "Itaú Jéssica (Pão de Açúcar)",
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
    bloqueado: false, // true = sessão já restaurada, mas esperando Face ID/digital pra mostrar os dados
    biometriaSuportada: typeof window !== "undefined" && !!window.PublicKeyCredential,
    biometriaErro: "",
    fixedBills: [],
    billPayments: [],
    categories: [],
    transactions: [],
    cardTotals: [],
    grandTotalCards: 0,
    balances: [],
    loadingData: true,
    abaAtual: "financeiro", // financeiro | calendario | ajustes
    abaFinanceiro: "resumo", // resumo | contas_fixas | dia_a_dia | cartao_variaveis
    mesFinanceiro: new Date().toISOString().slice(0, 7), // "AAAA-MM"
    formPerfil: { display_name: "", color: "#7c3aed" },
    formSaldo: { amount: "", notes: "" },
    formCategoria: { name: "", kind: "variavel", color: "#64748b" },
    criandoContaFixa: false,
    formContaFixa: { name: "", amount: "", due_day: "10", category_id: "", vence_mes_seguinte: false },
    editandoContaFixa: null,
    criandoTransacao: false,
    formTransacao: { description: "", amount: "", date: "", account: "", kind: "diaria", category_id: "", pessoa: "jessica" },
    editandoTransacao: null,
    abaAnualAberta: null, // "AAAA-MM" do mês expandido na Visão Anual
    anoVisaoAnual: new Date().getFullYear(),
    filtroCategoriaTransacao: "",
    editandoPagamento: null,
    formPagamento: { amount: "", due_date: "", status: "pendente" },
    comprasParceladas: [],
    criandoParcelada: false,
    formParcelada: { descricao: "", cartao: "", valor_parcela: "", parcela_inicio: "", parcela_fim: "" },
    importandoCsv: false,
    resultadoImportacao: null,

    // cartões da família (fatura mensal editável, dentro de Contas Fixas)
    cartoes: [],
    faturasCartao: [],
    editandoFatura: null,
    formFatura: { amount: "", status: "pendente" },

    // dia a dia: gasto real lançado manualmente OU previsão de gasto futuro
    diaADia: [],
    criandoDiaADia: false,
    formDiaADia: { data: "", descricao: "", valor: "", observacao: "", status: "realizado" },
    editandoDiaADia: null,
    criandoPrevisaoGrupo: false,
    formPrevisaoGrupo: { nome: "", dias: [{ data: "", valor: "" }] },

    // calendário
    events: [],
    tarefasJoias: [], // sincronizado automaticamente do Sistema de Joias (Alfa 3D)
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
        if (this.temBiometriaAtiva(data.session.user.id)) {
          // não carrega os dados ainda — só libera depois do Face ID/digital,
          // pra ninguém abrir o app e já ver financeiro/ciclo sem desbloquear.
          this.uid = data.session.user.id;
          this.view = "app";
          this.bloqueado = true;
          this.loadingData = false;
        } else {
          await this.loadAfterLogin();
        }
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

    // ===================== DESBLOQUEIO POR BIOMETRIA (Face ID / digital) =====================
    // Não é autenticação nova — a sessão do Supabase já está válida (persistSession).
    // É só uma trava local: usa o leitor biométrico do aparelho (via WebAuthn) pra
    // confirmar "é você mesmo" antes de mostrar os dados, sem precisar digitar senha
    // de novo. O credential fica só nesse dispositivo (não sincroniza entre celulares).

    chaveBiometria(uid) {
      return `casa-em-dia:biometria:${uid}`;
    },

    temBiometriaAtiva(uid) {
      return this.biometriaSuportada && !!localStorage.getItem(this.chaveBiometria(uid));
    },

    async ativarBiometria() {
      this.biometriaErro = "";
      if (!this.biometriaSuportada) return alert("Esse navegador/dispositivo não suporta Face ID/digital (WebAuthn).");
      try {
        const credential = await navigator.credentials.create({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: "Casa em Dia" },
            user: {
              id: crypto.getRandomValues(new Uint8Array(16)),
              name: this.profile?.display_name || "usuário",
              displayName: this.profile?.display_name || "usuário",
            },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
            timeout: 60000,
          },
        });
        if (!credential) throw new Error("Não foi possível criar a credencial.");
        localStorage.setItem(this.chaveBiometria(this.uid), bufferToBase64(credential.rawId));
        alert("Desbloqueio por Face ID/digital ativado nesse aparelho!");
      } catch (e) {
        this.biometriaErro = "Não consegui ativar: " + e.message;
      }
    },

    desativarBiometria() {
      localStorage.removeItem(this.chaveBiometria(this.uid));
    },

    async desbloquear() {
      this.biometriaErro = "";
      try {
        const credId = localStorage.getItem(this.chaveBiometria(this.uid));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{ id: base64ToBuffer(credId), type: "public-key" }],
            userVerification: "required",
            timeout: 60000,
          },
        });
        if (!assertion) throw new Error("Desbloqueio cancelado.");
        this.bloqueado = false;
        await this.loadAfterLogin();
      } catch (e) {
        this.biometriaErro = "Não foi possível desbloquear: " + e.message;
      }
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
        if (profile) this.formPerfil = { display_name: profile.display_name, color: profile.color };
      }
      this.view = "app";
      await this.loadDashboard();
      await this.garantirContasFixasDoMes(this.mesFinanceiro);
      await this.garantirFaturasCartaoDoMes(this.mesFinanceiro);
      this.loadingData = false;
      this.$nextTick(() => this.animateCards());
    },

    async loadDashboard() {
      const [{ data: categories }, { data: fixedBills }, { data: billPayments }, { data: transactions }, { data: events }, { data: diasMenstruacao }, { data: registrosIntimos }, { data: balances }, { data: comprasParceladas }, { data: tarefasJoias }, { data: cartoes }, { data: faturasCartao }, { data: diaADia }] =
        await Promise.all([
          supabase.from("categories").select("*").order("name"),
          supabase.from("fixed_bills").select("*").order("due_day"),
          supabase.from("bill_payments").select("*").order("due_date", { ascending: false }),
          supabase.from("transactions").select("*").order("date", { ascending: false }),
          supabase.from("events").select("*").order("starts_at"),
          supabase.from("dias_menstruacao").select("*").order("data"),
          supabase.from("registros_intimos").select("*").order("data", { ascending: false }),
          supabase.from("balances").select("*").order("as_of", { ascending: false }),
          supabase.from("compras_parceladas").select("*").order("parcela_inicio"),
          supabase.from("tarefas_joias").select("*").order("prazo", { ascending: true, nullsFirst: false }),
          supabase.from("cartoes").select("*").order("nome"),
          supabase.from("faturas_cartao").select("*"),
          supabase.from("dia_a_dia").select("*").order("data", { ascending: false }),
        ]);
      this.categories = categories || [];
      this.fixedBills = fixedBills || [];
      this.billPayments = billPayments || [];
      this.transactions = transactions || [];
      this.events = events || [];
      this.diasMenstruacao = diasMenstruacao || [];
      this.registrosIntimos = registrosIntimos || [];
      this.balances = balances || [];
      this.comprasParceladas = comprasParceladas || [];
      this.tarefasJoias = tarefasJoias || [];
      this.cartoes = cartoes || [];
      this.faturasCartao = faturasCartao || [];
      this.diaADia = diaADia || [];

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

    async marcarPago(p) {
      const novoStatus = p.status === "pago" ? "pendente" : "pago";
      const payload = { status: novoStatus, paid_at: novoStatus === "pago" ? new Date().toISOString() : null };
      const { error } = await supabase.from("bill_payments").update(payload).eq("id", p.id);
      if (error) return alert("Erro ao atualizar: " + error.message);
      Object.assign(p, payload);
    },

    abrirEditarPagamento(p) {
      this.editandoPagamento = p;
      this.formPagamento = { amount: p.amount, due_date: p.due_date, status: p.status };
    },

    async salvarPagamento() {
      const f = this.formPagamento;
      const payload = {
        amount: Number(f.amount),
        due_date: f.due_date,
        status: f.status,
        paid_at: f.status === "pago" ? (this.editandoPagamento.paid_at || new Date().toISOString()) : null,
      };
      const { error } = await supabase.from("bill_payments").update(payload).eq("id", this.editandoPagamento.id);
      if (error) return alert("Erro ao salvar: " + error.message);
      Object.assign(this.editandoPagamento, payload);
      this.editandoPagamento = null;
    },

    // ===================== COMPRAS PARCELADAS (cartão) =====================

    abrirNovaParcelada() {
      this.formParcelada = { descricao: "", cartao: "", valor_parcela: "", parcela_inicio: this.mesFinanceiro, parcela_fim: "" };
      this.criandoParcelada = true;
    },

    async salvarParcelada() {
      const f = this.formParcelada;
      if (!f.descricao || !f.valor_parcela || !f.parcela_inicio || !f.parcela_fim) return alert("Preencha descrição, valor da parcela, início e fim.");
      const { error } = await supabase.from("compras_parceladas").insert({
        descricao: f.descricao,
        cartao: f.cartao || null,
        valor_parcela: Number(f.valor_parcela),
        parcela_inicio: f.parcela_inicio.length === 7 ? f.parcela_inicio + "-01" : f.parcela_inicio,
        parcela_fim: f.parcela_fim.length === 7 ? f.parcela_fim + "-01" : f.parcela_fim,
        created_by: this.uid,
      });
      if (error) return alert("Erro ao salvar: " + error.message);
      this.criandoParcelada = false;
      await this.loadDashboard();
    },

    async excluirParcelada(id) {
      if (!confirm("Excluir esta compra parcelada? Não tem como desfazer.")) return;
      const { error } = await supabase.from("compras_parceladas").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.comprasParceladas = this.comprasParceladas.filter((c) => c.id !== id);
    },

    // ===================== CONFERÊNCIA DE FATURA DE CARTÃO (CSV) =====================
    // Sobe o CSV exportado da fatura (PDF ainda não tem parser confiável) e compara
    // lançamento por lançamento com o que já foi anotado no Dia a Dia, pra achar
    // o que bateu e o que ficou de fora (gasto não lançado, ou lançado errado).

    cartaoConferenciaId: "",
    resultadoConferencia: null,

    abrirConferenciaCartao() {
      this.$refs.inputConferenciaCartao.click();
    },

    async processarConferenciaCartao(event) {
      const file = event.target.files[0];
      if (!file || !this.cartaoConferenciaId) return;
      const texto = await file.text();
      const delim = texto.includes(";") ? ";" : ",";
      const linhasTexto = texto.split(/\r?\n/).filter((l) => l.trim());
      const inicioIdx = linhasTexto.findIndex((l) => /data/i.test(l) && /(valor|descri|estabelec)/i.test(l));
      const linhasDados = inicioIdx >= 0 ? linhasTexto.slice(inicioIdx + 1) : linhasTexto;

      const lancamentosFatura = [];
      for (const linha of linhasDados) {
        const campos = linha.split(delim).map((c) => c.trim());
        if (campos.length < 2) continue;
        const dataMatch = campos.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c) || /^\d{2}\/\d{2}$/.test(c));
        if (!dataMatch) continue;
        let dataISO;
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataMatch)) {
          const [d, m, a] = dataMatch.split("/");
          dataISO = `${a}-${m}-${d}`;
        } else {
          const [d, m] = dataMatch.split("/");
          dataISO = `${this.mesFinanceiro.slice(0, 4)}-${m}-${d}`;
        }
        const valorStr = [...campos].reverse().find((c) => /^-?[\d.,]+$/.test(c) && c.replace(/[.,]/g, "").length > 0);
        if (!valorStr) continue;
        const valor = Math.abs(parseFloat(valorStr.replace(/\./g, "").replace(",", ".")));
        if (isNaN(valor) || valor === 0) continue;
        const descricao = campos.filter((c) => c !== dataMatch && c !== valorStr).join(" ").trim() || "Lançamento da fatura";
        lancamentosFatura.push({ data: dataISO, descricao, valor });
      }

      const lancadosNoApp = this.diaADia.filter((d) => d.status === "realizado");
      const comparativo = lancamentosFatura.map((l) => {
        const match = lancadosNoApp.find((d) => Math.abs(Number(d.valor) - l.valor) < 0.01 && Math.abs(this.diffDias(d.data, l.data)) <= 3);
        return { ...l, encontrado: !!match, lancamentoApp: match || null };
      });

      this.resultadoConferencia = {
        cartao: this.cartaoNome(this.cartaoConferenciaId),
        total: comparativo.length,
        encontrados: comparativo.filter((c) => c.encontrado).length,
        naoEncontrados: comparativo.filter((c) => !c.encontrado),
      };
      event.target.value = "";
    },

    diffDias(dataA, dataB) {
      return (new Date(dataA) - new Date(dataB)) / 86400000;
    },

    // ===================== IMPORTAR CSV (concilia contas fixas + cria lançamentos) =====================

    abrirImportarCsv() {
      this.$refs.inputCsv.click();
    },

    async importarCsv(event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const texto = await file.text();
        const delim = texto.includes(";") ? ";" : ",";
        const linhasTexto = texto.split(/\r?\n/).filter((l) => l.trim());
        const inicioIdx = linhasTexto.findIndex((l) => /data/i.test(l) && /(valor|descri)/i.test(l));
        const linhasDados = inicioIdx >= 0 ? linhasTexto.slice(inicioIdx + 1) : linhasTexto;

        let contasMarcadas = 0;
        let novosLancamentos = 0;

        for (const linha of linhasDados) {
          const campos = linha.split(delim).map((c) => c.trim());
          if (campos.length < 3) continue;
          const dataMatch = campos.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
          if (!dataMatch) continue;
          const [dia, mes, ano] = dataMatch.split("/");
          const dataISO = `${ano}-${mes}-${dia}`;
          if (dataISO.slice(0, 7) !== this.mesFinanceiro) continue; // só dentro do mês selecionado
          if (dataISO > this.hojeISO()) continue; // não importa data futura

          const valorStr = campos.reverse().find((c) => /^-?[\d.,]+$/.test(c) && c.replace(/[.,]/g, "").length > 0);
          campos.reverse();
          if (!valorStr) continue;
          const valor = parseFloat(valorStr.replace(/\./g, "").replace(",", "."));
          if (isNaN(valor) || valor === 0) continue;

          const descricao = campos.filter((c) => c !== dataMatch && c !== valorStr).join(" ").trim() || "Lançamento importado";
          const descNorm = descricao.toLowerCase();

          const categoria = this.categories.find((c) => (c.keywords || []).some((k) => descNorm.includes(k.toLowerCase())));

          // tenta conciliar com uma conta fixa pendente desse mês, da mesma categoria
          let conciliado = false;
          if (categoria) {
            const billDaCategoria = this.fixedBills.find((b) => b.category_id === categoria.id);
            if (billDaCategoria) {
              const pagamento = this.billPayments.find(
                (p) => p.fixed_bill_id === billDaCategoria.id && p.due_date.slice(0, 7) === this.mesFinanceiro && p.status === "pendente"
              );
              if (pagamento) {
                const payload = { status: "pago", paid_at: dataISO, amount: Math.abs(valor) };
                const { error } = await supabase.from("bill_payments").update(payload).eq("id", pagamento.id);
                if (!error) {
                  Object.assign(pagamento, payload);
                  contasMarcadas++;
                  conciliado = true;
                }
              }
            }
          }

          if (!conciliado) {
            const { error } = await supabase.from("transactions").insert({
              date: dataISO,
              description: descricao,
              amount: Math.abs(valor),
              kind: valor > 0 ? "renda" : categoria?.kind === "diaria" ? "diaria" : "variavel",
              category_id: categoria?.id || null,
              source: "importacao_csv",
              created_by: this.uid,
            });
            if (!error) novosLancamentos++;
          }
        }

        this.resultadoImportacao = { contasMarcadas, novosLancamentos };
        await this.loadDashboard();
        this.$nextTick(() => this.animateCards());
      } catch (e) {
        alert("Erro ao importar: " + e.message);
      } finally {
        event.target.value = "";
      }
    },

    // ===================== RESUMO FINANCEIRO (aba Financeiro) =====================
    // Todos os cards abaixo seguem o mês selecionado em "mesFinanceiro" (navegação ‹ Mês ›),
    // não o mês real de hoje — por isso "Marcar pago"/edição sempre refletem na hora.

    // contas fixas pagas (bill_payments) também contam como gasto — só transactions
    // subestimaria o mês, já que Internet/Água/Luz/Casa/IPTU/MEI/Carro vivem só ali.
    // Cartões (faturas_cartao) e Dia a Dia realizado entram do mesmo jeito.
    get gastoDoMes() {
      const gastoTransacoes = this.transactions
        .filter((t) => t.date.slice(0, 7) === this.mesFinanceiro && t.kind !== "renda" && !t.transferencia_interna)
        .reduce((s, t) => s + Number(t.amount), 0);
      const gastoContas = this.billPaymentsDoMes
        .filter((p) => p.status === "pago")
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const gastoCartoes = this.faturasCartaoDoMes
        .filter((f) => f.status === "pago")
        .reduce((s, f) => s + Number(f.amount || 0), 0);
      return gastoTransacoes + gastoContas + gastoCartoes + this.totalDiaADiaRealizadoDoMes;
    },

    // previsão de gasto do mês = o que já é real + o que ainda está previsto pra
    // acontecer (Dia a Dia previsto) + faturas de cartão ainda pendentes de valor real.
    get gastoPrevistoDoMes() {
      const cartoesPendentes = this.faturasCartaoDoMes
        .filter((f) => f.status === "pendente")
        .reduce((s, f) => s + Number(f.amount || 0), 0);
      return this.gastoDoMes + this.totalDiaADiaPrevistoDoMes + cartoesPendentes;
    },

    get gastoDaSemana() {
      const hoje = new Date(this.hojeISO() + "T00:00:00");
      const inicioSemana = new Date(hoje);
      inicioSemana.setDate(hoje.getDate() - hoje.getDay());
      const inicioISO = inicioSemana.toISOString().slice(0, 10);
      const hojeISO = this.hojeISO();
      const gastoTransacoes = this.transactions
        .filter((t) => t.date >= inicioISO && t.date <= hojeISO && t.kind !== "renda" && !t.transferencia_interna)
        .reduce((s, t) => s + Number(t.amount), 0);
      const gastoContas = this.billPayments
        .filter((p) => p.status === "pago" && p.paid_at && p.paid_at.slice(0, 10) >= inicioISO && p.paid_at.slice(0, 10) <= hojeISO)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      return gastoTransacoes + gastoContas;
    },

    // soma contas fixas + faturas de cartão pendentes — visão única do que falta pagar no mês
    get pendenteEmContas() {
      const contasPendentes = this.billPaymentsDoMes.filter((p) => p.status === "pendente");
      const cartoesPendentes = this.faturasCartaoDoMes.filter((f) => f.status === "pendente" && Number(f.amount || 0) > 0);
      return {
        total: contasPendentes.reduce((s, p) => s + Number(p.amount || 0), 0) + cartoesPendentes.reduce((s, f) => s + Number(f.amount || 0), 0),
        quantidade: contasPendentes.length + cartoesPendentes.length,
      };
    },

    get totalContasFixasDoMes() {
      return this.billPaymentsDoMes.reduce((s, p) => s + Number(p.amount || 0), 0);
    },

    // contas fixas + cartões juntos, o número "cheio" do mês (igual ao que já aparece em Contas Fixas)
    get totalContasFixasComCartoesDoMes() {
      return this.totalContasFixasDoMes + this.totalFaturasCartaoDoMes;
    },

    // bruta = tudo que entrou (inclui transferência interna entre Ricardo e Jéssica);
    // líquida = só dinheiro novo de fora do casal — a que realmente importa pra saúde financeira.
    get rendaBrutaDoMes() {
      const mes = this.mesFinanceiro;
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === mes && t.kind === "renda")
        .reduce((s, t) => s + Number(t.amount), 0);
    },

    get rendaDoMes() {
      const mes = this.mesFinanceiro;
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === mes && t.kind === "renda" && !t.transferencia_interna)
        .reduce((s, t) => s + Number(t.amount), 0);
    },

    get transacoesRendaDoMes() {
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === this.mesFinanceiro && t.kind === "renda")
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    // Renda do Ricardo é sempre automática (sync do Sistema de Joias, nunca lançada
    // na mão); renda da Jéssica é sempre manual, lançada na aba Renda.
    get rendaRicardoDoMes() {
      return this.transacoesRendaDoMes.filter((t) => t.pessoa === "ricardo");
    },

    get rendaJessicaDoMes() {
      return this.transacoesRendaDoMes.filter((t) => t.pessoa === "jessica");
    },

    get totalRendaRicardoDoMes() {
      return this.rendaRicardoDoMes.reduce((s, t) => s + Number(t.amount), 0);
    },

    get totalRendaJessicaDoMes() {
      return this.rendaJessicaDoMes.reduce((s, t) => s + Number(t.amount), 0);
    },

    // saldo do mês: renda líquida (já recebida) menos gasto do mês — pra saber se sobrou
    // ou se ficou negativo. Usa renda líquida (não bruta) porque transferência interna
    // entre Ricardo e Jéssica não é dinheiro novo de fora do casal.
    get saldoDoMes() {
      return this.rendaDoMes - this.gastoDoMes;
    },

    get transferenciasInternas() {
      return this.transactions
        .filter((t) => t.transferencia_interna)
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    // parcelas do cartão que caem no mês selecionado
    get parceladasDoMes() {
      const mes = this.mesFinanceiro;
      return this.comprasParceladas.filter((c) => c.parcela_inicio.slice(0, 7) <= mes && c.parcela_fim.slice(0, 7) >= mes);
    },

    get totalParceladasDoMes() {
      return this.parceladasDoMes.reduce((s, c) => s + Number(c.valor_parcela), 0);
    },

    diffMeses(mesIni, mesFim) {
      const [y1, m1] = mesIni.split("-").map(Number);
      const [y2, m2] = mesFim.split("-").map(Number);
      return (y2 - y1) * 12 + (m2 - m1);
    },

    // todas as parcelas ativas (não só as do mês selecionado), com progresso de quantas já passaram
    get parceladasComProgresso() {
      const hoje = this.hojeISO().slice(0, 7);
      return this.comprasParceladas
        .map((c) => {
          const inicio = c.parcela_inicio.slice(0, 7);
          const fim = c.parcela_fim.slice(0, 7);
          const totalParcelas = this.diffMeses(inicio, fim) + 1;
          const passadas = this.diffMeses(inicio, hoje) + 1;
          const pagas = Math.max(0, Math.min(totalParcelas, passadas));
          const restantes = totalParcelas - pagas;
          const status = hoje < inicio ? "futura" : hoje > fim ? "concluida" : "ativa";
          return { ...c, totalParcelas, pagas, restantes, status };
        })
        .sort((a, b) => a.parcela_inicio.localeCompare(b.parcela_inicio));
    },

    // ===================== AJUSTES (perfil, saldo, categorias) =====================

    async salvarPerfil() {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: this.formPerfil.display_name, color: this.formPerfil.color })
        .eq("id", this.uid);
      if (error) return alert("Erro ao salvar perfil: " + error.message);
      this.profile = { ...this.profile, ...this.formPerfil };
      alert("Perfil atualizado.");
    },

    async salvarSaldo() {
      if (!this.formSaldo.amount) return alert("Informe o valor do saldo.");
      const { error } = await supabase.from("balances").insert({
        user_id: this.uid,
        amount: Number(this.formSaldo.amount),
        notes: this.formSaldo.notes || null,
      });
      if (error) return alert("Erro ao salvar saldo: " + error.message);
      this.formSaldo = { amount: "", notes: "" };
      await this.loadDashboard();
    },

    async excluirSaldo(id) {
      const { error } = await supabase.from("balances").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.balances = this.balances.filter((b) => b.id !== id);
    },

    async salvarCategoria() {
      if (!this.formCategoria.name) return alert("Dê um nome pra categoria.");
      const { error } = await supabase.from("categories").insert({
        name: this.formCategoria.name,
        kind: this.formCategoria.kind,
        color: this.formCategoria.color,
        created_by: this.uid,
      });
      if (error) return alert("Erro ao criar categoria: " + error.message);
      this.formCategoria = { name: "", kind: "variavel", color: "#64748b" };
      await this.loadDashboard();
    },

    async excluirCategoria(id) {
      if (!confirm("Excluir esta categoria? Lançamentos que usam ela continuam, só perdem a categorização.")) return;
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.categories = this.categories.filter((c) => c.id !== id);
    },

    // ===================== FINANCEIRO: navegação mês a mês =====================

    async mesFinanceiroAnterior() {
      const [y, m] = this.mesFinanceiro.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      this.mesFinanceiro = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await this.garantirContasFixasDoMes(this.mesFinanceiro);
      await this.garantirFaturasCartaoDoMes(this.mesFinanceiro);
    },

    async mesFinanceiroSeguinte() {
      const [y, m] = this.mesFinanceiro.split("-").map(Number);
      const d = new Date(y, m, 1);
      this.mesFinanceiro = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await this.garantirContasFixasDoMes(this.mesFinanceiro);
      await this.garantirFaturasCartaoDoMes(this.mesFinanceiro);
    },

    // cria a fatura pendente (valor 0, editável) de cada cartão ativo pra esse mês,
    // igual ao padrão de garantirContasFixasDoMes — você edita o valor real depois.
    async garantirFaturasCartaoDoMes(mes) {
      const faltando = [];
      for (const cartao of this.cartoes.filter((c) => c.active !== false)) {
        const jaExiste = this.faturasCartao.some((f) => f.cartao_id === cartao.id && f.competencia === mes);
        if (jaExiste) continue;
        const mesVencimento = this.mesSeguinte(mes); // fatura sempre vence no mês seguinte à competência
        const [anoV, mesNumV] = mesVencimento.split("-").map(Number);
        const ultimoDiaDoMesVencimento = new Date(anoV, mesNumV, 0).getDate();
        const dia = Math.min(cartao.dia_vencimento, ultimoDiaDoMesVencimento);
        faltando.push({ cartao_id: cartao.id, competencia: mes, due_date: `${mesVencimento}-${String(dia).padStart(2, "0")}`, amount: 0, status: "pendente" });
      }
      if (!faltando.length) return;
      const { data, error } = await supabase.from("faturas_cartao").insert(faltando).select();
      if (!error && data) this.faturasCartao.push(...data);
    },

    get faturasCartaoDoMes() {
      return this.faturasCartao.filter((f) => f.competencia === this.mesFinanceiro).sort((a, b) => this.cartaoNome(a.cartao_id).localeCompare(this.cartaoNome(b.cartao_id)));
    },

    get totalFaturasCartaoDoMes() {
      return this.faturasCartaoDoMes.reduce((s, f) => s + Number(f.amount || 0), 0);
    },

    cartaoNome(cartaoId) {
      return this.cartoes.find((c) => c.id === cartaoId)?.nome || "Cartão";
    },

    // % do limite usado pela fatura desse cartão nesse mês — null se não sabemos o limite.
    percentualLimiteCartao(fatura) {
      const cartao = this.cartoes.find((c) => c.id === fatura.cartao_id);
      if (!cartao?.limite_credito) return null;
      return Number(fatura.amount || 0) / Number(cartao.limite_credito);
    },

    alertaLimiteCartao(fatura) {
      const pct = this.percentualLimiteCartao(fatura);
      if (pct === null) return null;
      if (pct >= 1) return "estourou";
      if (pct >= 0.9) return "perto";
      return null;
    },

    abrirEditarFatura(f) {
      this.editandoFatura = f;
      this.formFatura = { amount: f.amount, status: f.status };
    },

    async salvarFatura() {
      const payload = { amount: Number(this.formFatura.amount), status: this.formFatura.status, paid_at: this.formFatura.status === "pago" ? new Date().toISOString() : null };
      const { error } = await supabase.from("faturas_cartao").update(payload).eq("id", this.editandoFatura.id);
      if (error) return alert("Erro ao salvar fatura: " + error.message);
      Object.assign(this.faturasCartao.find((f) => f.id === this.editandoFatura.id), payload);
      this.editandoFatura = null;
    },

    // ===================== DIA A DIA: gasto real ou previsão de gasto futuro =====================

    get diaADiaDoMes() {
      return this.diaADia.filter((d) => d.data.slice(0, 7) === this.mesFinanceiro).sort((a, b) => b.data.localeCompare(a.data));
    },

    get totalDiaADiaRealizadoDoMes() {
      return this.diaADiaDoMes.filter((d) => d.status === "realizado").reduce((s, d) => s + Number(d.valor || 0), 0);
    },

    get totalDiaADiaPrevistoDoMes() {
      return this.diaADiaDoMes.filter((d) => d.status === "previsto").reduce((s, d) => s + Number(d.valor || 0), 0);
    },

    abrirNovoDiaADia(status) {
      this.criandoDiaADia = true;
      this.formDiaADia = { data: status === "previsto" ? "" : this.hojeISO(), descricao: "", valor: "", observacao: "", status };
    },

    abrirEditarDiaADia(d) {
      this.editandoDiaADia = d;
      this.formDiaADia = { data: d.data, descricao: d.descricao, valor: d.valor, observacao: d.observacao || "", status: d.status };
    },

    async salvarDiaADia() {
      const payload = {
        data: this.formDiaADia.data,
        descricao: this.formDiaADia.descricao,
        valor: Number(this.formDiaADia.valor),
        observacao: this.formDiaADia.observacao || null,
        status: this.formDiaADia.status,
        updated_at: new Date().toISOString(),
      };
      if (this.editandoDiaADia) {
        const { error } = await supabase.from("dia_a_dia").update(payload).eq("id", this.editandoDiaADia.id);
        if (error) return alert("Erro ao salvar: " + error.message);
        Object.assign(this.editandoDiaADia, payload);
        this.editandoDiaADia = null;
      } else {
        const { data, error } = await supabase.from("dia_a_dia").insert({ ...payload, owner_id: this.uid }).select().single();
        if (error) return alert("Erro ao salvar: " + error.message);
        this.diaADia.unshift(data);
        this.criandoDiaADia = false;
      }
    },

    // quando o dia chega, vira realizado com o valor de fato gasto
    realizarPrevisao(d) {
      this.abrirEditarDiaADia({ ...d, status: "realizado" });
    },

    async excluirDiaADia(id) {
      if (!confirm("Excluir este lançamento do Dia a dia?")) return;
      const { error } = await supabase.from("dia_a_dia").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.diaADia = this.diaADia.filter((d) => d.id !== id);
    },

    // ===================== PREVISÃO EM GRUPO: várias datas, um nome só =====================
    // ex: "Final de semana" nos dias 25 e 26 — cada dia é uma linha previsto própria
    // (pra poder "Realizar" um por um conforme o dia chega), todas marcadas com o
    // mesmo grupo só pra aparecerem juntas na lista.

    abrirNovaPrevisaoGrupo() {
      this.criandoPrevisaoGrupo = true;
      this.formPrevisaoGrupo = { nome: "", dias: [{ data: "", valor: "" }] };
    },

    adicionarDiaPrevisaoGrupo() {
      this.formPrevisaoGrupo.dias.push({ data: "", valor: "" });
    },

    removerDiaPrevisaoGrupo(i) {
      this.formPrevisaoGrupo.dias.splice(i, 1);
    },

    async salvarPrevisaoGrupo() {
      const nome = this.formPrevisaoGrupo.nome.trim();
      const dias = this.formPrevisaoGrupo.dias.filter((d) => d.data && d.valor);
      if (!nome || !dias.length) return alert("Preencha o nome do grupo e pelo menos um dia com valor.");
      const grupo = `${nome}-${Date.now()}`;
      const linhas = dias.map((d) => ({
        data: d.data,
        descricao: nome,
        valor: Number(d.valor),
        status: "previsto",
        grupo,
        owner_id: this.uid,
      }));
      const { data, error } = await supabase.from("dia_a_dia").insert(linhas).select();
      if (error) return alert("Erro ao salvar: " + error.message);
      this.diaADia.unshift(...data);
      this.criandoPrevisaoGrupo = false;
    },

    // agrupa diaADiaDoMes: itens com "grupo" ficam juntos sob o nome do grupo;
    // itens sem grupo (lançamento normal, real ou previsão única) ficam cada um sozinho.
    get diaADiaAgrupadoDoMes() {
      const vistos = new Set();
      const resultado = [];
      for (const item of this.diaADiaDoMes) {
        if (item.grupo) {
          if (vistos.has(item.grupo)) continue;
          vistos.add(item.grupo);
          const itensDoGrupo = this.diaADia.filter((d) => d.grupo === item.grupo).sort((a, b) => a.data.localeCompare(b.data));
          resultado.push({ grupo: item.grupo, nome: item.descricao, itens: itensDoGrupo });
        } else {
          resultado.push({ grupo: null, nome: item.descricao, itens: [item] });
        }
      }
      return resultado;
    },

    // mês de competência (a que a despesa se refere) é separado do mês do due_date real:
    // contas com vence_mes_seguinte=true (água/luz/internet/IPTU etc.) vencem no mês seguinte
    // ao mês de competência, mesmo assim contam no total do mês de competência.
    mesSeguinte(mes) {
      const [ano, mesNum] = mes.split("-").map(Number);
      const d = new Date(ano, mesNum, 1); // mesNum já é +1 mês (Date usa mês 0-based)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    },

    // como as contas são fixas (recorrem todo mês), já abre o bill_payment do mês
    // automaticamente ao navegar pra lá, em vez de exigir criação manual mês a mês.
    async garantirContasFixasDoMes(mes) {
      const faltando = [];
      for (const bill of this.fixedBills.filter((b) => b.active !== false)) {
        const jaExiste = this.billPayments.some((p) => p.fixed_bill_id === bill.id && (p.competencia || p.due_date.slice(0, 7)) === mes);
        if (jaExiste) continue;
        const mesVencimento = bill.vence_mes_seguinte ? this.mesSeguinte(mes) : mes;
        const [anoV, mesNumV] = mesVencimento.split("-").map(Number);
        const ultimoDiaDoMesVencimento = new Date(anoV, mesNumV, 0).getDate();
        const dia = Math.min(bill.due_day, ultimoDiaDoMesVencimento);
        faltando.push({
          fixed_bill_id: bill.id,
          due_date: `${mesVencimento}-${String(dia).padStart(2, "0")}`,
          competencia: mes,
          amount: bill.amount,
          status: "pendente",
        });
      }
      if (!faltando.length) return;
      const { data, error } = await supabase.from("bill_payments").insert(faltando).select();
      if (!error && data) this.billPayments.push(...data);
    },

    get nomeMesFinanceiro() {
      const [y, m] = this.mesFinanceiro.split("-").map(Number);
      return `${this.nomesMeses[m - 1]} de ${y}`;
    },

    // ===================== VISÃO ANUAL (timeline por mês de competência) =====================

    anoVisaoAnualAnterior() { this.anoVisaoAnual--; },
    anoVisaoAnualSeguinte() { this.anoVisaoAnual++; },

    toggleMesAnual(mes) {
      this.abaAnualAberta = this.abaAnualAberta === mes ? null : mes;
    },

    // junta contas fixas + faturas de cartão (por competência) + lançamentos avulsos +
    // dia a dia num único timeline — mesmas 4 fontes que gastoDoMes, pra Visão Anual
    // bater com o que cada mês mostra individualmente.
    itensTimelineDoMes(mes) {
      const itensContas = this.billPaymentsDoCompetencia(mes).map((p) => ({
        data: p.due_date,
        nome: this.billName(p.fixed_bill_id),
        valor: Number(p.amount || 0),
        status: p.status,
        tipo: "conta_fixa",
      }));
      const itensCartoes = this.faturasCartao
        .filter((f) => f.competencia === mes && f.status === "pago")
        .map((f) => ({ data: f.due_date, nome: "Fatura " + this.cartaoNome(f.cartao_id), valor: Number(f.amount || 0), status: f.status, tipo: "cartao" }));
      const itensTransacoes = this.transactions
        .filter((t) => t.date.slice(0, 7) === mes && t.kind !== "renda" && !t.transferencia_interna)
        .map((t) => ({ data: t.date, nome: t.description, valor: Number(t.amount), status: "pago", tipo: "lancamento" }));
      const itensDiaADia = this.diaADia
        .filter((d) => d.data.slice(0, 7) === mes && d.status === "realizado")
        .map((d) => ({ data: d.data, nome: d.descricao, valor: Number(d.valor || 0), status: "pago", tipo: "dia_a_dia" }));
      return [...itensContas, ...itensCartoes, ...itensTransacoes, ...itensDiaADia].sort((a, b) => a.data.localeCompare(b.data));
    },

    totalTimelineDoMes(mes) {
      return this.itensTimelineDoMes(mes).reduce((s, i) => s + i.valor, 0);
    },

    // renda de qualquer mês (não só o mesFinanceiro selecionado) — pra calcular o
    // saldo acumulado ano a ano sem precisar navegar mês a mês.
    rendaDoMesEspecifico(mes) {
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === mes && t.kind === "renda" && !t.transferencia_interna)
        .reduce((s, t) => s + Number(t.amount), 0);
    },

    get resumoAnual() {
      const ano = this.anoVisaoAnual;
      let acumulado = 0;
      const meses = this.nomesMeses.map((nome, i) => {
        const mes = `${ano}-${String(i + 1).padStart(2, "0")}`;
        const renda = this.rendaDoMesEspecifico(mes);
        const gasto = this.totalTimelineDoMes(mes);
        const saldoDoMes = renda - gasto;
        acumulado += saldoDoMes;
        return { mes, nome, itens: this.itensTimelineDoMes(mes), total: gasto, renda, saldoDoMes, saldoAcumulado: acumulado };
      });
      const totalAno = meses.reduce((s, m) => s + m.total, 0);
      return { meses, totalAno };
    },

    // garante que todo mês do ano selecionado já tenha os bill_payments gerados,
    // pra timeline anual mostrar inclusive meses futuros ainda não visitados
    async garantirAnoCompletoVisaoAnual() {
      const ano = this.anoVisaoAnual;
      for (let i = 0; i < 12; i++) {
        const mes = `${ano}-${String(i + 1).padStart(2, "0")}`;
        await this.garantirContasFixasDoMes(mes);
        await this.garantirFaturasCartaoDoMes(mes);
      }
    },

    get billPaymentsDoMes() {
      return this.billPaymentsDoCompetencia(this.mesFinanceiro);
    },

    // mês de competência: usa o campo competencia; bill_payments antigos sem esse campo
    // (de antes da migração) caem no fallback do mês do due_date.
    billPaymentsDoCompetencia(mes) {
      return this.billPayments
        .filter((p) => (p.competencia || p.due_date.slice(0, 7)) === mes)
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
    },

    // navegação por clique nos cards superiores / cards de cartão
    irPara(aba) {
      this.abaFinanceiro = aba;
    },

    transacoesDoMes(filtroKind) {
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === this.mesFinanceiro)
        .filter((t) => !t.transferencia_interna)
        .filter((t) => (filtroKind === "diaria" ? t.kind === "diaria" : t.kind !== "diaria"))
        .filter((t) => !this.filtroCategoriaTransacao || t.category_id === this.filtroCategoriaTransacao)
        .sort((a, b) => b.date.localeCompare(a.date));
    },

    // ===================== FINANCEIRO: contas fixas (CRUD completo) =====================

    abrirNovaContaFixa() {
      this.formContaFixa = { name: "", amount: "", due_day: "10", category_id: "", vence_mes_seguinte: false };
      this.editandoContaFixa = null;
      this.criandoContaFixa = true;
    },

    abrirEditarContaFixa(bill) {
      this.formContaFixa = {
        name: bill.name,
        amount: bill.amount,
        due_day: bill.due_day,
        category_id: bill.category_id || "",
        vence_mes_seguinte: !!bill.vence_mes_seguinte,
      };
      this.editandoContaFixa = bill;
      this.criandoContaFixa = true;
    },

    async salvarContaFixa() {
      const f = this.formContaFixa;
      if (!f.name || !f.amount || !f.due_day) return alert("Preencha nome, valor e dia de vencimento.");
      if (this.editandoContaFixa) {
        const payload = {
          name: f.name,
          amount: Number(f.amount),
          due_day: Number(f.due_day),
          category_id: f.category_id || null,
          vence_mes_seguinte: !!f.vence_mes_seguinte,
        };
        const { error } = await supabase.from("fixed_bills").update(payload).eq("id", this.editandoContaFixa.id);
        if (error) return alert("Erro ao salvar conta fixa: " + error.message);
        // atualiza também o pagamento pendente do mês selecionado, se existir, pra refletir na hora
        const pagamentoDoMes = this.billPaymentsDoMes.find((p) => p.fixed_bill_id === this.editandoContaFixa.id && p.status === "pendente");
        if (pagamentoDoMes) {
          const mesVencimento = payload.vence_mes_seguinte ? this.mesSeguinte(this.mesFinanceiro) : this.mesFinanceiro;
          const [anoV, mesNumV] = mesVencimento.split("-").map(Number);
          const dia = Math.min(payload.due_day, new Date(anoV, mesNumV, 0).getDate());
          const pagPayload = { amount: payload.amount, due_date: `${mesVencimento}-${String(dia).padStart(2, "0")}` };
          await supabase.from("bill_payments").update(pagPayload).eq("id", pagamentoDoMes.id);
        }
        this.criandoContaFixa = false;
        this.editandoContaFixa = null;
        await this.loadDashboard();
        return;
      }
      const { data: bill, error } = await supabase
        .from("fixed_bills")
        .insert({
          name: f.name,
          amount: Number(f.amount),
          due_day: Number(f.due_day),
          category_id: f.category_id || null,
          vence_mes_seguinte: !!f.vence_mes_seguinte,
          created_by: this.uid,
        })
        .select()
        .single();
      if (error) return alert("Erro ao criar conta fixa: " + error.message);
      const mesVencimento = bill.vence_mes_seguinte ? this.mesSeguinte(this.mesFinanceiro) : this.mesFinanceiro;
      const dueDate = `${mesVencimento}-${String(f.due_day).padStart(2, "0")}`;
      await supabase.from("bill_payments").insert({ fixed_bill_id: bill.id, due_date: dueDate, competencia: this.mesFinanceiro, amount: bill.amount, status: "pendente" });
      this.criandoContaFixa = false;
      await this.loadDashboard();
    },

    async excluirContaFixa(fixedBillId) {
      if (!confirm("Excluir esta conta fixa? Isso remove TODOS os meses dela (passados e futuros), não tem como desfazer.")) return;
      const { error } = await supabase.from("fixed_bills").delete().eq("id", fixedBillId);
      if (error) return alert("Erro ao excluir: " + error.message);
      await this.loadDashboard();
    },

    // ===================== FINANCEIRO: dia a dia / cartão e variáveis =====================

    abrirNovaTransacao(kindPadrao) {
      this.formTransacao = {
        description: "",
        amount: "",
        date: `${this.mesFinanceiro}-${String(new Date().getDate()).padStart(2, "0")}`,
        account: "",
        kind: kindPadrao,
        category_id: "",
        pessoa: "jessica",
      };
      this.editandoTransacao = null;
      this.criandoTransacao = true;
    },

    abrirEditarTransacao(t) {
      this.formTransacao = {
        description: t.description,
        amount: t.amount,
        date: t.date,
        account: t.account || "",
        kind: t.kind,
        category_id: t.category_id || "",
        pessoa: t.pessoa || "jessica",
      };
      this.editandoTransacao = t;
      this.criandoTransacao = true;
    },

    async salvarTransacao() {
      const f = this.formTransacao;
      if (!f.description || !f.amount || !f.date) return alert("Preencha descrição, valor e data.");
      const payload = {
        description: f.description,
        amount: Number(f.amount),
        date: f.date,
        account: f.account || null,
        kind: f.kind,
        category_id: f.category_id || null,
        pessoa: f.kind === "renda" ? f.pessoa : null,
      };
      if (this.editandoTransacao) {
        // marca edited=true: a sincronização com o Sistema de Joias nunca sobrescreve
        // um lançamento que você editou manualmente aqui.
        const { error } = await supabase.from("transactions").update({ ...payload, edited: true }).eq("id", this.editandoTransacao.id);
        if (error) return alert("Erro ao salvar lançamento: " + error.message);
        this.editandoTransacao = null;
      } else {
        const { error } = await supabase.from("transactions").insert({ ...payload, source: "manual", created_by: this.uid });
        if (error) return alert("Erro ao salvar lançamento: " + error.message);
      }
      this.criandoTransacao = false;
      await this.loadDashboard();
      this.$nextTick(() => this.animateCards());
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

    // toda vez que a aba Calendário é aberta, volta pro ano atual e rola até o mês atual
    abrirCalendario() {
      this.anoCalendario = new Date().getFullYear();
      this.$nextTick(() => {
        const el = document.getElementById("mes-card-" + new Date().getMonth());
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },

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

    // ===================== INTEGRAÇÃO COM O SISTEMA DE JOIAS (Alfa 3D) =====================
    // tarefasJoias é sincronizado automaticamente (script agendado), nunca editado direto aqui.

    get tarefasJoiasAbertas() {
      return this.tarefasJoias.filter((t) => t.status === "aberto");
    },

    tarefasJoiasDoDia(dataISO) {
      return this.tarefasJoias.filter((t) => t.prazo === dataISO && t.status === "aberto");
    },

    // ===================== PAINEL DE TAREFAS (dashboard pessoal) =====================

    get tarefasDeHoje() {
      const hoje = this.hojeISO();
      return [
        ...this.eventosDoDia(hoje).map((e) => ({ titulo: e.title, tipo: e.tipo === "trabalho" ? "Compromisso de trabalho" : "Compromisso", origem: "calendario" })),
        ...this.tarefasJoiasDoDia(hoje).map((t) => ({ titulo: t.titulo, tipo: "Prazo de joia", origem: "sistema_joias" })),
      ];
    },

    get trabalhosEmAberto() {
      return [
        ...this.events.filter((e) => e.tipo === "trabalho" && e.status_trabalho === "aberto").map((e) => ({ titulo: e.title, prazo: e.starts_at.slice(0, 10), origem: "calendario" })),
        ...this.tarefasJoiasAbertas.map((t) => ({ titulo: t.titulo, prazo: t.prazo, origem: "sistema_joias" })),
      ].sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
    },

    get conflitoHoje() {
      return this.temConflito(this.hojeISO());
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
