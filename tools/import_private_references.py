#!/usr/bin/env python3
"""Import an operator's local PDF into private runtime storage, never into public assets or Git.

The original PDF is read only and is not copied. Immutable source parts are written
before switching the index. An unexpected layout leaves the previous import intact.
"""
import argparse
from datetime import date
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from extract_depot_reference import extract as extract_blocks
from extract_depot_movements import atomic_bytes, extract as extract_movements, write_catalogue


def import_document(pdf, directory, version, effective_from):
    """Extract a complete generation under a process lock and publish the index last."""
    if not re.fullmatch(r'[0-9]{2}/[0-9]{2}',version):raise ValueError('Use an explicit NN/YY document version')
    date.fromisoformat(effective_from)
    directory=Path(directory)
    root=Path(__file__).resolve().parents[1]
    resolved=directory.resolve()
    allowed=root/'server/var'
    if resolved==root or (root in resolved.parents and resolved!=allowed and allowed not in resolved.parents):
        raise ValueError('Operational references require private runtime storage')
    directory.mkdir(parents=True,exist_ok=True)
    with (directory/'import.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        blocks=extract_blocks(pdf,version,effective_from)
        raw=(json.dumps(blocks,ensure_ascii=False,indent=2)+'\n').encode()
        with tempfile.TemporaryDirectory(prefix='.extract-',dir=directory) as temporary:
            reference=Path(temporary)/'blocks.json';reference.write_bytes(raw)
            movements=extract_movements(pdf,reference)
        if movements['unresolvedColumns']:raise ValueError('Unresolved source columns require review before importing')
        digest=hashlib.sha256(raw).hexdigest()
        atomic_bytes(directory/'blocks'/f'{digest}.json',raw)
        movements['blocksSha256']=digest
        write_catalogue(directory/'index.json',movements)
        # The application account needs directory traversal/read access; the web
        # server has no alias for this private tree and every API read requires login.
        if os.geteuid()==0:
            for folder in [directory,directory/'blocks',directory/'parts']:os.chmod(folder,0o755)
        return {'references':len(blocks['references']),'movements':len(movements['movements']),
                'sourceSha256':blocks['sha256'],'geometryGenerated':False}


def main():
    """Import with explicit source metadata; optional change-post JSON remains private too."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf',type=Path)
    parser.add_argument('--version',required=True)
    parser.add_argument('--effective-from',required=True)
    parser.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parents[1]/'server/var/references')
    parser.add_argument('--changes-json',type=Path)
    args=parser.parse_args()
    result=import_document(args.pdf,args.output_dir,args.version,args.effective_from)
    if args.changes_json:
        raw=args.changes_json.read_bytes()
        if len(raw)>262144:raise ValueError('Change-post reference exceeds the limit')
        value=json.loads(raw)
        if not isinstance(value,dict) or not isinstance(value.get('posts'),list):raise ValueError('Invalid change-post reference')
        atomic_bytes(args.output_dir/'changes.json',raw)
    print(json.dumps(result))


if __name__=='__main__':main()
