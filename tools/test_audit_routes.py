"""Candidate classification must preserve line, order, stop memberships and private context."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from audit_routes import audit_gtfs, audit_movements, geometry_separation, private_output
from catalogue import load_catalogue


def variant(key='a', line='T'):
    """Synthetic fixed route; source identifiers deliberately differ from operational content."""
    return {'key': 'gtt:' + key * 64, 'route': 'route-' + key, 'shape': 'shape-' + key, 'direction': '1',
            'stopIds': ['A', 'B'], 'document': {'line': line, 'name': 'Source ' + key, 'kind': 'service',
            'direction': 'none', 'geometry': {'type': 'LineString', 'coordinates': [[7.6, 45], [7.61, 45]]},
            'stops': [{'id': 'canonical-A', 'code': 'A', 'coordinates': [7.6, 45], 'offsetM': 0,
                       'exchange': False, 'exchangeDirection': None, 'notes': ''}],
            'instructions': [], 'notes': 'Source identity ' + key}}


class AuditTests(unittest.TestCase):
    def test_source_ids_do_not_create_unique_paths_and_input_is_never_changed(self):
        entries = [variant(), variant('b')]
        before = copy.deepcopy(entries)
        report = audit_gtfs(entries)
        self.assertEqual(report['counts']['sameLineExactGroups'], 1)
        self.assertEqual(report['counts']['sameLinePathStopGroups'], 1)
        self.assertEqual(report['groups'][0]['editorialDifferences'], ['notes'])
        self.assertEqual(entries, before)

    def test_shared_geometry_between_lines_is_separate_from_redundant_records(self):
        report = audit_gtfs([variant(), variant('b', 'S')])
        self.assertEqual(report['counts']['sameLineExactGroups'], 0)
        self.assertEqual(report['counts']['crossLineSharedGroups'], 1)
        self.assertEqual(report['counts']['sameLinePathStopGroups'], 2)

    def test_reverse_order_repeated_stops_exchange_direction_and_notes_are_significant(self):
        for change in ('reverse', 'stops', 'exchange', 'notes', 'sourceDirection'):
            a, b = variant(), variant('b')
            if change == 'reverse': b['document']['geometry']['coordinates'].reverse()
            if change == 'stops': b['stopIds'].append('A')
            if change == 'exchange': b['document']['stops'][0].update(exchange=True, exchangeDirection='andata')
            if change == 'notes': b['document']['stops'][0]['notes'] = 'Operational condition'
            if change == 'sourceDirection': b['direction'] = '0'
            self.assertEqual(audit_gtfs([a, b])['counts']['sameLineExactGroups'], 0, change)

    def test_resampled_shapes_are_candidates_only_and_reordered_loops_are_not_equal(self):
        a, b = variant(), variant('b')
        b['document']['geometry']['coordinates'].insert(1, [7.605, 45])
        b['document']['stops'][0]['offsetM'] = .01
        report = audit_gtfs([a, b])
        self.assertEqual(report['counts']['sameLineExactGroups'], 0)
        self.assertEqual(report['counts']['nearGeometryPairs'], 1)
        self.assertLess(report['nearGeometryPairs'][0]['maxSeparationM'], .01)
        first = {'coordinates': [[7.6, 45], [7.61, 45], [7.61, 45.01], [7.6, 45], [7.62, 45]]}
        second = {'coordinates': [[7.6, 45], [7.61, 45.01], [7.61, 45], [7.6, 45], [7.62, 45]]}
        self.assertIsNone(geometry_separation(first, second))

    def test_private_matching_streets_do_not_hide_conditions_or_publish_text(self):
        a = {'id': 'A', 'sourceRefId': 'block-A', 'lineLabel': 'T', 'movement': 'out',
             'depot': 'Private depot', 'title': 'Private heading', 'sourceText': 'Private literal',
             'streetSequence': ['Private street'], 'sourceContext': 'Only at night'}
        b = {**a, 'id': 'B', 'sourceRefId': 'block-B'}
        c = {**a, 'id': 'C', 'sourceContext': 'Daytime restriction'}
        report = audit_movements([a, b, c])
        self.assertEqual(report['counts']['repeatedTextRecords'], 1)
        self.assertEqual(report['counts']['sharedStreetPlanGroups'], 1)
        self.assertNotIn('Private', json.dumps(report))
        self.assertFalse(report['geometryCompared'])

    def test_private_reports_refuse_public_project_paths(self):
        root = Path(__file__).resolve().parents[1]
        for path in (root / 'data/report.json', root / 'web/public/report.json'):
            with self.assertRaisesRegex(ValueError, 'private runtime'): private_output(path)
        private_output(root / 'server/var/report.json')
        with tempfile.TemporaryDirectory() as temp: private_output(Path(temp) / 'report.json')

    def test_approximate_budget_keeps_exact_audit_complete_and_reports_the_limit(self):
        entries = [variant(), variant('b'), variant('c')]
        entries[1]['document']['geometry']['coordinates'].insert(1, [7.605, 45])
        entries[2]['document']['geometry']['coordinates'].insert(1, [7.606, 45])
        with patch('audit_routes.MAX_NEAR_COMPARISONS', 1): report = audit_gtfs(entries)
        self.assertFalse(report['nearGeometryComplete'])
        self.assertEqual(report['counts']['sourceRecords'], 3)
        self.assertEqual(report['counts']['sameLinePathStopGroups'], 3)
        self.assertEqual(len(report['nearGeometryPairs']), 1)

    def test_packaged_catalogue_has_three_same_line_pairs_and_six_cross_line_pairs(self):
        root = Path(__file__).resolve().parents[1]
        docs = load_catalogue(root / 'data/gtt-urban-drafts.json')
        identities = json.loads((root / 'data/gtt-urban-drafts.manifest.json').read_text())['variants']
        report = audit_gtfs([{**identity, 'document': doc} for identity, doc in zip(identities, docs, strict=True)])
        self.assertEqual(report, json.loads((root / 'data/gtfs-duplicate-audit.json').read_text()))
        self.assertEqual(report['counts'], {'sourceRecords': 633, 'lineCodes': 137, 'exactPathStopGroups': 624,
            'sameLinePathStopGroups': 630, 'sameLineExactGroups': 3, 'redundantSameLineRecords': 3,
            'crossLineSharedGroups': 6, 'nearGeometryPairs': 0, 'samePathDifferentStopsGroups': 0})


if __name__ == '__main__': unittest.main()
