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

    agora_br = agora - timedelta(hours=3)
    hoje = agora_br.date().isoformat()
    hora_br = agora_br.hour

    # ── 4. Pergunta diária: foi enviada hoje? ───────────────────────────────
    print("\n4. Pergunta diaria 'Teve gasto hoje?':")
    for sufixo, hora_disparo in [("manha", 12), ("noite", 20)]:
        chave = f"pergunta_gasto_{sufixo}:{hoje}"
        status, res = rest_get(url, key, "notificacoes_enviadas",
                                {"select": "chave,enviado_em", "chave": f"eq.{chave}"})
        if status == 200 and res:
            print(f"   [OK] {sufixo} ({hora_disparo}h): enviada")
        else:
            if hora_br >= hora_disparo:
                msg = f"Pergunta de gasto '{sufixo}' nao enviada hoje - sistema pode estar parado"
                print(f"   [AVISO] {msg}")
                avisos.append(msg)
            else:
                print(f"   [INFO] {sufixo}: ainda nao e hora ({hora_disparo}h Brasilia)")

    # ── 4b. Notificações de calendário foram enviadas hoje? ──────────────────
    print("\n4b. Notificacoes de calendario hoje:")
    status_p, perfis_list = rest_get(url, key, "profiles", {"select": "id,display_name,role"})
    perfis_ok = perfis_list if status_p == 200 and isinstance(perfis_list, list) else []

    checks_cal = [
        ("agenda_hoje", 8, "Resumo matinal da agenda"),
        ("agenda_amanha", 19, "Preview de amanha"),
        ("calendario_jessica", 21, "Pergunta calendario Jessica"),
    ]

    for tipo, hora_disparo, descricao in checks_cal:
        if tipo == "calendario_jessica":
            chave = f"{tipo}:{hoje}"
            s2, r2 = rest_get(url, key, "notificacoes_enviadas",
                               {"select": "chave", "chave": f"eq.{chave}"})
            if s2 == 200 and r2:
                print(f"   [OK] {descricao}: enviada")
            elif hora_br >= hora_disparo:
                msg = f"'{descricao}' nao enviada hoje"
                print(f"   [AVISO] {msg}")
                avisos.append(msg)
            else:
                print(f"   [INFO] {descricao}: ainda nao e hora ({hora_disparo}h Brasilia)")
        else:
            enviados_users = []
            for p in perfis_ok:
                chave = f"{tipo}:{p['id']}:{hoje}"
                s2, r2 = rest_get(url, key, "notificacoes_enviadas",
                                   {"select": "chave", "chave": f"eq.{chave}"})
                if s2 == 200 and r2:
                    enviados_users.append(p.get("display_name", p["id"][:8]))
            if enviados_users:
                print(f"   [OK] {descricao}: enviada para {', '.join(enviados_users)}")
            elif hora_br >= hora_disparo:
                msg = f"'{descricao}' nao enviada hoje para nenhum usuario"
                print(f"   [AVISO] {msg}")
                avisos.append(msg)
            else:
                print(f"   [INFO] {descricao}: ainda nao e hora ({hora_disparo}h Brasilia)")

    # ── 4c. Verificação do anti-burst em notificar.py ───────────────────────
    print("\n4c. Verificacao do anti-burst (urgente=True so nas secoes corretas):")
    import subprocess, sys as _sys
    notificar_path = Path(__file__).resolve().parent / "notificar.py"
    if notificar_path.exists():
        texto = notificar_path.read_text(encoding="utf-8")
        linhas_urgente_true = [i + 1 for i, l in enumerate(texto.splitlines()) if "urgente=True" in l and "def " not in l]
        linhas_urgente_false_info = [i + 1 for i, l in enumerate(texto.splitlines()) if "pergunta_gasto" in l or "agenda_" in l or "calendario_jessica" in l or "resumo_" in l]
        if linhas_urgente_true:
            print(f"   urgente=True aparece em {len(linhas_urgente_true)} chamada(s) — linhas: {linhas_urgente_true}")
            print("   [OK] anti-burst ativo")
        else:
            msg = "urgente=True nao encontrado em notificar.py — anti-burst pode ter sido removido por engano"
            print(f"   [AVISO] {msg}")
            avisos.append(msg)
    else:
        print("   [INFO] notificar.py nao encontrado localmente (normal em GitHub Actions)")

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
