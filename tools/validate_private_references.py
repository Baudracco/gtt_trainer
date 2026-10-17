#!/usr/bin/env python3
"""Check a private reference generation without printing its operational text."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def validate(directory):
    """Verify source/part identities, literal text hashes, pages and absence of invented geometry."""
    directory=Path(directory)
    index=json.loads((directory/'index.json').read_bytes())
    def part(kind,digest):
        if not re.fullmatch(r'[a-f0-9]{64}',digest):raise ValueError('Invalid reference identity')
        raw=(directory/kind/(digest+'.json')).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Reference checksum mismatch')
        return json.loads(raw)
    blocks=part('blocks',index['blocksSha256'])
    if blocks['sha256']!=index['sourceSha256']:raise ValueError('Source document provenance mismatch')
    references={r['id']:r for r in blocks['references']}
    if len(references)!=index['sourceReferenceCount']:raise ValueError('Source block count mismatch')
    movements=[]
    for entry in index['parts']:
        if entry['file']!=entry['sha256']+'.json':raise ValueError('Source filename mismatch')
        records=part('parts',entry['sha256'])
        if len(records)!=entry['count'] or [m['id']for m in records]!=entry['movementIds']:
            raise ValueError('Movement part count/identity mismatch')
        movements.extend(records)
    if len(movements)!=index['movementCount'] or len({m['id']for m in movements})!=len(movements):
        raise ValueError('Movement count/identity mismatch')
    for movement in movements:
        if 'geometry'in movement or movement['direction']!='none' or movement['geometryStatus']!='not_georeferenced':
            raise ValueError('Source movement must remain an unshaped reference')
        if not movement['sourceText'] or not movement['streetSequence']:raise ValueError('Empty source movement')
        if hashlib.sha256((movement['title']+'\n'+movement['sourceText']).encode()).hexdigest()!=movement['sourceTextSha256']:
            raise ValueError('Literal source text checksum mismatch')
        if not set(movement['pages']) <= set(references[movement['sourceRefId']]['pages']):raise ValueError('Source page mismatch')
        if movement['pages']!=sorted({f['page']for f in movement['sourceFragments']}):raise ValueError('Fragment page mismatch')
    return {'references':len(references),'movements':len(movements),'geometryGenerated':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    print(json.dumps(validate(parser.parse_args().directory)))
