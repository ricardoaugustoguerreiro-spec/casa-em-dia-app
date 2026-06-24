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
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from pywebpush import webpush, WebPushException

BASE_DIR = Path(__file__).resolve().parent.parent
SECFILE = BASE_DIR / "_segredos-nao-compartilhar" / "supabase.txt"
VAPIDFILE = BASE_DIR / "_segredos-nao-compartilhar" / "vapid.txt"

JANELA_EVENTO_MIN = 30  # avisa eventos que começam dentro desses minutos
JANELA_CONTA_DIAS = 1  # avisa contas que vencem dentro desses dias


def ler_segredo(texto, rotulo_inicio):
    m = re.search(re.escape(rotulo_inicio) + r"\s*\n?(.+?)\n", texto)
    if not m:
        raise RuntimeError(f"Não achei '{rotulo_inicio}' no arquivo de segredos.")
    return m.group(1).strip()


def carregar_config():
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


def ja_enviado(url, key, chave):
    res = rest(url, key, "notificacoes_enviadas", {"select": "chave", "chave": f"eq.{chave}"})
    return len(res) > 0


def marcar_enviado(url, key, chave):
    requests.post(
        f"{url}/rest/v1/notificacoes_enviadas",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates"},
        json={"chave": chave},
        timeout=20,
    )


def enviar_push(sub, payload, vapid_priv, vapid_claims):
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
    for p in pagamentos:
        chave = f"conta:{p['id']}"
        if ja_enviado(url, key, chave):
            continue
        nome = bills.get(p["fixed_bill_id"], {}).get("name", "Conta")
        payload = {"title": "Conta vencendo", "body": f"{nome} vence em {p['due_date']}.", "url": "./index.html"}
        if not subs_todos:
            continue  # ninguém inscrito ainda: não marca como enviado, tenta de novo na próxima execução
        if any(enviar_push(s, payload, vapid_priv, vapid_claims) for s in subs_todos):
            marcar_enviado(url, key, chave)
            enviadas += 1

    # ---------- 2. Eventos do calendário ----------
    eventos = rest(
        url, key, "events",
        {
            "select": "id,title,starts_at,owner_id,conjunto",
            "starts_at": [f"gte.{agora.isoformat()}", f"lte.{(agora + timedelta(minutes=JANELA_EVENTO_MIN)).isoformat()}"],
        },
    )
    for ev in eventos:
        chave = f"evento:{ev['id']}"
        if ja_enviado(url, key, chave):
            continue
        destino = quem_ve(ev["owner_id"], ev["conjunto"])
        payload = {"title": "Compromisso em breve", "body": f"{ev['title']} começa às {ev['starts_at'][11:16]}.", "url": "./index.html"}
        if not destino:
            continue
        if any(enviar_push(s, payload, vapid_priv, vapid_claims) for s in destino):
            marcar_enviado(url, key, chave)
            enviadas += 1

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
                if ja_enviado(url, key, chave):
                    continue
                vendo_a = {s["id"] for s in quem_ve(a["owner_id"], a["conjunto"])}
                vendo_b = {s["id"] for s in quem_ve(b["owner_id"], b["conjunto"])}
                destino = [s for s in subs_todos if s["id"] in vendo_a and s["id"] in vendo_b]
                if not destino:
                    continue
                payload = {
                    "title": "Conflito de agenda",
                    "body": f"\"{a['title']}\" bate com \"{b['title']}\".",
                    "url": "./index.html",
                }
                if any(enviar_push(s, payload, vapid_priv, vapid_claims) for s in destino):
                    marcar_enviado(url, key, chave)
                    enviadas += 1

    # ---------- 4. Pergunta diária: "teve gasto hoje?" ----------
    # Uma vez por dia (idempotente por data), pra todo mundo inscrito — financeiro é
    # compartilhado. Botão "Sim" abre o quickadd.html (1 toque, sem digitar na própria
    # notificação — isso não é suportado por Web Push em nenhuma plataforma, nem Android).
    HORA_PERGUNTA_DIARIA = 20  # só dispara a partir dessa hora local (horário de Brasília = UTC-3)
    hora_local = (agora - timedelta(hours=3)).hour
    if hora_local >= HORA_PERGUNTA_DIARIA:
        hoje = (agora - timedelta(hours=3)).date().isoformat()
        chave = f"pergunta_gasto:{hoje}"
        if not ja_enviado(url, key, chave) and subs_todos:
            payload = {
                "title": "Teve gasto hoje?",
                "body": "Toca em Sim pra lançar rapidinho no Dia a Dia.",
                "url": "./quickadd.html",
                "actions": [
                    {"action": "tive_gasto", "title": "Sim, lançar"},
                    {"action": "nao_tive", "title": "Não tive"},
                ],
            }
            if any(enviar_push(s, payload, vapid_priv, vapid_claims) for s in subs_todos):
                marcar_enviado(url, key, chave)
                enviadas += 1

    print(f"Notificações novas enviadas nesta execução: {enviadas}")


if __name__ == "__main__":
    main()
