#!/usr/bin/env python3
"""Compare fixed-source stop sequences against official GTT route pages.

Read-only evidence, not a publishing/routing tool. Per-page HTTP attempts are cached
for at least 24 hours and bounded by a process lock. Source snapshots remain fixed;
changed web facts are reported explicitly and never replace route geometry.
"""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import Request, build_opener

from sync_gtfs import OfficialRedirects, atomic_json, parse_stamp, read_json, stamp
from catalogue import load_catalogue

ROOT = Path(__file__).resolve().parents[1]


class StopTable(HTMLParser):
    """Read only the factual official stop table, preserving repeated stop codes/order."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table': self.table = []
        elif tag == 'tr' and self.table is not None: self.row = []
        elif tag in ('td', 'th') and self.row is not None: self.cell = []

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(' '.join(self.cell).split())); self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table.append(self.row); self.row = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table); self.table = None

    def handle_data(self, value):
        if self.cell is not None: self.cell.append(value)

    def codes(self):
        """Require the official stop headers; a generic/error page cannot be a match."""
        for table in self.tables:
            if table and len(table[0]) >= 3 and table[0][0] == 'Fermata' and 'Nome fermata' in table[0]:
                rows = table[1:]
                if rows and all(len(row) >= 3 and re.fullmatch(r'[0-9]{1,6}', row[0]) for row in rows):
                    return [row[0] for row in rows]
        raise ValueError('Official stop table absent or ambiguous')


def official_url(identity, line):
    """Translate explicit source shape identifiers into GTT's own route-page parameters."""
    prefix = identity['route']
    shape = identity['shape']
    tail = shape[len(prefix):] if shape.startswith(prefix) else ''
    if not re.fullmatch(r'(As|Di)[A-Za-z0-9_-]{1,80}', tail):
        raise ValueError('Unrecognized official source shape identifier')
    return 'https://www.gtt.to.it/cms/percorari/urbano?' + urlencode({
        'bacino': 'U', 'linea': identity.get('officialLineCode', line), 'percorso': tail[2:], 'verso': tail[:2], 'view': 'percorso'})


def verify_page(url, expected, directory, now=None, fetch=None):
    """Reserve one page attempt before HTTP; return current or cached comparison facts."""
    now = now or datetime.now(timezone.utc)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    with (directory / 'web.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cached = read_json(path)
        if cached and parse_stamp(cached['attemptedAt']) + timedelta(hours=24) > now:
            result = cached
        else:
            result = {'url': url, 'attemptedAt': stamp(now), 'status': 'unavailable'}
            atomic_json(path, result)
            try:
                if fetch:
                    raw = fetch(url)
                else:
                    request = Request(url, headers={'User-Agent': 'GTT-Trainer/0.4 educational source verification', 'Accept': 'text/html'})
                    with build_opener(OfficialRedirects()).open(request, timeout=20) as response:
                        if response.headers.get_content_type() != 'text/html': raise ValueError('Unexpected content type')
                        raw = response.read(2097153)
                if len(raw) > 2097152: raise ValueError('Official page exceeds 2 MiB limit')
                table = StopTable(); table.feed(raw.decode('utf-8'))
                codes = table.codes()
                result.update(status='available', htmlSha256=hashlib.sha256(raw).hexdigest(), stopCodes=codes,
                              stopSequenceSha256=hashlib.sha256(json.dumps(codes,separators=(',',':')).encode()).hexdigest())
            except Exception as error:
                result['failureType'] = type(error).__name__
            atomic_json(path, result)
    actual = result.get('stopCodes')
    return {**result, 'comparison': 'unavailable' if actual is None else 'exact_match' if actual == expected else 'different',
            'expectedStopCount': len(expected), 'actualStopCount': len(actual) if actual is not None else None,
            'onlyFeedCodes': [code for code in expected if code not in (actual or [])],
            'onlyWebCodes': [code for code in (actual or []) if code not in expected]}


def main():
    """Audit recovered variants by default, capped at 64 pages and cached independently of GTFS."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', type=Path, default=ROOT/'data/gtt-urban-drafts.json')
    parser.add_argument('--cache-dir', type=Path, default=ROOT/'server/var/gtt-web-evidence')
    parser.add_argument('--output', type=Path, default=ROOT/'data/gtt-web-audit.json')
    parser.add_argument('--limit', type=int, default=32)
    args = parser.parse_args()
    if not 1 <= args.limit <= 64: parser.error('limit must be between 1 and 64')
    manifest = read_json(args.catalogue.with_suffix('.manifest.json'))
    docs = load_catalogue(args.catalogue)
    evidence = []
    for identity, doc in zip(manifest['variants'], docs, strict=True):
        if 'projectionRecovery' not in identity: continue
        if len(evidence) >= args.limit: break
        url = official_url(identity, doc['line'])
        result = verify_page(url, [stop['code'] for stop in doc['stops']], args.cache_dir)
        evidence.append({'key': identity['key'], 'route': identity['route'], 'shape': identity['shape'], **result})
        print(json.dumps({'shape': identity['shape'], 'comparison': result['comparison'], 'stops': result['actualStopCount']}), flush=True)
    report = {'schemaVersion': 1, 'archiveSha256': manifest['sha256'], 'evidence': evidence,
              'summary': {state: sum(e['comparison'] == state for e in evidence) for state in ['exact_match','different','unavailable']}}
    atomic_json(args.output, report)
    print(json.dumps(report['summary']))


if __name__ == '__main__': main()
