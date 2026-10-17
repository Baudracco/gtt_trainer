"""Deterministic official-page evidence tests; no live HTTP requests."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import json
import unittest

from verify_gtt_web import StopTable, official_url, verify_page

HTML=b'<table><tr><th>Fermata</th><th>Nome fermata</th><th>Ubicazione fermata</th></tr><tr><td>10</td><td>A</td><td>Street A</td></tr><tr><td>11</td><td>B</td><td>Street B</td></tr><tr><td>10</td><td>A</td><td>Street A</td></tr></table>'


class VerificationTests(unittest.TestCase):
    def test_repeated_stops_remain_ordered_and_generic_pages_are_rejected(self):
        parser=StopTable();parser.feed(HTML.decode());self.assertEqual(parser.codes(),['10','11','10'])
        parser=StopTable();parser.feed('<h1>404</h1>')
        with self.assertRaises(ValueError):parser.codes()

    def test_explicit_official_line_code_handles_slash_brand(self):
        url=official_url({'route':'63BU','shape':'63BUDi63BR8','officialLineCode':'63B'},'63/')
        self.assertIn('linea=63B',url);self.assertIn('percorso=63BR8',url)
        with self.assertRaises(ValueError):official_url({'route':'T','shape':'https://evil.invalid'},'T')

    def test_attempt_cache_and_exact_sequence_comparison(self):
        with tempfile.TemporaryDirectory() as folder:
            now=datetime(2026,10,16,tzinfo=timezone.utc);calls=[]
            def fetch(url):calls.append(url);return HTML
            result=verify_page('https://www.gtt.to.it/example',['10','11','10'],Path(folder),now,fetch)
            self.assertEqual(result['comparison'],'exact_match')
            result=verify_page('https://www.gtt.to.it/example',['10','10','11'],Path(folder),now+timedelta(hours=12),fetch)
            self.assertEqual(result['comparison'],'different');self.assertEqual(len(calls),1)
            result=verify_page('https://www.gtt.to.it/example',['10','11','10'],Path(folder),now+timedelta(hours=24),fetch)
            self.assertEqual(result['comparison'],'exact_match');self.assertEqual(len(calls),2)

    def test_failure_is_cached_and_never_mistaken_for_match(self):
        with tempfile.TemporaryDirectory() as folder:
            now=datetime(2026,10,16,tzinfo=timezone.utc);calls=[]
            def fetch(url):calls.append(url);raise TimeoutError()
            result=verify_page('https://www.gtt.to.it/example',[],Path(folder),now,fetch)
            self.assertEqual(result['comparison'],'unavailable')
            verify_page('https://www.gtt.to.it/example',[],Path(folder),now,fetch)
            self.assertEqual(len(calls),1)


    def test_recorded_official_audit_covers_all_rejected_patterns(self):
        root=Path(__file__).resolve().parents[1]
        audit=json.loads((root/'data/gtt-web-audit.json').read_text())
        # An additional line-14 verification may be recorded, but all 31 recovered cases must match.
        recovery=json.loads((root/'data/gtfs-projection-audit.json').read_text())
        exact={item['key'] for item in audit['evidence'] if item['comparison']=='exact_match'}
        self.assertTrue({item['key'] for item in recovery['resolved']} <= exact)
        self.assertEqual(audit['summary']['different'],0)

if __name__=='__main__':unittest.main()
