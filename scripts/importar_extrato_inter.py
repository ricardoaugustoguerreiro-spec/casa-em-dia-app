"""
JÁ EXECUTADO em 22/06/2026 pro período 01/01-21/06/2026 (107 transações inseridas,
source='extrato_inter'). Rodar de novo SÓ pra um extrato novo/período diferente —
não tem proteção contra duplicar se rodar de novo pro mesmo arquivo (sem unique key).

Importa o extrato do Inter (conta MEI do Ricardo) pro Supabase, classificando cada linha:
  - Transferência interna (Ricardo <-> Jéssica, mesma pessoa entre contas): marca
    transferencia_interna=true, não conta em Renda/Gasto líquidos.
  - Já coberto por bill_payments (contas fixas/cartão que já existem no sistema): pula,
    pra não duplicar gasto.
  - Resto: credito = renda (kind='renda'), débito = gasto (kind='variavel').
Todas as linhas vão pra account='Inter' (já é oculto pra Jéssica via RLS, igual o resto
do MEI do Ricardo).

Uso: python3 scripts/importar_extrato_inter.py [--dry-run]
"""
import csv
import re
import sys
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = BASE_DIR.parent / "Documentos-Bancarios-Origem" / "Extrato-01-01-2026-a-21-06-2026-CSV.csv"
SECFILE = BASE_DIR / "_segredos-nao-compartilhar" / "supabase.txt"

NOMES_INTERNOS = [
    "jessica christine cabral santana fonseca",
    "ricardo augusto g fonseca",
    "ricardo augusto guerreiro fonseca",
]

JA_COBERTO_POR_BILL_PAYMENTS = [
    "gci caixa", "financeira itau cbd", "financeira itaú cbd", "cpfl paulista",
    "via fibra", "semae", "prefeitura municipal de sao jose do rio preto",
    "estado de minas gerais", "receita federal", "simples nacional", "portoseg",
    "julia aparecida da silva",  # = parcela do Carro (R$850, sempre dia 25) já em bill_payments
]


def normalizar(s):
    return re.sub(r"\s+", " ", s.strip().lower())


def carregar_config():
    secs = SECFILE.read_text(encoding="utf-8")
    url = re.search(r"Project URL:\s*(\S+)", secs).group(1)
    key = re.search(r"Service_role key.*?:\s*\n?(\S+)", secs, re.S).group(1)
    return url.rstrip("/"), key


def parse_valor(s):
    return float(s.replace(".", "").replace(",", "."))


def main():
    dry_run = "--dry-run" in sys.argv
    url, key = carregar_config()

    linhas = []
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        texto = f.read()
    inicio = texto.find("Data Lançamento")
    leitor = csv.reader(texto[inicio:].splitlines(), delimiter=";")
    next(leitor)  # cabeçalho
    for row in leitor:
        if len(row) < 4 or not row[0].strip():
            continue
        data_str, historico, descricao, valor_str = row[0], row[1], row[2], row[3]
        dia, mes, ano = data_str.split("/")
        data_iso = f"{ano}-{mes}-{dia}"
        valor = parse_valor(valor_str)
        linhas.append({"data": data_iso, "historico": historico.strip(), "descricao": descricao.strip(), "valor": valor})

    internas, cobertas, renda, gasto = [], [], [], []
    for l in linhas:
        desc_norm = normalizar(l["descricao"])
        if any(n in desc_norm for n in NOMES_INTERNOS):
            internas.append(l)
        elif any(n in desc_norm for n in JA_COBERTO_POR_BILL_PAYMENTS):
            cobertas.append(l)
        elif l["valor"] > 0:
            renda.append(l)
        else:
            gasto.append(l)

    print(f"Total de linhas: {len(linhas)}")
    print(f"  Transferências internas (Ricardo<->Jéssica): {len(internas)} | soma líquida: {sum(l['valor'] for l in internas):.2f}")
    print(f"  Já cobertas por bill_payments (puladas): {len(cobertas)}")
    print(f"  Renda nova (créditos externos): {len(renda)} | total: {sum(l['valor'] for l in renda):.2f}")
    print(f"  Gasto novo (débitos externos): {len(gasto)} | total: {sum(l['valor'] for l in gasto):.2f}")

    if dry_run:
        print("\n--dry-run: nada foi gravado. Linhas de renda nova:")
        for l in renda:
            print(f"  {l['data']}  {l['descricao']:<45}  R$ {l['valor']:.2f}")
        print("\nLinhas de gasto novo:")
        for l in gasto:
            print(f"  {l['data']}  {l['descricao']:<45}  R$ {l['valor']:.2f}")
        print("\nTransferências internas:")
        for l in internas:
            print(f"  {l['data']}  {l['historico']:<20} {l['descricao']:<45}  R$ {l['valor']:.2f}")
        return

    payloads = []
    for l in internas:
        payloads.append({
            "date": l["data"], "description": l["historico"] + " - " + l["descricao"], "amount": abs(l["valor"]),
            "account": "Inter", "kind": "variavel", "source": "extrato_inter", "transferencia_interna": True,
            "raw": {"origem": "extrato_inter_2026", "valor_original": l["valor"]},
        })
    for l in renda:
        payloads.append({
            "date": l["data"], "description": l["descricao"], "amount": l["valor"],
            "account": "Inter", "kind": "renda", "source": "extrato_inter",
            "raw": {"origem": "extrato_inter_2026"},
        })
    for l in gasto:
        payloads.append({
            "date": l["data"], "description": l["historico"] + " - " + l["descricao"], "amount": abs(l["valor"]),
            "account": "Inter", "kind": "variavel", "source": "extrato_inter",
            "raw": {"origem": "extrato_inter_2026"},
        })

    r = requests.post(
        f"{url}/rest/v1/transactions",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=payloads,
        timeout=30,
    )
    r.raise_for_status()
    print(f"\n{len(payloads)} transações inseridas com sucesso.")


if __name__ == "__main__":
    main()
