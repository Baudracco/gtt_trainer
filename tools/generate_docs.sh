#!/bin/sh
# Run from any directory; generated references are reproducible build artifacts.
set -eu
GTT_PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$GTT_PROJECT_ROOT"
"${PHP_BINARY:-php}" tools/generate_php_docs.php
python3 tools/generate_python_docs.py
npm --prefix web run docs
python3 - <<'PYDOC'
from pathlib import Path
Path('docs/generated/index.html').write_text("""<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GTT Trainer · Referencias del código</title><style>body{font:18px system-ui;max-width:850px;margin:60px auto;padding:0 24px;color:#21344b}li{margin:20px 0}a{color:#205ac8}</style><h1>Referencias del código</h1><p>Generadas desde DocBlocks, JSDoc y docstrings reales. Consultar docs/README.md para los manuales de usuario, arquitectura y operación.</p><ul><li><a href="php/index.html">PHP: servicios, repositorios y contratos</a></li><li><a href="typescript/index.html">TypeScript: modelos, GPS, geometría, API y reproducción</a></li><li><a href="tools/index.html">Python: importación, sincronización y extracción de fuentes</a></li></ul>""")
PYDOC
printf '%s\n' 'Generated documentation: docs/generated/index.html'
