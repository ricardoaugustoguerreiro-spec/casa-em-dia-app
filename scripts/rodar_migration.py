"""
Roda um arquivo .sql de supabase/ direto no Postgres do Supabase, sem precisar
abrir o SQL Editor manualmente. Usa pg8000 (puro Python, não precisa de binário
compilado nem de psql instalado).

Uso:
    python scripts/rodar_migration.py supabase/migration_xyz.sql

Depois de rodar com sucesso, registra o nome do arquivo em
supabase/migrations_aplicadas.txt (com data), pra skills futuras saberem
quais migrations já foram aplicadas e quais ainda faltam.
"""
import sys
import re
import datetime
from pathlib import Path

import pg8000.native

APP_DIR = Path(__file__).resolve().parent.parent
SECFILE = APP_DIR / "_segredos-nao-compartilhar" / "supabase.txt"
APLICADAS_FILE = APP_DIR / "supabase" / "migrations_aplicadas.txt"


def ler_senha_banco():
    texto = SECFILE.read_text(encoding="utf-8")
    m = re.search(r"Senha do banco \(Postgres\)[^\n]*\n(.+)", texto)
    if not m:
        raise RuntimeError(f"Não encontrei a senha do banco em {SECFILE}")
    return m.group(1).strip()


def ja_aplicada(nome_arquivo):
    if not APLICADAS_FILE.exists():
        return False
    return any(nome_arquivo in linha for linha in APLICADAS_FILE.read_text(encoding="utf-8").splitlines())


def marcar_aplicada(nome_arquivo):
    APLICADAS_FILE.parent.mkdir(parents=True, exist_ok=True)
    agora = datetime.datetime.now().isoformat(timespec="seconds")
    with APLICADAS_FILE.open("a", encoding="utf-8") as f:
        f.write(f"{nome_arquivo} | aplicada em {agora}\n")


def rodar(caminho_sql):
    caminho_sql = Path(caminho_sql)
    nome = caminho_sql.name

    if ja_aplicada(nome):
        print(f"[pulado] {nome} já está marcada como aplicada em {APLICADAS_FILE.name}.")
        return

    senha = ler_senha_banco()
    conn = pg8000.native.Connection(
        user="postgres",
        password=senha,
        host="db.aynteobslozppsjxgheo.supabase.co",
        port=5432,
        database="postgres",
        ssl_context=True,
    )
    try:
        sql = caminho_sql.read_text(encoding="utf-8")
        resultado = conn.run(sql)
        print(f"[ok] {nome} rodou com sucesso. Resultado: {resultado}")
        marcar_aplicada(nome)
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Uso: python scripts/rodar_migration.py supabase/migration_xyz.sql")
        sys.exit(1)
    rodar(sys.argv[1])
