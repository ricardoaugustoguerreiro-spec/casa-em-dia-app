"""
Motor de verificação automática do sistema Casa em Dia.

Roda diariamente via GitHub Actions (.github/workflows/verificar.yml).
Verifica TUDO que poderia fazer o sistema parar silenciosamente, e reporta
erros abrindo uma GitHub Issue automaticamente — sem precisar de ninguém
olhando o painel manualmente.

Saídas possíveis:
  - Tudo OK: apenas imprime relatório e termina com código 0.
  - Alguma falha: imprime relatório, cria issue no GitHub, termina com código 1.

Uso local:
  python scripts/verificar_sistema.py
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
SECFILE = BASE_DIR / "_segredos-nao-compartilhar" / "supabase.txt"

# Tabelas que o notificar.py consulta — se qualquer uma sumir, o script crasha.
TABELAS_NOTIFICAR = [
    "push_subscriptions",
    "notificacoes_enviadas",
    "bill_payments",
    "fixed_bills",
    "faturas_cartao",
    "cartoes",
    "events",
    "eventos_silenciados",
]

# Tabelas que devem existir no banco (todas já aplicadas)
TABELAS_BANCO = TABELAS_NOTIFICAR + [
    "profiles", "categories", "transactions", "balances",
    "compras_parceladas", "imports", "dismissed_insights",
    "tarefas_joias", "dia_a_dia", "dias_menstruacao",
    "registros_intimos", "cartoes",
]


def carregar_config():
    if os.environ.get("SUPABASE_URL"):
        return (
            os.environ["SUPABASE_URL"].rstrip("/"),
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
            os.environ.get("GITHUB_TOKEN"),
            os.environ.get("GITHUB_REPOSITORY"),
        )
    secs = SECFILE.read_text(encoding="utf-8")
    url = re.search(r"Project URL:\s*(\S+)", secs).group(1)
    key = re.search(r"Service_role key.*?:\s*\n?(\S+)", secs, re.S).group(1)
    return url.rstrip("/"), key, None, None


def rest_get(url, key, tabela, params=None):
    r = requests.get(
        f"{url}/rest/v1/{tabela}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params=params or {},
        timeout=15,
    )
    return r.status_code, r.json() if r.ok else r.text


def criar_issue(token, repo, titulo, corpo):
    if not token or not repo:
        print("  [issue] sem GITHUB_TOKEN/GITHUB_REPOSITORY — não foi possível abrir issue.")
        return
    r = requests.post(
        f"https://api.github.com/repos/{repo}/issues",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json={"title": titulo, "body": corpo, "labels": ["bug", "auto-verificacao"]},
        timeout=15,
    )
    if r.ok:
        print(f"  [issue] aberta: {r.json().get('html_url')}")
    else:
        print(f"  [issue] falha ao abrir: {r.status_code} {r.text}")


def verificar_issues_abertas(token, repo):
    """Retorna True se já existe uma issue de verificação aberta (evita spam)."""
    if not token or not repo:
        return False
    r = requests.get(
        f"https://api.github.com/repos/{repo}/issues",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        params={"labels": "auto-verificacao", "state": "open"},
        timeout=15,
    )
    if r.ok:
        return len(r.json()) > 0
    return False


def main():
    agora = datetime.now(timezone.utc)
    erros = []
    avisos = []

    print(f"=== Verificação do sistema Casa em Dia — {agora.strftime('%Y-%m-%d %H:%M UTC')} ===\n")

    try:
        url, key, gh_token, gh_repo = carregar_config()
    except Exception as e:
        print(f"[ERRO CRÍTICO] Não foi possível carregar configuração: {e}")
        print("Verifique os GitHub Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY")
        sys.exit(1)

    # ── 1. Tabelas do notificar.py ──────────────────────────────────────────
    print("1. Tabelas usadas pelo notificar.py:")
    for tabela in TABELAS_NOTIFICAR:
        status, resp = rest_get(url, key, tabela, {"select": "count", "limit": "1"})
        if status == 200:
            print(f"   [OK] {tabela}")
        elif status == 404:
            msg = f"Tabela '{tabela}' NÃO EXISTE no banco — notificar.py vai crashar"
            print(f"   [ERRO] {tabela}: {msg}")
            erros.append(msg)
        else:
            msg = f"Tabela '{tabela}' retornou HTTP {status}: {str(resp)[:120]}"
            print(f"   [AVISO] {tabela}: {msg}")
            avisos.append(msg)

    # ── 2. Subscriptions ativas ─────────────────────────────────────────────
    print("\n2. Subscriptions de push:")
    status, subs = rest_get(url, key, "push_subscriptions", {"select": "id,user_id,created_at"})
    if status == 200:
        print(f"   Total: {len(subs)} subscription(s) ativa(s)")
        if len(subs) == 0:
            msg = "Nenhuma subscription ativa — ninguém vai receber notificação"
            print(f"   [AVISO] {msg}")
            avisos.append(msg)
        for s in subs:
            print(f"   - user={s['user_id'][:8]}... criada em {s['created_at'][:10]}")
    else:
        msg = f"Não foi possível ler push_subscriptions: HTTP {status}"
        print(f"   [ERRO] {msg}")
        erros.append(msg)

    # ── 3. Últimas notificações enviadas ────────────────────────────────────
    print("\n3. Últimas notificações enviadas (tabela notificacoes_enviadas):")
    status, enviadas = rest_get(url, key, "notificacoes_enviadas",
                                 {"select": "chave,enviado_em", "order": "enviado_em.desc", "limit": "5"})
    if status == 200:
        if not enviadas:
            msg = "Tabela notificacoes_enviadas está vazia — sistema pode nunca ter enviado nada"
            print(f"   [AVISO] {msg}")
            avisos.append(msg)
        else:
            for e in enviadas:
                print(f"   - {e['enviado_em'][:16]} -> {e['chave']}")
            # Alerta se a notificação mais recente é muito antiga
            ultima = datetime.fromisoformat(enviadas[0]["enviado_em"].replace("Z", "+00:00"))
            horas_desde = (agora - ultima).total_seconds() / 3600
            if horas_desde > 26:
                msg = f"Última notificação foi há {horas_desde:.0f}h — o sistema pode estar parado"
                print(f"   [AVISO] {msg}")
                avisos.append(msg)
    else:
        msg = f"Não foi possível ler notificacoes_enviadas: HTTP {status}"
        print(f"   [ERRO] {msg}")
        erros.append(msg)

    # ── 4. Pergunta diária: foi enviada hoje? ───────────────────────────────
    print("\n4. Pergunta diária 'Teve gasto hoje?':")
    hoje = (agora - timedelta(hours=3)).date().isoformat()
    for sufixo, hora_nome in [("manha", "12h"), ("noite", "20h")]:
        chave = f"pergunta_gasto_{sufixo}:{hoje}"
        status, res = rest_get(url, key, "notificacoes_enviadas",
                                {"select": "chave,enviado_em", "chave": f"eq.{chave}"})
        if status == 200 and res:
            print(f"   [OK] {hora_nome} ({sufixo}): enviada às {res[0]['enviado_em'][11:16]} UTC")
        else:
            hora_local = (agora - timedelta(hours=3)).hour
            hora_disparo = 12 if sufixo == "manha" else 20
            if hora_local >= hora_disparo:
                msg = f"Pergunta do {hora_nome} ({sufixo}) não foi enviada hoje ainda — sistema pode estar falhando"
                print(f"   [AVISO] {msg}")
                avisos.append(msg)
            else:
                print(f"   [INFO] {hora_nome} ({sufixo}): ainda não é hora (dispara às {hora_nome} Brasília)")

    # ── 5. Segredos necessários (via env vars em Actions) ───────────────────
    print("\n5. Secrets/variáveis de ambiente:")
    secrets_necessarios = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]
    for s in secrets_necessarios:
        if os.environ.get(s):
            print(f"   [OK] {s}")
        else:
            # Rodando localmente via arquivo — não é erro, só info
            print(f"   [INFO] {s}: não está como env var (OK se rodando localmente com arquivo de segredos)")

    # ── 6. Contas fixas com vencimento próximo (consistência de dados) ───────
    print("\n6. Contas fixas pendentes nos próximos 7 dias:")
    limite = (agora + timedelta(days=7)).date().isoformat()
    status, pagamentos = rest_get(url, key, "bill_payments",
                                   {"select": "id,due_date,status,fixed_bill_id",
                                    "status": "eq.pendente", "due_date": f"lte.{limite}"})
    if status == 200:
        if not pagamentos:
            print("   [INFO] Nenhuma conta pendente nos próximos 7 dias")
        else:
            print(f"   {len(pagamentos)} conta(s) pendente(s):")
            for p in pagamentos:
                print(f"   - {p['due_date']}: bill_id={p['fixed_bill_id'][:8]}...")
    else:
        print(f"   [AVISO] Não foi possível ler bill_payments: HTTP {status}")

    # ── Resultado final ──────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    if erros:
        print(f"[ERRO] SISTEMA COM ERROS ({len(erros)} erro(s) crítico(s)):")
        for e in erros:
            print(f"   - {e}")
    if avisos:
        print(f"[AVISO] AVISOS ({len(avisos)} aviso(s)):")
        for a in avisos:
            print(f"   - {a}")
    if not erros and not avisos:
        print("[OK] Sistema OK — tudo verificado, nenhum problema encontrado.")

    # Abre issue no GitHub se houver erro (mas só se não já tiver uma aberta)
    if erros:
        if not verificar_issues_abertas(gh_token, gh_repo):
            corpo = f"""## Verificação automática encontrou erros — {agora.strftime('%Y-%m-%d %H:%M UTC')}

### Erros críticos encontrados:
{chr(10).join(f'- {e}' for e in erros)}

{'### Avisos:' + chr(10) + chr(10).join(f'- {a}' for a in avisos) if avisos else ''}

---
*Aberta automaticamente pelo workflow `verificar.yml`. Feche esta issue após corrigir.*
"""
            criar_issue(gh_token, gh_repo, f"[Auto] Sistema de notificações com erro — {hoje}", corpo)
        else:
            print("\n  [issue] já existe uma issue de verificação aberta — não criando duplicata.")

    sys.exit(1 if erros else 0)


if __name__ == "__main__":
    main()
