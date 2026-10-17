#!/usr/bin/env python3
"""Audit repeated fixed paths and private source references without merging or downloading.

Source identifiers are provenance, not evidence of a distinct operational path.
Exact matches retain travel order and all stop memberships. Approximate geometry
matches are review candidates only; no stored geometry, source link or revision changes.
"""
import argparse
from collections import defaultdict
import fcntl
import hashlib
import itertools
import json
from pathlib import Path

from catalogue import encoded, load_catalogue
from import_routes import distance, offsets, point_at

AUDITOR_VERSION = 1
MAX_NEAR_COMPARISONS = 10000
MAX_NEAR_VERTICES = 2000000
ROOT = Path(__file__).resolve().parents[1]


def digest(value):
    """Hash deterministic source values, retaining array order and literal strings."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def stop_memberships(document):
    """Keep every ordered stop field except its replaceable canonical UUID."""
    return [{k: v for k, v in stop.items() if k != 'id'} for stop in document['stops']]


def geometry_separation(first, second, tolerance=5):
    """Bounded ordered-progress comparison, independent of vertex sampling density.

    Compare both paths at the union of their vertex progress fractions. Straight
    segments interpolate between those fractions; crossings and repeated loops
    keep their travel order. A close result is never permission to merge paths.
    Returns None when endpoints/lengths differ beyond the candidate tolerance.
    """
    a, b = first['coordinates'], second['coordinates']
    da, db = offsets(a), offsets(b)
    if not da[-1] or not db[-1]: return None
    if abs(da[-1] - db[-1]) > tolerance or max(distance(a[0], b[0]), distance(a[-1], b[-1])) > tolerance:
        return None
    fractions = sorted({v / da[-1] for v in da} | {v / db[-1] for v in db})
    maximum = max(distance(point_at(a, da, f * da[-1]), point_at(b, db, f * db[-1])) for f in fractions)
    return {'maxSeparationM': round(maximum, 3), 'lengthDifferenceM': round(abs(da[-1] - db[-1]), 3)} if maximum <= tolerance else None


def audit_gtfs(variants):
    """Classify exact same-line candidates, shared paths across lines and near shapes.

    Input is the trusted normalized GTFS bundle. Source route/shape/key/calendar
    differences do not make a path unique. Direction flags, line, ordered stops,
    coordinates, offsets, exchange direction and membership notes remain explicit.
    The report contains identifiers/hashes only, never full shapes or operator text.
    """
    if not 1 <= len(variants) <= 2000: raise ValueError('Audit requires 1–2000 source variants')
    groups, same_pattern, same_geometry = defaultdict(list), defaultdict(list), defaultdict(list)
    members, footprints = [], []
    for index, entry in enumerate(variants):
        doc = entry['document']
        points = doc['geometry']['coordinates']
        if not 2 <= len(points) <= 50000: raise ValueError('Invalid audit geometry size')
        member = {k: entry[k] for k in ('key', 'route', 'shape', 'direction') if k in entry}
        member.update(index=index, line=doc['line'])
        members.append(member)
        scope = [doc['kind'], doc['direction'], entry.get('direction', '')]
        stops = [entry.get('stopIds'), stop_memberships(doc)]
        footprint = digest([doc['geometry'], stops, scope])
        footprints.append(footprint)
        groups[footprint].append(index)
        pattern = [entry.get('stopIds'), [{k: v for k, v in stop.items() if k != 'offsetM'} for stop in stops[1]]]
        same_pattern[digest([doc['line'], pattern, scope])].append(index)
        same_geometry[digest([doc['geometry'], scope])].append(index)
    result, same_line_count, excess, cross_count = [], 0, 0, 0
    for fingerprint, indices in groups.items():
        by_line = defaultdict(list)
        for i in indices: by_line[members[i]['line']].append(i)
        for line_indices in by_line.values():
            if len(line_indices) < 2: continue
            same_line_count += 1; excess += len(line_indices) - 1
            differences = []
            for field in ('instructions', 'video', 'notes'):
                # Notes may contain meaningful editorial work as well as the
                # importer identity string. Keep that difference visible too.
                if len({digest(variants[i]['document'].get(field)) for i in line_indices}) > 1:
                    differences.append(field)
            result.append({'kind': 'same_line_exact', 'fingerprint': fingerprint,
                           'members': [members[i] for i in line_indices], 'editorialDifferences': differences})
        if len(by_line) > 1:
            cross_count += 1
            result.append({'kind': 'cross_line_shared', 'fingerprint': fingerprint,
                           'members': [members[i] for i in indices], 'editorialDifferences': []})
    near, tested, compared_vertices, limited = [], 0, 0, False
    for indices in same_pattern.values():
        for first, second in itertools.combinations(indices, 2):
            if footprints[first] == footprints[second]: continue
            tested += 1
            compared_vertices += sum(len(variants[i]['document']['geometry']['coordinates']) for i in (first, second))
            if tested > MAX_NEAR_COMPARISONS or compared_vertices > MAX_NEAR_VERTICES:
                limited = True
                break
            comparison = geometry_separation(variants[first]['document']['geometry'], variants[second]['document']['geometry'])
            if comparison is not None:
                near.append({'members': [members[first], members[second]], **comparison})
        if limited: break
    different_stops = sum(len({footprints[i] for i in indices}) > 1 for indices in same_geometry.values())
    return {'schemaVersion': 1, 'auditorVersion': AUDITOR_VERSION,
            'inputSha256': digest(variants), 'decision': 'review_only_no_merge',
            'counts': {'sourceRecords': len(variants), 'lineCodes': len({m['line'] for m in members}),
                       'exactPathStopGroups': len(groups), 'sameLinePathStopGroups': len(variants) - excess,
                       'sameLineExactGroups': same_line_count, 'redundantSameLineRecords': excess,
                       'crossLineSharedGroups': cross_count, 'nearGeometryPairs': len(near),
                       'samePathDifferentStopsGroups': different_stops},
            'groups': result, 'nearGeometryPairs': near, 'nearGeometryComplete': not limited}


def audit_movements(movements):
    """Group repeated private text/headers without claiming GPS or operational equivalence.

    Titles, endpoints, conditions, direction and street order remain significant.
    Reports carry opaque movement/source IDs only. Matching street plans with
    different headers/context are separately flagged and are never auto-merged.
    """
    exact, plans = defaultdict(list), defaultdict(list)
    fields = ('lineLabel', 'movement', 'kind', 'direction', 'title', 'origin', 'destination',
              'depot', 'streetSequence', 'sourceText', 'sourceContext', 'reviewFlags')
    for movement in movements:
        identity = {k: movement[k] for k in ('id', 'sourceRefId')}
        exact[digest([movement.get(k) for k in fields])].append(identity)
        plans[digest([movement.get(k) for k in ('movement', 'depot', 'streetSequence')])].append(identity)
    repeated = [{'fingerprint': key, 'members': value} for key, value in exact.items() if len(value) > 1]
    shared = [{'fingerprint': key, 'members': value} for key, value in plans.items() if len(value) > 1]
    return {'schemaVersion': 1, 'auditorVersion': AUDITOR_VERSION, 'inputSha256': digest(movements),
            'decision': 'private_text_review_only_no_merge',
            'counts': {'sourceRecords': len(movements), 'exactTextGroups': len(exact),
                       'repeatedTextGroups': len(repeated), 'repeatedTextRecords': len(movements) - len(exact),
                       'sharedStreetPlanGroups': len(shared)},
            'repeatedText': repeated, 'sharedStreetPlans': shared, 'geometryCompared': False}


def private_output(path):
    """Refuse private audit reports inside tracked/public project directories."""
    resolved, allowed = path.resolve(), ROOT / 'server/var'
    if resolved == ROOT or (ROOT in resolved.parents and allowed not in resolved.parents):
        raise ValueError('Private reports require private runtime storage')


def main():
    """Write a small deterministic report from a checked catalogue, bundle or private generation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--private-references', action='store_true', help='Validate and audit a private reference directory')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve() == args.input.resolve(): parser.error('Output must not replace input')
    if args.private_references:
        from validate_private_references import validate
        private_output(args.output)
        with (args.input / 'import.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            validate(args.input)
            index = json.loads((args.input / 'index.json').read_bytes())
            movements = list(itertools.chain.from_iterable(json.loads((args.input / 'parts' / entry['file']).read_bytes()) for entry in index['parts']))
            report = audit_movements(movements)
    else:
        value = json.loads(args.input.read_bytes())
        if isinstance(value, list):
            docs = load_catalogue(args.input)
            manifest = json.loads(args.input.with_suffix('.manifest.json').read_bytes())
            variants = [{**identity, 'document': doc} for doc, identity in zip(docs, manifest['variants'], strict=True)]
        else: variants = value['variants']
        report = audit_gtfs(variants)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded(report))
    if args.private_references: args.output.chmod(0o600)
    print(json.dumps(report['counts']))


if __name__ == '__main__': main()
