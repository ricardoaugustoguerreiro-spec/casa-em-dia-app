"""
Importa os extratos Nubank da Jéssica (conta 71582461, Jan-Jun/2026) pro Supabase,
classificando cada linha:
  - Transferência interna (Ricardo -> Jéssica ou ela mesma entre contas): marca
    transferencia_interna=true, não conta em Renda/Gasto líquidos.
  - "Resgate RDB"/aplicação: ignora — é dinheiro dela mesma mudando de lugar
    (investimento -> conta corrente), não é renda nova.
  - Resto: crédito = renda (kind='renda', pessoa='jessica'), débito = gasto
    (kind='variavel', sem pessoa — gasto é sempre conjunto do casal).

Uso:
    python scripts/importar_extrato_nubank_jessica.py --dry-run
    python scripts/importar_extrato_nubank_jessica.py
"""
import csv
import glob
import re
import sys
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
CSV_DIR = BASE_DIR.parent / "Documentos-Bancarios-Origem"
SECFILE = BASE_DIR / "_segredos-nao-compartilhar" / "supabase.txt"

NOMES_INTERNOS = ["ricardo augusto guerreir", "ricardo augusto g fonseca", "jessica christine cabral santana fon"]
IGNORAR = ["resgate rdb", "aplicação rdb", "aplicacao rdb"]


def normalizar(s):
    return re.sub(r"\s+", " ", s.strip().lower())


def carregar_config():
    secs = SECFILE.read_text(encoding="utf-8")
    url = re.search(r"Project URL:\s*(\S+)", secs).group(1)
    key = re.search(r"Service_role key.*?:\s*\n?(\S+)", secs, re.S).group(1)
    return url.rstrip("/"), key


def main():
    dry_run = "--dry-run" in sys.argv
    linhas = []
    for fname in sorted(glob.glob(str(CSV_DIR / "NU_71582461_*.csv"))):
        with open(fname, encoding="utf-8-sig") as f:
            leitor = csv.reader(f)
            next(leitor)
            for row in leitor:
                if len(row) < 4 or not row[0].strip():
                    continue
                dia, mes, ano = row[0].split("/")
                linhas.append({"data": f"{ano}-{mes}-{dia}", "descricao": row[3].strip(), "valor": float(row[1])})

    internas, ignoradas, renda, gasto = [], [], [], []
    for l in linhas:
        desc_norm = normalizar(l["descricao"])
        if any(n in desc_norm for n in IGNORAR):
            ignoradas.append(l)
        elif any(n in desc_norm for n in NOMES_INTERNOS):
            internas.append(l)
        elif l["valor"] > 0:
            renda.append(l)
        else:
            gasto.append(l)

    print(f"Total de linhas: {len(linhas)}")
    print(f"  Ignoradas (resgate de aplicação, não é renda nova): {len(ignoradas)} | soma: {sum(l['valor'] for l in ignoradas):.2f}")
    print(f"  Transferências internas (Ricardo->Jéssica ou dela mesma): {len(internas)} | soma: {sum(l['valor'] for l in internas):.2f}")
    print(f"  Renda nova (créditos externos): {len(renda)} | total: {sum(l['valor'] for l in renda):.2f}")
    print(f"  Gasto novo (débitos externos): {len(gasto)} | total: {sum(l['valor'] for l in gasto):.2f}")

    if dry_run:
        print("\n--dry-run: nada foi gravado. Linhas de renda nova:")
        for l in renda:
            print(f"  {l['data']}  {l['descricao'][:70]:<70}  R$ {l['valor']:.2f}")
        return

    url, key = carregar_config()
    payloads = []
    for l in internas:
        payloads.append({
            "date": l["data"], "description": l["descricao"], "amount": abs(l["valor"]),
            "account": "Nubank Jéssica", "kind": "variavel", "pessoa": None, "source": "extrato_nubank_jessica",
            "transferencia_interna": True, "raw": {"origem": "extrato_nubank_jessica_2026"},
        })
    for l in renda:
        payloads.append({
            "date": l["data"], "description": l["descricao"], "amount": l["valor"],
            "account": "Nubank Jéssica", "kind": "renda", "pessoa": "jessica", "source": "extrato_nubank_jessica",
            "transferencia_interna": False, "raw": {"origem": "extrato_nubank_jessica_2026"},
        })
    for l in gasto:
        payloads.append({
            "date": l["data"], "description": l["descricao"], "amount": abs(l["valor"]),
            "account": "Nubank Jéssica", "kind": "variavel", "pessoa": None, "source": "extrato_nubank_jessica",
            "transferencia_interna": False, "raw": {"origem": "extrato_nubank_jessica_2026"},
        })

    r = requests.post(
        f"{url}/rest/v1/transactions",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"},
        json=payloads, timeout=30,
    )
    if r.status_code >= 400:
        print(f"\n[erro {r.status_code}] {r.text}")
        return
    print(f"\n{len(payloads)} transações inseridas com sucesso.")


if __name__ == "__main__":
    main()
