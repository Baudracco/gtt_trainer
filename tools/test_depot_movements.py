"""Synthetic layout/reference tests; private operator documents are never CI fixtures."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from extract_depot_movements import depot_code, endpoints, split_column, street_sequence, write_catalogue
from import_private_references import import_document
from validate_private_references import validate

ROOT=Path(__file__).resolve().parents[1]


class DepotMovementTests(unittest.TestCase):
    def test_bold_headings_split_individual_synthetic_movements(self):
        def line(text,bold,top):return {'text':text,'bold':bold,'page':2,'bbox':[80,top,320,top+12]}
        groups,unresolved=split_column([line('Dep. Gerbido-Stop A',True,100),line('Road A - Road B',False,114),
                                       line('Dep. Gerbido-Stop C',True,140),line('Road C - Road D',False,154)])
        self.assertIsNone(unresolved);self.assertEqual(len(groups),2)
        self.assertEqual(groups[0]['bodyLines'][0]['text'],'Road A - Road B')
        self.assertEqual(street_sequence('Road A - Road Alpha–Beta - Road C (segment A-B)'),
                         ['Road A','Road Alpha–Beta','Road C (segment A-B)'])

    def test_unrecognized_column_is_reported_and_aliases_keep_literal_endpoints(self):
        groups,unresolved=split_column([{'text':'Unrecognized source','bold':False,'page':2,'bbox':[0,0,1,1]}])
        self.assertEqual(groups,[]);self.assertEqual(unresolved,'Unrecognized source')
        self.assertEqual(endpoints('Synthetic Stop - Dep. Gerbido','rientro'),('Synthetic Stop','Dep. Gerbido','Dep. Gerbido'))
        self.assertEqual(depot_code('Dep. S.Paolo'),depot_code('Dep San Paolo'))

    def test_private_generation_integrity_and_content_addressed_parts(self):
        fixture=json.loads((ROOT/'web/e2e/fixtures/depot.json').read_text())
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'index.json';(Path(folder)/'blocks').mkdir()
            blocksraw=(json.dumps(fixture['blocks'],ensure_ascii=False,separators=(',',':'))+'\n').encode()
            (Path(folder)/'blocks'/(fixture['index']['blocksSha256']+'.json')).write_bytes(blocksraw)
            data={k:v for k,v in fixture['index'].items()if k not in ['parts','movementCount']}
            data['movements']=fixture['movements'];write_catalogue(target,data)
            self.assertEqual(validate(folder),{'references':2,'movements':3,'geometryGenerated':False})
            original=json.loads(target.read_bytes())['parts'][0]['file']
            data['movements'][0]['title']='Changed synthetic heading'
            data['movements'][0]['sourceTextSha256']=hashlib.sha256(('Changed synthetic heading\n'+data['movements'][0]['sourceText']).encode()).hexdigest()
            write_catalogue(target,data)
            self.assertNotEqual(original,json.loads(target.read_bytes())['parts'][0]['file'])
            self.assertTrue((Path(folder)/'parts'/original).exists())
            part=json.loads(target.read_bytes())['parts'][0]['file'];(Path(folder)/'parts'/part).write_text('[]')
            with self.assertRaisesRegex(ValueError,'checksum'):validate(folder)

    def test_importer_refuses_repository_and_public_output_paths_before_reading_pdf(self):
        for output in [ROOT,ROOT/'data',ROOT/'web/public',ROOT/'web/public/data']:
            with self.assertRaisesRegex(ValueError,'private runtime'):import_document(Path('missing.pdf'),output,'01/26','2026-01-01')


if __name__=='__main__':unittest.main()
