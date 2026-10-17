import importlib.util
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
import io
import csv
from catalogue import load_catalogue

spec=importlib.util.spec_from_file_location('import_routes',Path(__file__).with_name('import_routes.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ImportTests(unittest.TestCase):
    def test_gtfs_order_direction_and_stop_patterns(self):
        files={
            'routes.txt':[['route_id','route_short_name','route_long_name','route_type'],['T','T','Synthetic','3']],
            'trips.txt':[['trip_id','route_id','shape_id','direction_id','trip_headsign'],['A','T','S','1','End'],['B','T','S','1','End']],
            'shapes.txt':[['shape_id','shape_pt_sequence','shape_pt_lon','shape_pt_lat'],['S','2','7.61','45'],['S','1','7.6','45']],
            'stops.txt':[['stop_id','stop_code','stop_name','stop_lon','stop_lat'],['X','10','X','7.6','45'],['Y','11','Y','7.61','45']],
            'stop_times.txt':[['trip_id','stop_sequence','stop_id'],['A','1','X'],['A','2','Y'],['B','1','Y']],
        }
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'test.zip'
            with zipfile.ZipFile(path,'w') as archive:
                for name,rows in files.items():
                    text=io.StringIO();csv.writer(text).writerows(rows);archive.writestr(name,text.getvalue())
            docs,skipped=module.gtfs(path,{},set(),{'0':'none','1':'none'})
            self.assertEqual(len(docs),2);self.assertEqual(skipped,[])
            self.assertEqual(docs[0]['geometry']['coordinates'],[[7.6,45],[7.61,45]])
            self.assertEqual(docs[0]['direction'],'none')
            self.assertEqual(docs[0]['stops'][1]['id'],docs[1]['stops'][0]['id'])
            self.assertFalse(docs[0]['stops'][0]['exchange'])
    def test_invalid_coordinates(self):
        for lon,lat in [(181,45),(7,91),('nan',45)]:
            with self.assertRaises(ValueError):module.coordinate(lon,lat)
    def test_csv_sequence(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'vertices.csv';path.write_text('route_id,sequence,longitude,latitude,line,name\nA,2,7.61,45,T,Test\nA,1,7.6,45,T,Test\n')
            docs,_=module.tabular(path,{})
            self.assertEqual(docs[0]['geometry']['coordinates'],[[7.6,45],[7.61,45]])
    def test_private_operational_sources_are_not_packaged(self):
        root=Path(__file__).resolve().parents[1]
        for name in ['depot-references.json','depot-movements.json','gerbido-change-posts.json']:
            self.assertFalse((root/'web/public/data'/name).exists())
    def test_official_snapshot_manifest(self):
        root=Path(__file__).resolve().parents[1]
        manifest=json.loads((root/'data/gtt-gerbido-drafts.manifest.json').read_text())
        docs=json.loads((root/'data/gtt-gerbido-drafts.json').read_text())
        self.assertEqual(manifest['routes'],len(docs));self.assertGreater(len(docs),100)
        self.assertEqual(manifest['status'],'draft_only')
        for d in docs:
            self.assertGreaterEqual(len(d['geometry']['coordinates']),2)
            self.assertEqual(sorted(s['offsetM'] for s in d['stops']),[s['offsetM'] for s in d['stops']])
            self.assertEqual(d['direction'],'none')

    def test_full_urban_scope_preserves_initial_variants_and_trams(self):
        root=Path(__file__).resolve().parents[1]
        original=json.loads((root/'data/gtt-gerbido-drafts.manifest.json').read_text())
        manifest=json.loads((root/'data/gtt-urban-drafts.manifest.json').read_text())
        docs=load_catalogue(root/'data/gtt-urban-drafts.json')
        self.assertEqual(manifest['routes'],633)
        self.assertEqual(len(manifest['skipped']),0)
        self.assertEqual(len({d['line'] for d in docs}),137)
        self.assertTrue({v['key'] for v in original['variants']} <= {v['key'] for v in manifest['variants']})
        self.assertTrue({'4U','3U','9U','10U','15U','16CDU','16CSU','13U'} <= {v['route'] for v in manifest['variants']})
        self.assertEqual(manifest['sha256'],original['sha256'])

    def test_ordered_projection_recovers_earlier_traversal_without_changing_shape(self):
        points=[[7.6,45],[7.61,45],[7.61,45.01],[7.6,45.01],[7.6,45.00001],[7.61,45.00001]]
        original=json.dumps(points)
        positions=[[7.605,45.00001],[7.61,45.005]]
        measured=module.offsets(points)
        late=module.project(points,measured,positions[0])
        with self.assertRaises(ValueError):module.project(points,measured,positions[1],late)
        ordered,recovery=module.pattern_offsets(points,positions)
        self.assertLess(ordered[0],1000)
        self.assertLess(ordered[0],ordered[1])
        self.assertLess(recovery['maxDistanceM'],2)
        self.assertEqual(json.dumps(points),original)

    def test_projection_still_rejects_distant_and_impossibly_ordered_stops(self):
        points=[[7.6,45],[7.62,45]]
        for positions in [[[8,46]],[[7.619,45],[7.601,45]]]:
            with self.assertRaises(ValueError):module.ordered_projection(points,positions)

    def test_valid_existing_projection_is_unchanged(self):
        points=[[7.6,45],[7.62,45]];positions=[[7.601,45],[7.61,45]]
        ordered,recovery=module.pattern_offsets(points,positions)
        self.assertIsNone(recovery)
        self.assertEqual(ordered,[module.project(points,module.offsets(points),p) for p in positions])

    def test_recovery_evidence_preserves_geometry_and_records_existing_offset_correction(self):
        root=Path(__file__).resolve().parents[1]
        docs=load_catalogue(root/'data/gtt-urban-drafts.json')
        audit=json.loads((root/'data/gtfs-projection-audit.json').read_text())
        original=json.loads(json.dumps(docs[:audit['previousAcceptedCount']]))
        for correction in audit['existingOffsetCorrections']:
            for stop,along in zip(original[correction['documentIndex']]['stops'],correction['previousOffsetsM'],strict=True):stop['offsetM']=along
        previous=(json.dumps(original,ensure_ascii=False,separators=(',',':'))+'\n').encode()
        self.assertEqual(hashlib.sha256(previous).hexdigest(),audit['previousCatalogueSha256'])
        self.assertEqual(len(audit['resolved']),31)
        self.assertEqual(audit['unresolved'],[])
        self.assertEqual(audit['unchangedAcceptedCount'],601)
        self.assertEqual(len(audit['existingOffsetCorrections']),1)
        self.assertLess(max(r['maxDistanceM'] for r in audit['resolved']),35)
        for entry,doc in zip(audit['resolved'],docs[audit['previousAcceptedCount']:],strict=True):
            geometry_hash=hashlib.sha256(json.dumps(doc['geometry'],separators=(',',':')).encode()).hexdigest()
            self.assertEqual(geometry_hash,entry['shapeSha256'])
            self.assertEqual(len(doc['stops']),len(entry['stopIds']))
            self.assertEqual([s['offsetM'] for s in doc['stops']],sorted(s['offsetM'] for s in doc['stops']))

    def test_global_projection_corrects_a_valid_but_late_greedy_assignment(self):
        root=Path(__file__).resolve().parents[1]
        docs=load_catalogue(root/'data/gtt-urban-drafts.json')
        audit=json.loads((root/'data/gtfs-projection-audit.json').read_text())
        correction=audit['existingOffsetCorrections'][0];doc=docs[correction['documentIndex']]
        result,recovery=module.pattern_offsets(doc['geometry']['coordinates'],[s['coordinates'] for s in doc['stops']])
        self.assertIsNotNone(recovery)
        self.assertEqual(result,correction['correctedOffsetsM'])
        self.assertGreater(correction['maxOffsetChangeM'],900)

if __name__=='__main__':unittest.main()
