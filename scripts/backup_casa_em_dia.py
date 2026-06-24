"""
Backup diário do banco Postgres (Supabase próprio) do app financeiro "Casa em Dia".
Descobre as tabelas do schema public via information_schema, exporta cada uma
(até 5000 linhas) num único JSON e mantém só os 30 backups mais recentes.

Em GitHub Actions: lê a senha de DB_PASSWORD (secret do repo) e salva em ./backup-output/
(pra subir como artifact — NUNCA commitar isso no repositório público, tem dado financeiro real).
Localmente: lê do arquivo de segredos e salva no Google Drive como sempre.

Uso:
    python scripts/backup_casa_em_dia.py
"""
import json
import os
import re
import datetime
from pathlib import Path

import pg8000.native

APP_DIR = Path(__file__).resolve().parent.parent
SECFILE = APP_DIR / "_segredos-nao-compartilhar" / "supabase.txt"
RODANDO_NO_GITHUB = bool(os.environ.get("GITHUB_ACTIONS"))
BACKUP_DIR = Path("backup-output") if RODANDO_NO_GITHUB else Path(r"H:\Meu Drive\FINANÇAS\Backups-CasaEmDia")
MAX_BACKUPS = 30


def ler_senha_banco():
    if os.environ.get("DB_PASSWORD"):
        return os.environ["DB_PASSWORD"]
    texto = SECFILE.read_text(encoding="utf-8")
    m = re.search(r"Senha do banco \(Postgres\)[^\n]*\n(.+)", texto)
    if not m:
        raise RuntimeError(f"Não encontrei a senha do banco em {SECFILE}")
    return m.group(1).strip()


def conectar():
    senha = ler_senha_banco()
    return pg8000.native.Connection(
        user="postgres",
        password=senha,
        host="db.aynteobslozppsjxgheo.supabase.co",
        port=5432,
        database="postgres",
        ssl_context=True,
    )


def listar_tabelas(conn):
    linhas = conn.run(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE'"
    )
    return [linha[0] for linha in linhas]


def exportar_tabela(conn, nome_tabela):
    linhas = conn.run(f'SELECT * FROM public."{nome_tabela}" LIMIT 5000')
    colunas = [c["name"] for c in conn.columns]
    return [dict(zip(colunas, linha)) for linha in linhas]


def limpar_antigos():
    arquivos = sorted(BACKUP_DIR.glob("casa-em-dia-backup-*.json"))
    if len(arquivos) > MAX_BACKUPS:
        for f in arquivos[: len(arquivos) - MAX_BACKUPS]:
            f.unlink()


def fazer_backup():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    conn = conectar()
    try:
        tabelas = listar_tabelas(conn)
        dados = {}
        total_linhas = 0
        for tabela in tabelas:
            linhas = exportar_tabela(conn, tabela)
            dados[tabela] = linhas
            total_linhas += len(linhas)
        dados["_backup_date"] = datetime.datetime.now().isoformat(timespec="seconds")
    finally:
        conn.close()

    hoje = datetime.date.today().isoformat()
    destino = BACKUP_DIR / f"casa-em-dia-backup-{hoje}.json"
    destino.write_text(
        json.dumps(dados, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    limpar_antigos()
    print(f"[ok] {len(tabelas)} tabela(s), {total_linhas} linha(s) salvas em {destino}")


if __name__ == "__main__":
    fazer_backup()
