#!/usr/bin/env python3
"""Build an offline reference from Python AST docstrings without importing/running workers."""
import ast
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ['import_routes.py', 'catalogue.py', 'sync_gtfs.py', 'extract_depot_reference.py', 'verify_gtt_web.py']


def describe(node, source):
    """Collect one function/class signature, source line and its real docstring."""
    item = {'name': node.name, 'line': node.lineno, 'docstring': ast.get_docstring(node) or ''}
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        item['signature'] = 'def ' + node.name + '(' + ast.unparse(node.args) + ')'
    else:
        item['signature'] = 'class ' + node.name
        item['methods'] = [describe(child, source) for child in node.body if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))]
    return item


def main():
    """Emit Markdown, HTML and JSON under docs/generated/tools with project-relative sources."""
    output = ROOT / 'docs/generated/tools'
    output.mkdir(parents=True, exist_ok=True)
    modules = []
    for filename in MODULES:
        source = (ROOT / 'tools' / filename).read_text()
        tree = ast.parse(source)
        modules.append({'source': 'tools/' + filename, 'docstring': ast.get_docstring(tree) or '',
                        'members': [describe(node, source) for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]})
    markdown = '# Python tools reference\n\nGenerated from AST/docstrings without executing source imports.\n\n'
    for module in modules:
        markdown += '## ' + module['source'] + '\n\n' + module['docstring'] + '\n\n'
        for member in module['members']:
            markdown += '### ' + member['signature'] + '\n\n' + member['docstring'] + '\n\n'
            for method in member.get('methods', []):
                markdown += '#### ' + method['signature'] + '\n\n' + method['docstring'] + '\n\n'
    (output / 'reference.md').write_text(markdown)
    (output / 'reference.json').write_text(json.dumps(modules, ensure_ascii=False, indent=2) + '\n')
    (output / 'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GTT Trainer · Python reference</title><style>body{font:16px system-ui;max-width:1050px;margin:40px auto;padding:0 22px;color:#21344b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5fa;padding:20px;line-height:1.6}a{color:#205ac8}</style><a href="../index.html">All references</a><h1>Python tools reference</h1><pre>' + html.escape(markdown) + '</pre>')
    print(f'{len(modules)} Python modules documented without executing workers.')


if __name__ == '__main__':
    main()
