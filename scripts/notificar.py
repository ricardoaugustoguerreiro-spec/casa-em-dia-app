"""
Verifica contas/prazos vencendo, eventos do calendário e conflitos de agenda no banco
do Casa em Dia, e envia notificação push (Web Push/VAPID) pros dispositivos inscritos.

Não depende de servidor próprio: lê tudo via REST do Supabase (service_role key) e
envia o push direto do próprio computador, igual ao padrão já usado no backup diário.
Idempotente: cada notificação só é enviada uma vez (controlado pela tabela
notificacoes_enviadas no banco).

Regra de privacidade (espelha o RLS do banco, modelo de calendário individual):
  - Contas/prazos (fixed_bills/bill_payments): financeiro é compartilhado -> notifica todo mundo.
  - Evento com conjunto=true: visível pros dois -> notifica todo mundo.
  - Evento com conjunto=false: só quem é dono (owner_id) -> notifica só essa pessoa.
  - Conflito entre dois eventos: notifica só quem consegue ver os DOIS eventos (dono de cada um, ou conjunto).

Uso: python3 scripts/notificar.py
Dependências: pip install requests pywebpush
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from pywebpush import webpush, WebPushException

BASE_DIR = Path(__file__).resolve().parent.parent
SECFILE = BASE_DIR / "_segredos-nao-compartilhar" / "supabase.txt"
VAPIDFILE = BASE_DIR / "_segredos-nao-compartilhar" / "vapid.txt"

JANELA_EVENTO_HORAS = 24  # começa a avisar eventos que faltam até essas horas
JANELA_CONTA_DIAS = 1  # avisa contas que vencem dentro desses dias

# E-mail do admin usado como fallback do claim VAPID "sub".
# ATENÇÃO: em GitHub Actions, `env: X: ${{ secrets.X }}` injeta string VAZIA
# quando a secret não existe/está vazia — então a env var EXISTE mas é "".
# Nesse caso `os.environ.get(..., default)` NÃO usa o default. Por isso o
# _sub_vapid abaixo trata vazio/sem-esquema explicitamente, senão py_vapid
# aborta TODO o envio com "Missing 'sub' from claims" e nenhum push sai.
VAPID_SUB_PADRAO = "mailto:ricardoaugustoguerreiro@gmail.com"


def _sub_vapid(valor):
    """Devolve um claim 'sub' VAPID sempre válido (mailto:/https:), nunca vazio."""
    v = (valor or "").strip()
    if not v:
        return VAPID_SUB_PADRAO
    if not v.startswith(("mailto:", "https:")):
        v = "mailto:" + v
    return v


def ler_segredo(texto, rotulo_inicio):
    m = re.search(re.escape(rotulo_inicio) + r"\s*\n?(.+?)\n", texto)
    if not m:
        raise RuntimeError(f"Não achei '{rotulo_inicio}' no arquivo de segredos.")
    return m.group(1).strip()


def carregar_config():
    # Em GitHub Actions, vem das secrets do repositório (sem precisar do PC ligado).
    # Localmente, cai pro arquivo de segredos como sempre.
    if os.environ.get("SUPABASE_URL"):
        url = os.environ["SUPABASE_URL"]
        service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        vapid_priv = os.environ["VAPID_PRIVATE_KEY"]
        vapid_claims = {"sub": _sub_vapid(os.environ.get("VAPID_SUBJECT"))}
        return url.rstrip("/"), service_key, vapid_priv, vapid_claims

    secs = SECFILE.read_text(encoding="utf-8")
    vapid = VAPIDFILE.read_text(encoding="utf-8")
    url = re.search(r"Project URL:\s*(\S+)", secs).group(1)
    service_key = re.search(r"Service_role key.*?:\s*\n?(\S+)", secs, re.S).group(1)
    vapid_priv = re.search(r"Chave privada.*?:\s*\n?(\S+)", vapid, re.S).group(1)
    m_sub = re.search(r"mailto:\S+", vapid)
    vapid_claims = {"sub": _sub_vapid(m_sub.group(0) if m_sub else None)}
    return url.rstrip("/"), service_key, vapid_priv, vapid_claims


def rest(url, key, path, params=None):
    r = requests.get(
        f"{url}/rest/v1/{path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params=params or {},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


def ja_enviados_chave(url, key, chave):
    """Retorna set de sub_ids que já receberam esta chave."""
    res = rest(url, key, "notificacoes_enviadas", {"select": "sub_id", "chave": f"eq.{chave}"})
    return {r["sub_id"] for r in res}


def marcar_enviado(url, key, chave, sub_id):
    requests.post(
        f"{url}/rest/v1/notificacoes_enviadas",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates"},
        json={"chave": chave, "sub_id": str(sub_id)},
        timeout=20,
    )


def enviar_push(url, key, sub, payload, vapid_priv, vapid_claims):
    try:
        webpush(
            subscription_info={
                "endpoint": sub["endpoint"],
                "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
            },
            data=json.dumps(payload),
            vapid_private_key=vapid_priv,
            vapid_claims=dict(vapid_claims),
        )
        return True
    except WebPushException as e:
        print(f"  [erro push] {sub['endpoint'][:60]}...: {e}")
        # 410 Gone = subscription expirada/cancelada → limpa o banco pra não poluir
        if "410" in str(e):
            requests.delete(
                f"{url}/rest/v1/push_subscriptions",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                params={"id": f"eq.{sub['id']}"},
                timeout=10,
            )
            print(f"  [limpeza] subscription expirada removida: {sub['id']}")
        return False
    except Exception as e:
        # Qualquer outro erro (ex.: VapidException por config, chave inválida)
        # NÃO pode derrubar a execução inteira e bloquear os demais avisos —
        # isola por dispositivo e segue. Ver histórico do bug do claim 'sub'.
        print(f"  [erro push inesperado] {sub['endpoint'][:60]}...: {e}")
        return False


def main():
    url, key, vapid_priv, vapid_claims = carregar_config()
    agora = datetime.now(timezone.utc)

    subs = rest(url, key, "push_subscriptions", {"select": "id,user_id,endpoint,p256dh,auth"})
    subs_todos = subs

    def quem_ve(owner_id, conjunto):
        if conjunto:
            return subs_todos
        return [s for s in subs_todos if s["user_id"] == owner_id]

    enviadas = 0

    # Controle anti-burst: máximo 1 notificação informativa por sub por execução.
    # Notificações urgentes (conta vencendo, evento em breve) passam sem limite.
    # Notificações informativas (agenda, pergunta de gasto) respeitam o limite —
    # a que não foi enviada nesta rodada será enviada na próxima (15 min depois).
    # Isso evita que 4-5 notificações cheguem juntas e o Android/MIUI suprima as extras.
    sub_recebeu_informativa = set()

    def enviar_pra_lista(chave, payload, destino, urgente=False):
        """Envia push pra cada sub em destino que ainda não recebeu esta chave.
        urgente=True: sem limite de burst (conta vencendo, lembrete de evento).
        urgente=False (padrão): pula subs que já receberam outra notificação
          informativa nesta execução — a notificação volta na próxima rodada (15 min).
        """
        if not destino:
            return 0
        ja_receberam = ja_enviados_chave(url, key, chave)
        pendentes = [s for s in destino if str(s["id"]) not in ja_receberam]
        if not urgente:
            pendentes = [s for s in pendentes if s["id"] not in sub_recebeu_informativa]
        if not pendentes:
            return 0
        novos = 0
        for s in pendentes:
            if enviar_push(url, key, s, payload, vapid_priv, vapid_claims):
                marcar_enviado(url, key, chave, s["id"])
                if not urgente:
                    sub_recebeu_informativa.add(s["id"])
                novos += 1
        return novos

    # ---------- 1. Contas/prazos vencendo ----------
    limite = (agora + timedelta(days=JANELA_CONTA_DIAS)).date().isoformat()
    pagamentos = rest(
        url, key, "bill_payments",
        {"select": "id,due_date,amount,fixed_bill_id,status", "status": "eq.pendente", "due_date": f"lte.{limite}"},
    )
    bills = {b["id"]: b for b in rest(url, key, "fixed_bills", {"select": "id,name"})}

    for p in pagamentos:
        chave = f"conta:{p['id']}"
        nome = bills.get(p["fixed_bill_id"], {}).get("name", "Conta")
        payload = {"title": "Conta vencendo", "body": f"{nome} vence em {p['due_date']}.", "url": "./index.html"}
        enviadas += enviar_pra_lista(chave, payload, subs_todos, urgente=True)

    # ---------- 1b. Faturas de cartão vencendo ----------
    faturas = rest(
        url, key, "faturas_cartao",
        {"select": "id,due_date,amount,cartao_id,status", "status": "eq.pendente", "due_date": f"lte.{limite}"},
    )
    cartoes = {c["id"]: c for c in rest(url, key, "cartoes", {"select": "id,nome"})}
    for f in faturas:
        if not f.get("amount"):
            continue
        chave = f"fatura:{f['id']}"
        nome = cartoes.get(f["cartao_id"], {}).get("nome", "Cartão")
        payload = {"title": "Fatura vencendo", "body": f"Fatura {nome} vence em {f['due_date']}.", "url": "./index.html"}
        enviadas += enviar_pra_lista(chave, payload, subs_todos, urgente=True)

    # ---------- 1c. Conflito financeiro: 2+ contas/faturas vencendo no mesmo dia ----------
    vencimentos_por_dia = {}
    for p in pagamentos:
        vencimentos_por_dia.setdefault(p["due_date"], []).append(bills.get(p["fixed_bill_id"], {}).get("name", "Conta"))
    for f in faturas:
        if not f.get("amount"):
            continue
        vencimentos_por_dia.setdefault(f["due_date"], []).append("Fatura " + cartoes.get(f["cartao_id"], {}).get("nome", "Cartão"))
    for dia, nomes in vencimentos_por_dia.items():
        if len(nomes) < 2:
            continue
        chave = f"conflito_financeiro:{dia}"
        payload = {"title": "Conflito de contas", "body": f"{len(nomes)} contas/faturas vencem em {dia}: {', '.join(nomes)}.", "url": "./index.html"}
        enviadas += enviar_pra_lista(chave, payload, subs_todos, urgente=True)

    # ---------- 2. Eventos do calendário (lembrete de hora em hora até começar) ----------
    # Cada usuário pode silenciar os lembretes de um evento específico (tabela
    # eventos_silenciados) clicando em "Desligar avisos" na própria notificação —
    # útil pra evitar desgaste de receber o mesmo aviso toda hora sem parar.
    silenciados = rest(url, key, "eventos_silenciados", {"select": "event_id,user_id"})
    muted = {(s["event_id"], s["user_id"]) for s in silenciados}

    eventos = rest(
        url, key, "events",
        {
            "select": "id,title,starts_at,owner_id,conjunto",
            "starts_at": [f"gte.{agora.isoformat()}", f"lte.{(agora + timedelta(hours=JANELA_EVENTO_HORAS)).isoformat()}"],
        },
    )
    tick = agora.replace(minute=0, second=0, microsecond=0).isoformat()
    for ev in eventos:
        chave = f"evento:{ev['id']}:{tick}"
        destino = [s for s in quem_ve(ev["owner_id"], ev["conjunto"]) if (ev["id"], s["user_id"]) not in muted]
        payload = {
            "title": "Compromisso em breve",
            "body": f"{ev['title']} começa às {ev['starts_at'][11:16]}.",
            "url": "./index.html",
            "actions": [{"action": "silenciar_evento", "title": "Desligar avisos deste evento"}],
            "eventoId": ev["id"],
        }
        enviadas += enviar_pra_lista(chave, payload, destino, urgente=True)

    # ---------- 3. Conflitos de agenda (qualquer par de eventos sobrepostos) ----------
    proximos_dias = [(agora + timedelta(days=d)).date().isoformat() for d in range(0, 3)]
    todos_eventos = rest(
        url, key, "events",
        {"select": "id,title,starts_at,ends_at,owner_id,conjunto", "starts_at": f"gte.{proximos_dias[0]}", "ends_at": f"lte.{proximos_dias[-1]}T23:59:59"},
    )
    for i, a in enumerate(todos_eventos):
        for b in todos_eventos[i + 1:]:
            if a["starts_at"] < b["ends_at"] and b["starts_at"] < a["ends_at"]:
                chave = f"conflito:{a['id']}:{b['id']}"
                vendo_a = {s["id"] for s in quem_ve(a["owner_id"], a["conjunto"])}
                vendo_b = {s["id"] for s in quem_ve(b["owner_id"], b["conjunto"])}
                destino = [s for s in subs_todos if s["id"] in vendo_a and s["id"] in vendo_b]
                payload = {
                    "title": "Conflito de agenda",
                    "body": f"\"{a['title']}\" bate com \"{b['title']}\".",
                    "url": "./index.html",
                }
                enviadas += enviar_pra_lista(chave, payload, destino, urgente=True)

    # ---------- Dados base para seções de calendário (5-8) ----------
    perfis = {p["id"]: p for p in rest(url, key, "profiles", {"select": "id,display_name,role"})}

    # Subscriptions agrupadas por user_id
    subs_por_user = {}
    for s in subs_todos:
        subs_por_user.setdefault(s["user_id"], []).append(s)

    # UID da Jéssica (membro, não admin) — sem hardcode, lido do banco
    uid_jessica = next((uid for uid, p in perfis.items() if p["role"] == "membro"), None)
    subs_jessica = subs_por_user.get(uid_jessica, []) if uid_jessica else []

    # Helpers de tempo local (Brasília = UTC-3)
    agora_br = agora - timedelta(hours=3)
    hoje_br = agora_br.date().isoformat()
    amanha_br = (agora_br + timedelta(days=1)).date().isoformat()
    hora_br = agora_br.hour
    semana_br = agora_br.isocalendar()[1]  # número da semana ISO

    # Busca eventos por janela de data (converte meia-noite Brasília pra UTC)
    def eventos_janela(data_inicio_br, data_fim_br):
        """Retorna eventos que começam no período [meia-noite data_inicio .. meia-noite data_fim] Brasília."""
        utc_ini = datetime(
            int(data_inicio_br[:4]), int(data_inicio_br[5:7]), int(data_inicio_br[8:]),
            3, 0, 0, tzinfo=timezone.utc
        )
        utc_fim = datetime(
            int(data_fim_br[:4]), int(data_fim_br[5:7]), int(data_fim_br[8:]),
            3, 0, 0, tzinfo=timezone.utc
        )
        return rest(url, key, "events", {
            "select": "id,title,starts_at,owner_id,conjunto",
            "starts_at": [f"gte.{utc_ini.isoformat()}", f"lt.{utc_fim.isoformat()}"],
            "order": "starts_at",
        })

    def eventos_visiveis(uid, lista):
        """Filtra os eventos que o usuário uid pode ver (dono ou conjunto)."""
        return [ev for ev in lista if ev["conjunto"] or ev["owner_id"] == uid]

    def formatar_lista(evs):
        """Transforma lista de eventos em texto legível: 'Titulo as HH:MM, ...'"""
        partes = []
        for ev in evs:
            hora_str = ev["starts_at"][11:16]
            # Converte UTC pra Brasília
            h = int(hora_str[:2]) - 3
            m = hora_str[3:]
            if h < 0:
                h += 24
            partes.append(f"{ev['title']} as {h:02d}:{m}")
        return ", ".join(partes) if partes else ""

    # ---------- 5. Resumo matinal da agenda (08h Brasília, por pessoa) ----------
    # Cada um recebe seus compromissos do dia — privacidade respeitada.
    if hora_br >= 8:
        evs_hoje = eventos_janela(hoje_br, amanha_br)
        for uid, subs_user in subs_por_user.items():
            nome = perfis.get(uid, {}).get("display_name", "")
            meus = eventos_visiveis(uid, evs_hoje)
            chave = f"agenda_hoje:{uid}:{hoje_br}"
            if meus:
                lista = formatar_lista(meus)
                body = f"Hoje: {lista}."
            else:
                body = "Hoje sua agenda esta livre!"
            payload = {
                "title": f"Bom dia, {nome}!" if nome else "Bom dia!",
                "body": body,
                "url": "./index.html",
            }
            enviadas += enviar_pra_lista(chave, payload, subs_user)

    # ---------- 6. Preview dos compromissos de amanhã (19h Brasília, por pessoa) ----------
    if hora_br >= 19:
        depois_amanha_br = (agora_br + timedelta(days=2)).date().isoformat()
        evs_amanha = eventos_janela(amanha_br, depois_amanha_br)
        for uid, subs_user in subs_por_user.items():
            nome = perfis.get(uid, {}).get("display_name", "")
            meus = eventos_visiveis(uid, evs_amanha)
            chave = f"agenda_amanha:{uid}:{hoje_br}"
            if meus:
                lista = formatar_lista(meus)
                body = f"Amanha: {lista}."
            else:
                body = "Amanha sua agenda esta livre!"
            payload = {
                "title": f"Agenda de amanha, {nome}" if nome else "Agenda de amanha",
                "body": body,
                "url": "./index.html",
            }
            enviadas += enviar_pra_lista(chave, payload, subs_user)

    # ---------- 7. Pergunta do calendário pra Jéssica (21h Brasília) ----------
    # Pergunta diária só pra ela: quer adicionar algo no calendário?
    if hora_br >= 21 and subs_jessica:
        chave = f"calendario_jessica:{hoje_br}"
        payload = {
            "title": "Calendario",
            "body": "Jessica, quer adicionar algo no seu calendario para amanha ou essa semana?",
            "url": "./index.html",
            "actions": [
                {"action": "abrir_calendario", "title": "Abrir calendario"},
            ],
        }
        enviadas += enviar_pra_lista(chave, payload, subs_jessica)

    # ---------- 8. Resumo semanal (segunda-feira às 08h Brasília) ----------
    # Mostra os compromissos dos próximos 7 dias pra cada um.
    if agora_br.weekday() == 0 and hora_br >= 8:  # weekday 0 = segunda
        fim_semana_br = (agora_br + timedelta(days=7)).date().isoformat()
        evs_semana = eventos_janela(hoje_br, fim_semana_br)
        for uid, subs_user in subs_por_user.items():
            nome = perfis.get(uid, {}).get("display_name", "")
            meus = eventos_visiveis(uid, evs_semana)
            chave = f"resumo_semana:{uid}:{agora_br.year}w{semana_br}"
            if meus:
                # Agrupa por dia para mensagem mais legível
                por_dia = {}
                for ev in meus:
                    dia = ev["starts_at"][:10]
                    por_dia.setdefault(dia, []).append(ev["title"])
                partes = [f"{dia[8:10]}/{dia[5:7]}: {', '.join(nomes)}" for dia, nomes in sorted(por_dia.items())]
                body = f"Esta semana ({len(meus)} compromisso(s)): {'; '.join(partes)}."
            else:
                body = "Esta semana sua agenda esta livre!"
            payload = {
                "title": f"Semana de {nome}" if nome else "Sua semana",
                "body": body,
                "url": "./index.html",
            }
            enviadas += enviar_pra_lista(chave, payload, subs_user)

    # ---------- 4. Pergunta diária: "teve gasto hoje?" (2x por dia) ----------
    # Dispara ao meio-dia (12h) e à noite (20h) — idempotente por (data+turno, sub_id).
    # Botão "Sim" abre quickadd.html (Web Push não permite digitar texto na notificação).
    TURNOS = [
        (12, "manha", "Já teve algum gasto hoje? Lança aqui pra não esquecer."),
        (20, "noite", "Toca em Sim pra lançar rapidinho no Dia a Dia."),
    ]
    hora_local = (agora - timedelta(hours=3)).hour
    hoje = (agora - timedelta(hours=3)).date().isoformat()
    for hora_turno, sufixo, body_msg in TURNOS:
        if hora_local >= hora_turno:
            chave = f"pergunta_gasto_{sufixo}:{hoje}"
            payload = {
                "title": "Teve gasto hoje?",
                "body": body_msg,
                "url": "./quickadd.html",
                "actions": [
                    {"action": "tive_gasto", "title": "Sim, lançar"},
                    {"action": "nao_tive", "title": "Não tive"},
                ],
            }
            enviadas += enviar_pra_lista(chave, payload, subs_todos)

    print(f"Notificações novas enviadas nesta execução: {enviadas}")


if __name__ == "__main__":
    main()
