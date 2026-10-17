#!/usr/bin/env python3
"""Compose the packaged fixed-route snapshot from a baseline and checked small corrections.

The original source snapshot stays byte-for-byte intact. Each changed document is
reviewable separately; both its bytes and the complete resulting catalogue are
SHA-256 checked before any caller can import it. Live GTFS bundles do not use patches.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re


def encoded(value):
    """Use the same deterministic UTF-8 representation as the source importer."""
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def load_catalogue(path):
    """Load a plain snapshot or validate and compose its optional packaged corrections.

    Replacement indices must refer to the baseline; additions must be contiguous.
    Paths are restricted to numbered JSON files in the adjacent patches directory.
    No network requests, publication, or changes to the input files take place.
    """
    path = Path(path)
    raw = path.read_bytes()
    documents = json.loads(raw)
    if not isinstance(documents, list): raise ValueError('Catalogue must be a document list')
    index_path = path.with_suffix('.patch-index.json')
    if not index_path.exists(): return documents
    index = json.loads(index_path.read_bytes())
    if index.get('schemaVersion') != 1 or hashlib.sha256(raw).hexdigest() != index['baselineSha256']:
        raise ValueError('Catalogue baseline checksum/schema mismatch')
    baseline_count, seen = len(documents), set()
    for entry in index['entries']:
        name = entry['file']
        if not re.fullmatch(r'[0-9]{3}\.json', name): raise ValueError('Invalid correction filename')
        part = (path.with_suffix('.patches') / name).read_bytes()
        if hashlib.sha256(part).hexdigest() != entry['sha256']:
            raise ValueError('Catalogue correction checksum mismatch')
        patch = json.loads(part)
        position = patch['index']
        if type(position) is not int or position < 0 or position in seen:
            raise ValueError('Invalid or duplicate correction index')
        seen.add(position)
        if position < baseline_count: documents[position] = patch['document']
        elif position == len(documents): documents.append(patch['document'])
        else: raise ValueError('Catalogue additions must be contiguous')
    if len(documents) != index['documentCount'] or hashlib.sha256(encoded(documents)).hexdigest() != index['catalogueSha256']:
        raise ValueError('Composed catalogue checksum/count mismatch')
    return documents


def main():
    """Export a verified standalone catalogue for tools that consume plain JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalogue', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve() == args.catalogue.resolve(): parser.error('Output must not replace the baseline')
    documents = load_catalogue(args.catalogue)
    args.output.write_bytes(encoded(documents))
    print(f'Exported {len(documents)} checked fixed-route documents')


if __name__ == '__main__': main()
