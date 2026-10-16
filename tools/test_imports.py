import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
import io
import csv

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
    def test_reference_provenance_and_coverage(self):
        root=Path(__file__).resolve().parents[1]
        data=json.loads((root/'web/public/data/depot-references.json').read_text())
        pages={p for r in data['references'] for p in r['pages']}
        self.assertEqual(pages,set(range(2,69)))
        self.assertEqual(len(data['sha256']),64)
        first=data['references'][0]
        self.assertEqual(first['line'],'CP1');self.assertIn('2699 FERMI SUD',first['rientro']);self.assertIn('V. Manzoni',first['uscita'])
        self.assertNotIn('geometry',first)
        posts=json.loads((root/'web/public/data/gerbido-change-posts.json').read_text())['posts']
        self.assertEqual(len(posts),30);self.assertTrue(all(p['direction'] is None for p in posts))
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
        docs=json.loads((root/'data/gtt-urban-drafts.json').read_text())
        self.assertEqual(manifest['routes'],602)
        self.assertEqual(len(manifest['skipped']),31)
        self.assertEqual(len({d['line'] for d in docs}),137)
        self.assertTrue({v['key'] for v in original['variants']} <= {v['key'] for v in manifest['variants']})
        self.assertTrue({'4U','3U','9U','10U','15U','16CDU','16CSU','13U'} <= {v['route'] for v in manifest['variants']})
        self.assertEqual(manifest['sha256'],original['sha256'])

if __name__=='__main__':unittest.main()
