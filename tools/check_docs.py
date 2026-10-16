#!/usr/bin/env python3
"""Check local manual links and generated HTML links without network access."""
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Links(HTMLParser):
    """Collect browser navigation/resource targets from a generated document."""
    def __init__(self):
        super().__init__()
        self.targets = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src') and value:
                self.targets.append(value)


def main():
    """Fail on a missing project-local target; external URLs are not fetched."""
    errors = []
    count = 0
    def check(path, target):
        nonlocal count
        parsed = urlsplit(target)
        if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith('/'):
            return
        local = (path.parent / unquote(parsed.path)).resolve()
        count += 1
        if not local.exists():
            errors.append(f'{path.relative_to(ROOT)} -> {target}')
    for path in [ROOT / 'README.md', *sorted((ROOT / 'docs').glob('*.md'))]:
        for target in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', path.read_text()):
            check(path, target)
    for path in sorted((ROOT / 'docs/generated').rglob('*.html')):
        parser = Links()
        parser.feed(path.read_text())
        for target in parser.targets:
            check(path, target)
    if errors:
        raise SystemExit('Missing documentation targets:\n' + '\n'.join(errors))
    print(f'{count} local documentation links verified; no network requests.')


if __name__ == '__main__':
    main()
