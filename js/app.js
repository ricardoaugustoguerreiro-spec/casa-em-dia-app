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
    balances: [],
    loadingData: true,
    abaAtual: "financeiro", // financeiro | calendario | ajustes
    abaFinanceiro: "resumo", // resumo | contas_fixas | dia_a_dia | cartao_variaveis
    mesFinanceiro: new Date().toISOString().slice(0, 7), // "AAAA-MM"
    mostrarDetalheGasto: false, // expande/recolhe o detalhamento de "Já saiu" na Visão geral do mês
    formPerfil: { display_name: "", color: "#7c3aed" },
    formSaldo: { amount: "", notes: "" },
    formCategoria: { name: "", kind: "variavel", color: "#64748b" },
    criandoContaFixa: false,
    formContaFixa: { name: "", amount: "", due_day: "10", category_id: "", vence_mes_seguinte: false },
    editandoContaFixa: null,
    criandoTransacao: false,
    formTransacao: { description: "", amount: "", date: "", account: "", kind: "variavel", category_id: "", pessoa: "jessica" },
    editandoTransacao: null,
    abaAnualAberta: null, // "AAAA-MM" do mês expandido na Visão Anual
    anoVisaoAnual: new Date().getFullYear(),
    filtroCategoriaTransacao: "",
    editandoPagamento: null,
    formPagamento: { amount: "", due_date: "", status: "pendente" },
    comprasParceladas: [],
    criandoParcelada: false,
    editandoParcelada: null,
    formParcelada: { descricao: "", cartao: "", valor_parcela: "", parcela_inicio: "", parcela_fim: "", grupo: "casal", observacao: "" },
    importandoCsv: false,
    processandoArquivo: false, // spinner enquanto lê CSV/PDF (PDF demora um instante)
    resultadoImportacao: null,
    alvoImportacaoFixos: "", // "cartao:<id>" ou "conta:<fixed_bill_id>" — pra onde vai o valor lido
    resultadoImportacaoValor: null,
    _pdfjs: null, // pdf.js carregado sob demanda (só quando sobe um PDF)

    // cartões da família (fatura mensal editável, dentro de Contas Fixas)
    cartoes: [],
    faturasCartao: [],
    editandoFatura: null,
    formFatura: { amount: "", status: "pendente" },
    editandoDataFatura: null,
    formDataFatura: { due_date: "", data: "" },

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
      await this.processarSilenciarEventoNaUrl();
      this.loadingData = false;
    },

    // Clique em "Desligar avisos deste evento" na notificação push abre o app
    // com ?silenciar_evento=<id> (o service worker não tem sessão autenticada
    // pra gravar direto no banco, então delega pro app, que já está logado).
    async processarSilenciarEventoNaUrl() {
      const params = new URLSearchParams(window.location.search);
      const eventoId = params.get("silenciar_evento");
      if (!eventoId || !this.uid) return;
      await supabase.from("eventos_silenciados").upsert({ event_id: eventoId, user_id: this.uid });
      window.history.replaceState({}, "", window.location.pathname);
      const evento = this.events.find((e) => e.id === eventoId);
      alert(`Avisos desligados${evento ? " para \"" + evento.title + "\"" : ""}. Você não vai mais receber lembretes de hora em hora desse compromisso.`);
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
    },

    async excluirTransacao(id) {
      if (!confirm("Excluir este lançamento? Não tem como desfazer.")) return;
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.transactions = this.transactions.filter((t) => t.id !== id);
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
      this.formPagamento = { amount: p.amount, due_date: p.due_date, status: p.status, paid_at_data: p.paid_at ? p.paid_at.slice(0, 10) : this.hojeISO() };
    },

    async salvarPagamento() {
      const f = this.formPagamento;
      const payload = {
        amount: Number(f.amount),
        due_date: f.due_date,
        status: f.status,
        paid_at: f.status === "pago" ? new Date((f.paid_at_data || this.hojeISO()) + "T12:00:00").toISOString() : null,
      };
      const { error } = await supabase.from("bill_payments").update(payload).eq("id", this.editandoPagamento.id);
      if (error) return alert("Erro ao salvar: " + error.message);
      Object.assign(this.editandoPagamento, payload);
      this.editandoPagamento = null;
    },

    // ===================== COMPRAS PARCELADAS (cartão) =====================

    // grupo padrão de quem está logado (Ricardo/Jéssica), senão casal
    _meuGrupo() {
      if (this.uid === "691ba2e0-0e9d-41ac-9239-1057c4bcec62") return "ricardo";
      if (this.uid === "8a74c2bb-713d-4c6e-b16a-3140f864079a") return "jessica";
      return "casal";
    },

    abrirNovaParcelada() {
      this.editandoParcelada = null;
      this.formParcelada = { descricao: "", cartao: "", valor_parcela: "", parcela_inicio: this.mesFinanceiro, parcela_fim: "", grupo: this._meuGrupo(), observacao: "" };
      this.criandoParcelada = true;
    },

    abrirEditarParcelada(c) {
      this.editandoParcelada = c;
      this.formParcelada = {
        descricao: c.descricao,
        cartao: c.cartao || "",
        valor_parcela: c.valor_parcela,
        parcela_inicio: c.parcela_inicio.slice(0, 7),
        parcela_fim: c.parcela_fim.slice(0, 7),
        grupo: c.grupo || "casal",
        observacao: c.observacao || "",
      };
      this.criandoParcelada = true;
    },

    async salvarParcelada() {
      const f = this.formParcelada;
      if (!f.descricao || !f.valor_parcela || !f.parcela_inicio || !f.parcela_fim) return alert("Preencha descrição, valor da parcela, início e fim.");
      const payload = {
        descricao: f.descricao,
        cartao: f.cartao || null,
        valor_parcela: Number(f.valor_parcela),
        parcela_inicio: f.parcela_inicio.length === 7 ? f.parcela_inicio + "-01" : f.parcela_inicio,
        parcela_fim: f.parcela_fim.length === 7 ? f.parcela_fim + "-01" : f.parcela_fim,
        grupo: f.grupo || "casal",
        observacao: f.observacao || null,
      };
      if (this.editandoParcelada) {
        const id = this.editandoParcelada.id;
        const { error } = await supabase.from("compras_parceladas").update(payload).eq("id", id);
        if (error) return alert("Erro ao salvar: " + error.message);
        // atualiza o item no array-fonte (não na cópia do getter) pra a tela reagir na hora
        const orig = this.comprasParceladas.find((c) => c.id === id);
        if (orig) Object.assign(orig, payload);
      } else {
        const { error } = await supabase.from("compras_parceladas").insert({ ...payload, created_by: this.uid });
        if (error) return alert("Erro ao salvar: " + error.message);
        await this.loadDashboard();
      }
      this.criandoParcelada = false;
      this.editandoParcelada = null;
    },

    async excluirParcelada(id) {
      if (!confirm("Excluir esta compra parcelada? Não tem como desfazer.")) return;
      const { error } = await supabase.from("compras_parceladas").delete().eq("id", id);
      if (error) return alert("Erro ao excluir: " + error.message);
      this.comprasParceladas = this.comprasParceladas.filter((c) => c.id !== id);
    },

    // ===================== CONFERÊNCIA DE FATURA DE CARTÃO (CSV/PDF) =====================
    // Sobe a fatura exportada (CSV/TXT ou PDF — ver _lerArquivoFinanceiro) e compara
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
      this.processandoArquivo = true;
      try {
        const anoMes = this.mesFinanceiro.slice(0, 4);
        const { linhas, delim, ehPdf } = await this._lerArquivoFinanceiro(file);
        const inicioIdx = linhas.findIndex((l) => /data/i.test(l) && /(valor|descri|estabelec)/i.test(l));
        const linhasDados = inicioIdx >= 0 ? linhas.slice(inicioIdx + 1) : linhas;

        const lancamentosFatura = [];
        for (const linha of linhasDados) {
          const campos = this._camposDaLinha(linha, delim, ehPdf, anoMes);
          if (campos.length < 2) continue;
          const dataMatch = campos.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c) || /^\d{2}\/\d{2}$/.test(c));
          if (!dataMatch) continue;
          let dataISO;
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataMatch)) {
            const [d, m, a] = dataMatch.split("/");
            dataISO = `${a}-${m}-${d}`;
          } else {
            const [d, m] = dataMatch.split("/");
            dataISO = `${anoMes}-${m}-${d}`;
          }
          const valorStr = [...campos].reverse().find((c) => /^-?[\d.,]+$/.test(c) && c.replace(/[.,]/g, "").length > 0);
          if (!valorStr) continue;
          const valor = Math.abs(parseFloat(valorStr.replace(/\./g, "").replace(",", ".")));
          if (isNaN(valor) || valor === 0) continue;
          const descricao = campos.filter((c) => c !== dataMatch && c !== valorStr).join(" ").trim() || "Lançamento da fatura";
          lancamentosFatura.push({ data: dataISO, descricao, valor });
        }

        // ----- TOTAL DA FATURA -----
        // Prioriza uma linha "Total a pagar / Total da fatura" impressa no documento;
        // se o banco não trouxer, cai pra soma dos lançamentos lidos.
        let totalFatura = lancamentosFatura.reduce((s, l) => s + l.valor, 0);
        let origemTotal = "soma dos lançamentos";
        const padroesTotal = [
          /total\s+a\s+pagar/i,
          /(valor\s+)?total\s+d[ao]?\s*fatura/i,
          /total\s+desta\s+fatura/i,
          /saldo\s+(total|desta\s+fatura)/i,
          /pagamento\s+total/i,
        ];
        for (const rx of padroesTotal) {
          const linha = linhas.find((l) => rx.test(l));
          if (!linha) continue;
          const m = linha.match(/-?\s*\d{1,3}(?:\.\d{3})*,\d{2}/g);
          if (m && m.length) {
            const v = Math.abs(parseFloat(m[m.length - 1].replace(/\s/g, "").replace(/\./g, "").replace(",", ".")));
            if (!isNaN(v) && v > 0) { totalFatura = v; origemTotal = "total informado na fatura"; break; }
          }
        }
        totalFatura = Math.round(totalFatura * 100) / 100;

        // ----- ATUALIZA O VALOR DO CARTÃO NAS CONTAS FIXAS -----
        // Há uma única linha por cartão+competência (mês atual). Subir a mesma fatura
        // de novo no mês só regrava o valor — nunca duplica.
        let fatura = this.faturasCartao.find((f) => f.cartao_id === this.cartaoConferenciaId && f.competencia === this.mesFinanceiro);
        if (!fatura) {
          await this.garantirFaturasCartaoDoMes(this.mesFinanceiro);
          fatura = this.faturasCartao.find((f) => f.cartao_id === this.cartaoConferenciaId && f.competencia === this.mesFinanceiro);
        }
        let valorAnterior = null;
        if (fatura) {
          valorAnterior = Number(fatura.amount || 0);
          const { error } = await supabase.from("faturas_cartao").update({ amount: totalFatura }).eq("id", fatura.id);
          if (error) throw new Error("não consegui gravar o valor da fatura: " + error.message);
          fatura.amount = totalFatura;
        } else {
          // cartão inativo/sem fatura do mês: cria a fatura já com o valor lido
          const cartao = this.cartoes.find((c) => c.id === this.cartaoConferenciaId);
          const mesVenc = this.mesSeguinte(this.mesFinanceiro);
          const [anoV, mesNumV] = mesVenc.split("-").map(Number);
          const ultimoDia = new Date(anoV, mesNumV, 0).getDate();
          const dia = Math.min(cartao?.dia_vencimento || 10, ultimoDia);
          const nova = { cartao_id: this.cartaoConferenciaId, competencia: this.mesFinanceiro, due_date: `${mesVenc}-${String(dia).padStart(2, "0")}`, amount: totalFatura, status: "pendente" };
          const { data, error } = await supabase.from("faturas_cartao").insert(nova).select().single();
          if (error) throw new Error("não consegui criar a fatura: " + error.message);
          this.faturasCartao.push(data);
          valorAnterior = 0;
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
          valorFatura: totalFatura,
          valorAnterior,
          origemTotal,
          qtdItens: lancamentosFatura.length,
        };
      } catch (e) {
        alert("Erro ao ler o arquivo: " + e.message);
      } finally {
        this.processandoArquivo = false;
        event.target.value = "";
      }
    },

    diffDias(dataA, dataB) {
      return (new Date(dataA) - new Date(dataB)) / 86400000;
    },

    // ===================== LEITURA DE ARQUIVO (CSV + PDF) =====================
    // Tanto "Importar CSV" (contas fixas) quanto "Subir fatura" (conferência do
    // cartão) aceitam CSV/TXT e PDF. Muitos bancos só mandam extrato/fatura em PDF.
    // O parser de linha (_camposDaLinha) é o mesmo pros dois formatos: acha data,
    // valor e descrição por regex — então o resto do fluxo não muda.

    // Carrega o pdf.js só na primeira vez que sobe um PDF (não pesa o app no dia a dia).
    async _carregarPdfJs() {
      if (this._pdfjs) return this._pdfjs;
      const ver = "4.0.379";
      const lib = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.min.mjs`);
      lib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`;
      this._pdfjs = lib;
      return lib;
    },

    // Devolve as linhas de texto do arquivo. CSV/TXT → split direto. PDF → extrai o
    // texto com pdf.js e reagrupa os pedaços por linha (mesma coordenada vertical),
    // da esquerda pra direita, virando uma linha de texto por lançamento.
    async _lerArquivoFinanceiro(file) {
      const nome = (file.name || "").toLowerCase();
      const ehPdf = nome.endsWith(".pdf") || file.type === "application/pdf";
      if (!ehPdf) {
        const texto = await file.text();
        const delim = texto.includes(";") ? ";" : ",";
        const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
        return { linhas, delim, ehPdf: false };
      }
      const pdfjs = await this._carregarPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const linhas = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const porLinha = new Map(); // chave = coordenada Y arredondada (com tolerância)
        for (const item of content.items) {
          const str = item.str || "";
          if (!str.trim()) continue;
          const y = Math.round(item.transform[5]);
          let chave = null;
          for (const k of porLinha.keys()) { if (Math.abs(k - y) <= 2) { chave = k; break; } }
          if (chave === null) { chave = y; porLinha.set(chave, []); }
          porLinha.get(chave).push(item);
        }
        const chaves = [...porLinha.keys()].sort((a, b) => b - a); // topo → base
        for (const k of chaves) {
          const txt = porLinha.get(k)
            .sort((a, b) => a.transform[4] - b.transform[4]) // esquerda → direita
            .map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
          if (txt) linhas.push(txt);
        }
      }
      return { linhas, delim: null, ehPdf: true };
    },

    // Quebra uma linha em campos [data, descrição, valor]. CSV: split pelo delimitador
    // (comportamento antigo, intacto). PDF: uma linha é texto solto, então acha data e
    // valor por regex e devolve no mesmo formato de 3 campos que o resto do código espera.
    _camposDaLinha(linha, delim, ehPdf, anoFallback) {
      if (!ehPdf) return linha.split(delim).map((c) => c.trim());

      const dataM = linha.match(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/);
      if (!dataM) return [];
      let data = dataM[0];
      const partes = data.split("/"); // normaliza pra dd/mm/aaaa
      if (partes.length === 2) data = `${partes[0]}/${partes[1]}/${anoFallback}`;
      else if (partes[2].length === 2) data = `${partes[0]}/${partes[1]}/20${partes[2]}`;

      // valores no formato pt-BR (1.234,56 / 45,90); pega o último da linha (coluna de valor)
      const valores = linha.match(/-?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*-?/g);
      if (!valores || !valores.length) return [];
      const valorBruto = valores[valores.length - 1].trim();
      const valorNum = valorBruto.replace(/[^\d.,]/g, "");
      // sinal: "-", parênteses, ou marcador D (débito) / C (crédito) logo após o valor
      let negativo = /-/.test(valorBruto) || /\(\s*[\d.,]+\s*\)/.test(linha);
      const resto = linha.slice(linha.lastIndexOf(valorBruto) + valorBruto.length).trim();
      if (/^D\b/i.test(resto)) negativo = true;
      if (/^C\b/i.test(resto)) negativo = false;
      const valorStr = (negativo ? "-" : "") + valorNum;

      let descricao = linha
        .replace(dataM[0], " ")
        .replace(valorBruto, " ")
        .replace(/\bR\$/gi, " ")
        .replace(/\(\s*\)/g, " ")   // parênteses vazios que sobraram do valor
        .replace(/\s+[DC]\s*$/i, " ") // marcador débito/crédito solto no fim
        .replace(/\s+/g, " ")
        .trim();
      if (!descricao) descricao = "Lançamento importado";
      return [data, descricao, valorStr];
    },

    // Split de linha CSV respeitando aspas — o Nubank (e outros) exporta o valor entre
    // aspas ("7,00") justamente porque a vírgula decimal colidiria com o separador. Sem
    // isso, "7,00" virava dois campos e o valor se perdia.
    _csvCampos(linha, delim) {
      const out = [];
      let cur = "", emAspas = false;
      for (let i = 0; i < linha.length; i++) {
        const ch = linha[i];
        if (ch === '"') {
          if (emAspas && linha[i + 1] === '"') { cur += '"'; i++; }
          else emAspas = !emAspas;
        } else if (ch === delim && !emAspas) {
          out.push(cur); cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out.map((c) => c.trim());
    },

    // Interpreta um número em formato pt-BR (1.234,56 / 45,90 / "- 169,74"), tolerando
    // aspas, espaços e R$. Devolve número COM sinal, ou null se o campo não for um valor.
    _parseValorBR(str) {
      if (str == null) return null;
      const s = String(str).trim().replace(/^"+|"+$/g, "").replace(/R\$/i, "").replace(/\s+/g, "");
      if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$/.test(s)) return null;
      const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
      return isNaN(n) ? null : n;
    },

    // Calcula o TOTAL a partir das linhas já lidas. Em PDF de fatura, prioriza a linha
    // "Total desta fatura" impressa; senão (e no CSV) soma os lançamentos COM SINAL
    // (compras somam, estornos subtraem), ignorando pagamento da fatura anterior.
    _calcularTotalDoc(linhas, delim, ehPdf) {
      const anoMes = this.mesFinanceiro.slice(0, 4);
      const ehData = (c) => /^\d{4}-\d{2}-\d{2}$/.test(c) || /^\d{2}\/\d{2}(\/\d{2,4})?$/.test(c);

      let total = 0;
      let qtdItens = 0;
      for (const linha of linhas) {
        const campos = ehPdf ? this._camposDaLinha(linha, delim, ehPdf, anoMes) : this._csvCampos(linha, delim);
        if (!campos.length) continue;
        if (!campos.some((c) => ehData(c))) continue; // só linhas de lançamento (têm data)
        // pagamento da fatura anterior não é gasto DESTA fatura — não entra no total
        const txt = campos.join(" ").toLowerCase();
        if (/pagamento\s+(recebido|efetuado|de\s+fatura|da\s+fatura)/.test(txt)) continue;
        let valor = null;
        for (let i = campos.length - 1; i >= 0; i--) {
          const v = this._parseValorBR(campos[i]);
          if (v !== null) { valor = v; break; }
        }
        if (valor === null || valor === 0) continue;
        total += valor;
        qtdItens++;
      }

      let origem = "soma dos lançamentos";
      // Ignora linhas de fatura ANTERIOR, parcelamento, financiamento, pagamento mínimo e
      // projeções de próximas faturas — são a principal fonte de "valor errado". Ex.: o Itaú
      // lista várias "Total a pagar" de opções de parcelamento (valores inflados) e o total
      // real da fatura é a linha "Total desta fatura". Por isso a ordem abaixo prioriza ela.
      const excluir = /(anterior|financiad|m[ií]nim|parcel|saque|pr[óo]xim|op[çc][aã]|encargo)/i;
      const padroesTotal = [
        /total\s+desta\s+fatura/i,
        /o\s+total\s+da\s+sua\s+fatura/i,
        /total\s+da\s+fatura\b/i,
        /valor\s+total\s+a\s+pagar/i,
        /total\s+a\s+pagar/i,
        /valor\s+a\s+pagar/i,
        /valor\s+do\s+documento/i,
        /saldo\s+desta\s+fatura/i,
        /pagamento\s+total/i,
      ];
      for (const rx of padroesTotal) {
        const linha = linhas.find((l) => rx.test(l) && !excluir.test(l));
        if (!linha) continue;
        const m = linha.match(/-?\s*\d{1,3}(?:\.\d{3})*,\d{2}/g);
        if (m && m.length) {
          const v = Math.abs(parseFloat(m[m.length - 1].replace(/\s/g, "").replace(/\./g, "").replace(",", ".")));
          if (!isNaN(v) && v > 0) { total = v; origem = "total informado na fatura"; break; }
        }
      }
      return { total: Math.round(total * 100) / 100, origem, qtdItens };
    },

    // soma n meses (n pode ser negativo) a um "AAAA-MM" e devolve "AAAA-MM"
    _somarMeses(mes, n) {
      const [y, m] = mes.split("-").map(Number);
      const d = new Date(y, m - 1 + n, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    },

    // chave normalizada da descrição, pra casar a mesma compra parcelada entre faturas
    _normParcelaDesc(s) {
      return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 22);
    },

    // Descobre a COMPETÊNCIA do documento (mês em que o valor deve entrar, independente do
    // mês que você está vendo). Usa o VENCIMENTO impresso: competência = mês anterior ao
    // vencimento (a fatura vence no mês seguinte à competência — mesma regra das contas
    // fixas). Sem vencimento no arquivo (ex.: CSV Nubank), usa o mês do lançamento mais
    // recente (datas ISO do CSV são confiáveis). Devolve "AAAA-MM".
    _detectarCompetencia(linhas, delim, ehPdf) {
      for (const linha of linhas) {
        const idx = linha.search(/venciment/i);
        if (idx < 0) continue;
        const m = linha.slice(idx).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
        if (m) {
          const ano = m[3].length === 2 ? "20" + m[3] : m[3];
          return this._somarMeses(`${ano}-${m[2]}`, -1);
        }
      }
      let maxMes = null;
      for (const linha of linhas) {
        const campos = ehPdf ? [] : this._csvCampos(linha, delim);
        for (const c of campos) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(c)) { const mes = c.slice(0, 7); if (!maxMes || mes > maxMes) maxMes = mes; }
        }
      }
      return maxMes || this.mesFinanceiro;
    },

    // Detecta compras PARCELADAS nas linhas do extrato/fatura. Reconhece "Parcela X/Y",
    // "parc X/Y", "X de Y" (Nubank e afins) e o formato colado "descNN/NN valor" (Itaú).
    // No PDF ancora na 1ª transação da linha (coluna esquerda), ignorando a 2ª coluna e a
    // seção de detalhamento (juros/limite/IOF...). Dedup por descrição+total, guardando a
    // MENOR parcela (a atual, não a projeção). Devolve {descricao, atual, total, valor}.
    _detectarParcelas(linhas, delim, ehPdf) {
      const RUIDO = /(juros|limite|financiad|saque|\bcet\b|\biof\b|anuidade|encargo|m[áa]xim|cr[ée]dito|total\s+financ|valor\s+total|valor\s+compra|valor\s+juros|quantidade\s+de\s+parcela|per[íi]odo|%\s)/i;
      const achados = [];
      for (const linha of linhas) {
        let desc = null, atual = null, total = null, valor = null;
        if (!ehPdf) {
          const campos = this._csvCampos(linha, delim);
          if (campos.length < 2) continue;
          if (!campos.some((c) => /^\d{4}-\d{2}-\d{2}$/.test(c) || /^\d{2}\/\d{2}/.test(c))) continue;
          for (let i = campos.length - 1; i >= 0; i--) { const v = this._parseValorBR(campos[i]); if (v !== null) { valor = v; break; } }
          if (valor === null || valor === 0) continue;
          const titulo = campos.find((c) => this._parseValorBR(c) === null && !/^\d{4}-\d{2}-\d{2}$/.test(c)) || "";
          const m = titulo.match(/parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})/i) || titulo.match(/parc\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})/i) || titulo.match(/\b(\d{1,2})\s+de\s+(\d{1,2})\b/i) || titulo.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/);
          if (!m) continue;
          atual = +m[1]; total = +m[2];
          desc = titulo.replace(/\s*[-–]?\s*(parcela|parc\.?)\s*\d{1,2}\s*\/\s*\d{1,2}.*/i, "").replace(/\b\d{1,2}\s+de\s+\d{1,2}\b/i, "").replace(/(?<!\d)\d{1,2}\/\d{1,2}(?!\d)/, "").replace(/\s+/g, " ").trim();
        } else {
          const semData = linha.replace(/^\s*\d{2}\/\d{2}(\/\d{2,4})?\s*/, "");
          const m = semData.match(/^(.+?)(\d{1,2})\/(\d{1,2})\s+(-?\s*\d{1,3}(?:\.\d{3})*,\d{2})/);
          if (!m) continue;
          desc = m[1].replace(/\s+/g, " ").trim();
          atual = +m[2]; total = +m[3]; valor = this._parseValorBR(m[4]);
          if (RUIDO.test(desc)) continue;
        }
        if (!desc || valor === null || valor === 0) continue;
        valor = Math.abs(valor);
        if (!(total >= 2 && total <= 48 && atual >= 1 && atual <= total)) continue;
        achados.push({ descricao: desc, atual, total, valor });
      }
      const map = new Map();
      for (const a of achados) {
        const k = this._normParcelaDesc(a.descricao) + "|" + a.total;
        const ex = map.get(k);
        if (!ex || a.atual < ex.atual) map.set(k, a);
      }
      return [...map.values()];
    },

    // Grava/atualiza na aba Parceladas as compras parceladas lidas do documento. Calcula
    // 1ª e última parcela a partir da parcela atual + mês da fatura; casa com registro
    // existente (mesma descrição+total) pra não duplicar ao re-subir. Devolve contagens.
    async _sincronizarParcelas(parcelas, cartaoNome, mesCompetencia) {
      let novas = 0, atualizadas = 0;
      for (const p of parcelas) {
        const inicio = this._somarMeses(mesCompetencia, -(p.atual - 1)) + "-01";
        const fim = this._somarMeses(mesCompetencia, p.total - p.atual) + "-01";
        const chave = this._normParcelaDesc(p.descricao);
        const existente = this.comprasParceladas.find((c) => {
          const t = this.diffMeses(c.parcela_inicio.slice(0, 7), c.parcela_fim.slice(0, 7)) + 1;
          return this._normParcelaDesc(c.descricao) === chave && t === p.total;
        });
        if (existente) {
          const payload = { valor_parcela: p.valor, parcela_inicio: inicio, parcela_fim: fim };
          const { error } = await supabase.from("compras_parceladas").update(payload).eq("id", existente.id);
          if (!error) { Object.assign(existente, payload); atualizadas++; }
        } else {
          const nova = { descricao: p.descricao, cartao: cartaoNome || null, valor_parcela: p.valor, parcela_inicio: inicio, parcela_fim: fim, grupo: this._meuGrupo(), created_by: this.uid };
          const { data, error } = await supabase.from("compras_parceladas").insert(nova).select().single();
          if (!error && data) { this.comprasParceladas.push(data); novas++; }
        }
      }
      return { novas, atualizadas };
    },

    // ===================== IMPORTAR VALOR (Compromissos fixos: cartão OU conta) =====================
    // Você escolhe o cartão/conta no seletor e sobe o extrato/fatura (CSV/PDF). O app lê o
    // total e grava no valor daquele item no mês atual. Subir de novo só regrava — sem duplicar.

    abrirImportarValorFixos() {
      if (!this.alvoImportacaoFixos) { alert("Primeiro escolha o cartão ou a conta no seletor, depois suba o arquivo."); return; }
      this.$refs.inputValorFixos.click();
    },

    async importarValorFixos(event) {
      const file = event.target.files[0];
      if (!file || !this.alvoImportacaoFixos) { if (event.target) event.target.value = ""; return; }
      this.processandoArquivo = true;
      try {
        const { linhas, delim, ehPdf } = await this._lerArquivoFinanceiro(file);
        const { total, origem, qtdItens } = this._calcularTotalDoc(linhas, delim, ehPdf);
        if (!total || total <= 0) throw new Error("não encontrei valores no arquivo. Confira se subiu o extrato/fatura certo (CSV ou PDF).");

        // competência = mês em que o valor entra (lido do documento), independente do mês
        // que você está vendo. Regra: fatura vence no mês seguinte à competência.
        const competencia = this._detectarCompetencia(linhas, delim, ehPdf);

        const sep = this.alvoImportacaoFixos.indexOf(":");
        const tipo = this.alvoImportacaoFixos.slice(0, sep);
        const id = this.alvoImportacaoFixos.slice(sep + 1);
        let nome = "", valorAnterior = 0;

        if (tipo === "cartao") {
          let fatura = this.faturasCartao.find((f) => f.cartao_id === id && f.competencia === competencia);
          if (!fatura) {
            await this.garantirFaturasCartaoDoMes(competencia);
            fatura = this.faturasCartao.find((f) => f.cartao_id === id && f.competencia === competencia);
          }
          if (fatura) {
            valorAnterior = Number(fatura.amount || 0);
            const { error } = await supabase.from("faturas_cartao").update({ amount: total }).eq("id", fatura.id);
            if (error) throw new Error(error.message);
            fatura.amount = total;
          } else {
            const cartao = this.cartoes.find((c) => c.id === id);
            const mesVenc = this.mesSeguinte(competencia);
            const [anoV, mesNumV] = mesVenc.split("-").map(Number);
            const ultimoDia = new Date(anoV, mesNumV, 0).getDate();
            const dia = Math.min(cartao?.dia_vencimento || 10, ultimoDia);
            const nova = { cartao_id: id, competencia, due_date: `${mesVenc}-${String(dia).padStart(2, "0")}`, amount: total, status: "pendente" };
            const { data, error } = await supabase.from("faturas_cartao").insert(nova).select().single();
            if (error) throw new Error(error.message);
            this.faturasCartao.push(data);
          }
          nome = this.cartaoNome(id);
        } else {
          // conta fixa: grava o valor no pagamento da competência (cria se faltar)
          let pag = this.billPayments.find((p) => p.fixed_bill_id === id && (p.competencia || p.due_date.slice(0, 7)) === competencia);
          if (!pag) {
            await this.garantirContasFixasDoMes(competencia);
            pag = this.billPayments.find((p) => p.fixed_bill_id === id && (p.competencia || p.due_date.slice(0, 7)) === competencia);
          }
          if (!pag) throw new Error("essa conta não tem lançamento na competência " + this.nomeMes(competencia) + ".");
          valorAnterior = Number(pag.amount || 0);
          const { error } = await supabase.from("bill_payments").update({ amount: total }).eq("id", pag.id);
          if (error) throw new Error(error.message);
          pag.amount = total;
          nome = this.billName(id);
        }

        // separa o que está parcelado e joga na aba Parceladas (sem duplicar ao re-subir),
        // usando a MESMA competência detectada pra calcular 1ª/última parcela.
        const parcelas = this._detectarParcelas(linhas, delim, ehPdf);
        const { novas, atualizadas } = await this._sincronizarParcelas(parcelas, tipo === "cartao" ? nome : null, competencia);

        this.resultadoImportacaoValor = { nome, tipo, valor: total, valorAnterior, origem, qtdItens, competencia, nomeCompetencia: this.nomeMes(competencia), parcelasDetectadas: parcelas.length, parcelasNovas: novas, parcelasAtualizadas: atualizadas };
      } catch (e) {
        alert("Erro ao importar: " + e.message);
      } finally {
        this.processandoArquivo = false;
        if (event.target) event.target.value = "";
      }
    },

    // ===================== IMPORTAR CSV/PDF (concilia contas fixas + cria lançamentos) =====================

    abrirImportarCsv() {
      this.$refs.inputCsv.click();
    },

    async importarCsv(event) {
      const file = event.target.files[0];
      if (!file) return;
      this.processandoArquivo = true;
      try {
        const anoMes = this.mesFinanceiro.slice(0, 4);
        const { linhas, delim, ehPdf } = await this._lerArquivoFinanceiro(file);
        const inicioIdx = linhas.findIndex((l) => /data/i.test(l) && /(valor|descri)/i.test(l));
        const linhasDados = inicioIdx >= 0 ? linhas.slice(inicioIdx + 1) : linhas;

        let contasMarcadas = 0;
        let novosLancamentos = 0;

        for (const linha of linhasDados) {
          const campos = this._camposDaLinha(linha, delim, ehPdf, anoMes);
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
      } catch (e) {
        alert("Erro ao importar: " + e.message);
      } finally {
        this.processandoArquivo = false;
        event.target.value = "";
      }
    },

    // ===================== RESUMO FINANCEIRO (aba Financeiro) =====================
    // Todos os cards abaixo seguem o mês selecionado em "mesFinanceiro" (navegação ‹ Mês ›),
    // não o mês real de hoje — por isso "Marcar pago"/edição sempre refletem na hora.

    // contas fixas pagas (bill_payments) também contam como gasto — só transactions
    // subestimaria o mês, já que Internet/Água/Luz/Casa/IPTU/MEI/Carro vivem só ali.
    // Cartões (faturas_cartao) e Dia a Dia realizado entram do mesmo jeito.
    // soma bruta das transações avulsas do mês (cartão/variáveis), sem filtro de categoria —
    // usado tanto em gastoDoMes quanto no detalhamento "Já saiu" da Visão geral, pra nunca
    // divergir mesmo se o usuário estiver com um filtro de categoria ativo na lista.
    get gastoTransacoesDoMes() {
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === this.mesFinanceiro && t.kind !== "renda" && !t.transferencia_interna)
        .reduce((s, t) => s + Number(t.amount), 0);
    },

    get gastoDoMes() {
      const gastoContas = this.billPaymentsDoMes
        .filter((p) => p.status === "pago")
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const gastoCartoes = this.faturasCartaoDoMes
        .filter((f) => f.status === "pago")
        .reduce((s, f) => s + Number(f.amount || 0), 0);
      return this.gastoTransacoesDoMes + gastoContas + gastoCartoes + this.totalDiaADiaRealizadoDoMes;
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

    // parcelas separadas em 3 grupos (Ricardo / Jéssica / Casal), cada um com seu total do mês
    get gruposParcela() {
      const mes = this.mesFinanceiro;
      const defs = [
        { key: "ricardo", nome: "Ricardo", header: "text-indigo-700", dot: "bg-indigo-500", card: "border-l-4 border-indigo-300 bg-indigo-50/40", badge: "bg-indigo-100 text-indigo-700" },
        { key: "jessica", nome: "Jéssica", header: "text-pink-700", dot: "bg-pink-500", card: "border-l-4 border-pink-300 bg-pink-50/40", badge: "bg-pink-100 text-pink-700" },
        { key: "casal", nome: "Casal", header: "text-emerald-700", dot: "bg-emerald-500", card: "border-l-4 border-emerald-300 bg-emerald-50/40", badge: "bg-emerald-100 text-emerald-700" },
      ];
      const todas = this.parceladasComProgresso;
      return defs.map((g) => {
        const itens = todas.filter((c) => (c.grupo || "casal") === g.key);
        const totalMes = itens
          .filter((c) => c.parcela_inicio.slice(0, 7) <= mes && c.parcela_fim.slice(0, 7) >= mes)
          .reduce((s, c) => s + Number(c.valor_parcela), 0);
        return { ...g, itens, totalMes };
      });
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

    async marcarFaturaPaga(f) {
      const novoStatus = f.status === "pago" ? "pendente" : "pago";
      const payload = { status: novoStatus, paid_at: novoStatus === "pago" ? new Date().toISOString() : null };
      const { error } = await supabase.from("faturas_cartao").update(payload).eq("id", f.id);
      if (error) return alert("Erro ao atualizar fatura: " + error.message);
      Object.assign(f, payload);
    },

    abrirEditarFatura(f) {
      this.editandoFatura = f;
      this.formFatura = { amount: f.amount, status: f.status };
    },

    async salvarFatura() {
      const payload = { amount: Number(this.formFatura.amount), status: this.formFatura.status, paid_at: this.formFatura.status === "pago" ? (this.editandoFatura.paid_at || new Date().toISOString()) : null };
      const { error } = await supabase.from("faturas_cartao").update(payload).eq("id", this.editandoFatura.id);
      if (error) return alert("Erro ao salvar fatura: " + error.message);
      Object.assign(this.faturasCartao.find((f) => f.id === this.editandoFatura.id), payload);
      this.editandoFatura = null;
    },

    // botão 📅 da fatura: editar o vencimento e a data em que foi paga (paid_at)
    abrirEditarDataFatura(f) {
      this.editandoDataFatura = f;
      this.formDataFatura = { due_date: f.due_date, data: f.paid_at ? f.paid_at.slice(0, 10) : this.hojeISO() };
    },

    async salvarDataFatura() {
      const f = this.formDataFatura;
      const status = this.editandoDataFatura.status;
      const payload = {
        due_date: f.due_date,
        paid_at: status === "pago" ? new Date((f.data || this.hojeISO()) + "T12:00:00").toISOString() : null,
      };
      const { error } = await supabase.from("faturas_cartao").update(payload).eq("id", this.editandoDataFatura.id);
      if (error) return alert("Erro ao salvar data: " + error.message);
      Object.assign(this.editandoDataFatura, payload);
      this.editandoDataFatura = null;
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
      return this.nomeMes(this.mesFinanceiro);
    },

    nomeMes(mesISO) {
      const [y, m] = mesISO.split("-").map(Number);
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
      // só contas JÁ PAGAS contam como gasto realizado — mesma regra de gastoDoMes,
      // senão a Visão Anual mostra um total maior que o "Gasto total" do mês individual
      // (contas ainda pendentes não são gasto que já saiu).
      const itensContas = this.billPaymentsDoCompetencia(mes)
        .filter((p) => p.status === "pago")
        .map((p) => ({
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

    // lista unificada de lançamentos avulsos do mês (cartão/variáveis/dia a dia via CSV),
    // sempre excluindo renda (que tem lista própria na aba Renda) e transferência interna.
    transacoesDoMes() {
      return this.transactions
        .filter((t) => t.date.slice(0, 7) === this.mesFinanceiro)
        .filter((t) => !t.transferencia_interna)
        .filter((t) => t.kind !== "renda")
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

    // contas fixas + faturas de cartão ligadas a esse dia do calendário:
    // - PENDENTE aparece no dia do vencimento (due_date), em vermelho
    // - PAGA aparece no dia em que foi paga (paid_at), em verde
    // Assim o calendário "segue" a aba Compromissos fixos: pagar/editar lá move o marcador aqui.
    _diaDaConta(item) {
      return item.status === "pago" && item.paid_at ? item.paid_at.slice(0, 10) : item.due_date;
    },
    contasDoDia(dataISO) {
      if (!dataISO) return [];
      const contas = this.billPayments
        .filter((p) => this._diaDaConta(p) === dataISO)
        .map((p) => ({ titulo: this.billName(p.fixed_bill_id), valor: Number(p.amount || 0), origem: "conta_fixa", id: p.id, status: p.status, pago: p.status === "pago" }));
      const faturas = this.faturasCartao
        .filter((f) => this._diaDaConta(f) === dataISO && Number(f.amount || 0) > 0)
        .map((f) => ({ titulo: "Fatura " + this.cartaoNome(f.cartao_id), valor: Number(f.amount || 0), origem: "fatura_cartao", id: f.id, status: f.status, pago: f.status === "pago" }));
      return [...contas, ...faturas];
    },

    // só as que ainda faltam pagar naquele dia (pra marcadores/alertas de "vencendo")
    contasPendentesDoDia(dataISO) {
      return this.contasDoDia(dataISO).filter((c) => !c.pago);
    },

    // conflito financeiro = duas ou mais contas/faturas AINDA PENDENTES vencendo no mesmo dia
    temConflitoFinanceiro(dataISO) {
      return this.contasPendentesDoDia(dataISO).length >= 2;
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
        ...this.contasPendentesDoDia(hoje).map((c) => ({ titulo: c.titulo + " · " + this.fmtMoeda(c.valor), tipo: c.origem === "fatura_cartao" ? "Fatura vencendo" : "Conta vencendo", origem: "financeiro" })),
      ];
    },

    // agenda dos próximos 7 dias (hoje + 6), com eventos, contas a vencer e conflitos —
    // usada no painel pra mostrar "o que tem essa semana" de uma vez só.
    get agendaDaSemana() {
      const dias = [];
      for (let i = 0; i < 7; i++) {
        const dataISO = this.addDias(this.hojeISO(), i);
        const eventos = this.eventosDoDia(dataISO);
        const contas = this.contasPendentesDoDia(dataISO);
        dias.push({
          data: dataISO,
          eventos,
          contas,
          conflitoAgenda: this.temConflito(dataISO),
          conflitoFinanceiro: this.temConflitoFinanceiro(dataISO),
        });
      }
      return dias;
    },

    get conflitosNaSemana() {
      return this.agendaDaSemana.filter((d) => d.conflitoAgenda || d.conflitoFinanceiro).length;
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
