"""Integrity tests for small, reviewable packaged catalogue corrections; no HTTP."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from catalogue import encoded, load_catalogue


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'routes.json'
        self.path.write_bytes(encoded([{'name': 'original'}]))
        self.path.with_suffix('.patches').mkdir()

    def tearDown(self): self.temp.cleanup()

    def prepare(self, patches, result):
        entries = []
        for number, patch in enumerate(patches):
            name = f'{number:03d}.json'; raw = encoded(patch)
            (self.path.with_suffix('.patches') / name).write_bytes(raw)
            entries.append({'file': name, 'sha256': hashlib.sha256(raw).hexdigest()})
        index = {'schemaVersion': 1, 'baselineSha256': hashlib.sha256(self.path.read_bytes()).hexdigest(),
                 'catalogueSha256': hashlib.sha256(encoded(result)).hexdigest(),
                 'documentCount': len(result), 'entries': entries}
        self.path.with_suffix('.patch-index.json').write_bytes(encoded(index))
        return index

    def test_plain_and_checked_replacement_and_addition(self):
        self.assertEqual(load_catalogue(self.path), [{'name': 'original'}])
        result = [{'name': 'corrected'}, {'name': 'new'}]
        self.prepare([{'index': 0, 'document': result[0]}, {'index': 1, 'document': result[1]}], result)
        self.assertEqual(load_catalogue(self.path), result)

    def test_baseline_and_correction_corruption_are_rejected(self):
        self.prepare([{'index': 0, 'document': {'name': 'corrected'}}], [{'name': 'corrected'}])
        self.path.write_bytes(encoded([{'name': 'different'}]))
        with self.assertRaisesRegex(ValueError, 'baseline'): load_catalogue(self.path)
        self.path.write_bytes(encoded([{'name': 'original'}]))
        (self.path.with_suffix('.patches') / '000.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'correction checksum'): load_catalogue(self.path)

    def test_duplicate_and_noncontiguous_indices_are_rejected(self):
        for patches in [[{'index': 0, 'document': {}}, {'index': 0, 'document': {}}],
                        [{'index': 2, 'document': {}}], [{'index': True, 'document': {}}]]:
            self.prepare(patches, [{}])
            with self.assertRaises(ValueError): load_catalogue(self.path)

    def test_paths_and_complete_result_are_checked(self):
        index = self.prepare([{'index': 0, 'document': {}}], [{'name': 'wrong result'}])
        with self.assertRaisesRegex(ValueError, 'Composed'): load_catalogue(self.path)
        index['entries'][0]['file'] = '../outside.json'
        self.path.with_suffix('.patch-index.json').write_bytes(encoded(index))
        with self.assertRaisesRegex(ValueError, 'filename'): load_catalogue(self.path)

    def test_packaged_result_preserves_exact_prepared_bytes(self):
        path = Path(__file__).resolve().parents[1] / 'data/gtt-urban-drafts.json'
        docs = load_catalogue(path)
        self.assertEqual(len(docs), 633)
        audit = json.loads((path.parent / 'gtfs-projection-audit.json').read_text())
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), audit['previousCatalogueSha256'])
        self.assertEqual(len(json.loads(path.read_bytes())), 602)


if __name__ == '__main__': unittest.main()
