"""
Sincroniza pagamentos recebidos no Sistema de Joias (Alfa 3D) pra dentro do
Casa em Dia, como renda real do mês — sem precisar lançar manualmente.

Fonte: H:\\Meu Drive\\Claud Sistema\\ARQUIVOS\\backups\\auto\\backup_auto.json
  (já gerado automaticamente pelo próprio Sistema Joias a cada poucas horas —
  este script só LÊ esse arquivo, nunca escreve nada no Sistema Joias)
Destino: tabela public.transactions do Casa em Dia, kind='renda',
  source='sistema_joias', com raw->>'cobranca_id' guardando o id da cobrança
  pra nunca duplicar (upsert por esse campo, via índice único — ver
  supabase/migration_renda_joias.sql).

Regra: só cobranças com status == 'recebido' E dataRecebimento preenchida
entram como renda (cobrança "emitida" mas ainda não paga não conta).

Se você editar manualmente um desses lançamentos dentro do app (campo
`edited` vira true), este script NUNCA mais sobrescreve esse lançamento —
só atualiza os que ele mesmo criou e ainda não foram tocados.

Uso:
    python scripts/sync_renda_joias.py
"""
import json
import re
from pathlib import Path

import pg8000.native

APP_DIR = Path(__file__).resolve().parent.parent
SECFILE = APP_DIR / "_segredos-nao-compartilhar" / "supabase.txt"
BACKUP_JOIAS = Path(r"H:\Meu Drive\Claud Sistema\ARQUIVOS\backups\auto\backup_auto.json")


def ler_senha_banco():
    texto = SECFILE.read_text(encoding="utf-8")
    m = re.search(r"Senha do banco \(Postgres\)[^\n]*\n(.+)", texto)
    if not m:
        raise RuntimeError(f"Não encontrei a senha do banco em {SECFILE}")
    return m.group(1).strip()


def sincronizar():
    if not BACKUP_JOIAS.exists():
        print(f"[erro] backup do Sistema Joias não encontrado em {BACKUP_JOIAS}")
        return

    with BACKUP_JOIAS.open(encoding="utf-8") as f:
        dados = json.load(f)
    cobrancas = [c for c in dados.get("cobrancas", []) if c.get("status") == "recebido" and c.get("dataRecebimento")]
    print(f"[info] {len(cobrancas)} cobrança(s) recebida(s) no backup ({dados.get('savedAt', '?')}).")

    senha = ler_senha_banco()
    conn = pg8000.native.Connection(
        user="postgres", password=senha,
        host="db.aynteobslozppsjxgheo.supabase.co", port=5432, database="postgres",
        ssl_context=True,
    )
    novos, atualizados, ignorados = 0, 0, 0
    try:
        for c in cobrancas:
            existente = conn.run(
                "select id, edited from transactions where raw->>'cobranca_id' = :cid",
                cid=c["id"],
            )
            descricao = f"Joias - {c.get('cliente') or 'cliente'}"
            if not existente:
                conn.run(
                    """
                    insert into transactions (date, description, amount, kind, source, raw)
                    values (:data, :descricao, :valor, 'renda', 'sistema_joias', :raw)
                    """,
                    data=c["dataRecebimento"], descricao=descricao, valor=c["total"],
                    raw=json.dumps({"cobranca_id": c["id"], "cliente": c.get("cliente")}),
                )
                novos += 1
            elif not existente[0][1]:  # edited == False
                conn.run(
                    "update transactions set date = :data, description = :descricao, amount = :valor where id = :id",
                    data=c["dataRecebimento"], descricao=descricao, valor=c["total"], id=existente[0][0],
                )
                atualizados += 1
            else:
                ignorados += 1
        print(f"[ok] {novos} novo(s), {atualizados} atualizado(s), {ignorados} ignorado(s) (editado manualmente no app).")
    finally:
        conn.close()


if __name__ == "__main__":
    sincronizar()
