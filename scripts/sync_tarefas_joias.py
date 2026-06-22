"""
Sincroniza trabalhos/serviços em aberto do Sistema de Joias (Alfa 3D) pra dentro
do Casa em Dia, pra alimentar o Painel de Tarefas e os marcadores no calendário.

Fonte: H:\\Meu Drive\\Claud Sistema\\ARQUIVOS\\backups\\auto\\backup_auto.json
  (já gerado automaticamente pelo próprio Sistema Joias a cada poucas horas —
  este script só LÊ esse arquivo, nunca escreve nada no Sistema Joias)
Destino: tabela public.tarefas_joias no Supabase do Casa em Dia (via service_role,
  então ignora RLS — só este script tem permissão de escrita direta nessa tabela)

Regra: todo projeto com status != 'Finalizado' é "trabalho em aberto" e entra/atualiza
em tarefas_joias, COM ou SEM prazo definido (prazo fica null se o projeto não tiver um).
Projeto que passou a 'Finalizado' tem o status atualizado pra 'concluido' aqui também
(não é removido, fica no histórico, mas para de contar como pendência aberta).

Uso:
    python scripts/sync_tarefas_joias.py
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


def projetos_para_tarefas(projetos):
    tarefas = []
    for p in projetos:
        titulo_partes = [p.get("cliente") or "", p.get("tipo") or ""]
        if p.get("cod3d"):
            titulo_partes.append(f"({p['cod3d']})")
        titulo = " ".join(t for t in titulo_partes if t).strip() or p.get("nome") or "Projeto sem nome"
        status = "concluido" if p.get("status") == "Finalizado" else "aberto"
        prazo = p.get("prazo") or None
        tarefas.append({
            "id": p["id"],
            "titulo": titulo,
            "cliente": p.get("cliente") or None,
            "prazo": prazo,
            "status": status,
        })
    return tarefas


def sincronizar():
    if not BACKUP_JOIAS.exists():
        print(f"[erro] backup do Sistema Joias não encontrado em {BACKUP_JOIAS}")
        return

    with BACKUP_JOIAS.open(encoding="utf-8") as f:
        dados = json.load(f)
    projetos = dados.get("projects", [])
    tarefas = projetos_para_tarefas(projetos)
    print(f"[info] {len(projetos)} projetos lidos do backup ({dados.get('savedAt', '?')}); "
          f"{sum(1 for t in tarefas if t['status'] == 'aberto')} em aberto.")

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
        for t in tarefas:
            conn.run(
                """
                insert into public.tarefas_joias (id, titulo, cliente, prazo, status, origem)
                values (:id, :titulo, :cliente, :prazo, :status, 'sistema_joias')
                on conflict (id) do update set
                    titulo = excluded.titulo,
                    cliente = excluded.cliente,
                    prazo = excluded.prazo,
                    status = excluded.status,
                    updated_at = now()
                """,
                id=t["id"], titulo=t["titulo"], cliente=t["cliente"], prazo=t["prazo"], status=t["status"],
            )
        print(f"[ok] {len(tarefas)} tarefa(s) sincronizada(s) em tarefas_joias.")
    finally:
        conn.close()


if __name__ == "__main__":
    sincronizar()
