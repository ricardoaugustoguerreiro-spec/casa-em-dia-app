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
        vapid_claims = {"sub": os.environ.get("VAPID_SUBJECT", "mailto:casa-em-dia-app@example.com")}
        return url.rstrip("/"), service_key, vapid_priv, vapid_claims

    secs = SECFILE.read_text(encoding="utf-8")
    vapid = VAPIDFILE.read_text(encoding="utf-8")
    url = re.search(r"Project URL:\s*(\S+)", secs).group(1)
    service_key = re.search(r"Service_role key.*?:\s*\n?(\S+)", secs, re.S).group(1)
    vapid_priv = re.search(r"Chave privada.*?:\s*\n?(\S+)", vapid, re.S).group(1)
    vapid_claims = {"sub": re.search(r"mailto:\S+", vapid).group(0)}
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

    # ---------- 1. Contas/prazos vencendo ----------
    limite = (agora + timedelta(days=JANELA_CONTA_DIAS)).date().isoformat()
    pagamentos = rest(
        url, key, "bill_payments",
        {"select": "id,due_date,amount,fixed_bill_id,status", "status": "eq.pendente", "due_date": f"lte.{limite}"},
    )
    bills = {b["id"]: b for b in rest(url, key, "fixed_bills", {"select": "id,name"})}
    def enviar_pra_lista(chave, payload, destino):
        """Envia push pra cada sub em destino que ainda não recebeu esta chave.
        Retorna quantos envios novos foram feitos (sucesso ou não — a tentativa conta)."""
        if not destino:
            return 0
        ja_receberam = ja_enviados_chave(url, key, chave)
        pendentes = [s for s in destino if str(s["id"]) not in ja_receberam]
        if not pendentes:
            return 0
        novos = 0
        for s in pendentes:
            if enviar_push(url, key, s, payload, vapid_priv, vapid_claims):
                marcar_enviado(url, key, chave, s["id"])
                novos += 1
        return novos

    for p in pagamentos:
        chave = f"conta:{p['id']}"
        nome = bills.get(p["fixed_bill_id"], {}).get("name", "Conta")
        payload = {"title": "Conta vencendo", "body": f"{nome} vence em {p['due_date']}.", "url": "./index.html"}
        enviadas += enviar_pra_lista(chave, payload, subs_todos)

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
        enviadas += enviar_pra_lista(chave, payload, subs_todos)

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
        enviadas += enviar_pra_lista(chave, payload, subs_todos)

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
        enviadas += enviar_pra_lista(chave, payload, destino)

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
                enviadas += enviar_pra_lista(chave, payload, destino)

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
