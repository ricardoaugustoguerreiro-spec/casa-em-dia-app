# -*- coding: utf-8 -*-
"""Gera harness/index.html a partir do index.html real.

O harness serve para conferir as telas internas (Painel, Financeiro, Calendario,
Ajustes) sem entrar na conta de verdade: um import map troca o cliente Supabase
por um dublê em memória. O HTML nunca é editado à mão -- sempre regerado, para
não divergir do app.
"""
import io
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

IMPORTMAP = """<base href="/" />
<script type="importmap">
{
  "imports": {
    "http://localhost:5533/js/supabaseClient.js": "/harness/fake-supabase.js",
    "/js/supabaseClient.js": "/harness/fake-supabase.js",
    "./supabaseClient.js": "/harness/fake-supabase.js"
  }
}
</script>
<style>
  /* selo do harness: deixa claro que nao e o app de verdade */
  body::after {
    content: "PREVIEW — dados falsos";
    position: fixed; bottom: 8px; right: 8px; z-index: 60;
    font: 600 11px system-ui; letter-spacing: .02em;
    background: #1B2430; color: #fff; padding: 4px 8px; border-radius: 8px;
    opacity: .82; pointer-events: none;
  }
</style>
"""


def main():
    html = io.open(os.path.join(RAIZ, "index.html"), encoding="utf-8").read()

    # o import map precisa vir antes de qualquer <script type="module">
    marca = '<script src="https://cdn.tailwindcss.com"></script>'
    if marca not in html:
        raise SystemExit("nao achei a tag do Tailwind no index.html")
    html = html.replace(marca, IMPORTMAP + marca, 1)

    # cache-buster: o navegador guarda o modulo antigo e mascara a mudanca
    mtime = int(os.path.getmtime(os.path.join(RAIZ, "js", "app.js")))
    html = html.replace('src="js/app.js"', 'src="/js/app.js?v=%d"' % mtime)

    # o service worker do PWA atrapalha o preview
    html = re.sub(r"navigator\.serviceWorker\.register\(", "void (", html)

    destino = os.path.join(AQUI, "index.html")
    io.open(destino, "w", encoding="utf-8").write(html)
    print("gerado:", destino, len(html), "bytes")


if __name__ == "__main__":
    main()
