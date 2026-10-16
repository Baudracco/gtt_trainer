#!/usr/bin/env python3
"""Convert GTFS, CSV or XLSX to reviewable route documents. No routing engine.

GTFS keeps the supplied shape point order and each distinct stop pattern.
Direction 0/1 is retained in the name, not guessed to mean andata/ritorno.
CSV/XLSX vertices require route_id, sequence, longitude, latitude, line, name.
Use XLSX sheets 'vertices', optional 'stops' and 'instructions'.
"""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import uuid
import zipfile
from datetime import datetime, timezone

NAMESPACE = uuid.UUID('7c4c8e96-e6b9-43bd-bb24-05fc3ebc3fae')


def coordinate(lon, lat):
    p = [float(lon), float(lat)]
    if not all(map(math.isfinite, p)) or abs(p[0]) > 180 or abs(p[1]) > 90:
        raise ValueError('Invalid WGS84 coordinate')
    return p


def distance(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b[0]-a[0])/2)**2
    return 6371008.8*2*math.asin(math.sqrt(min(1, h)))


def offsets(points):
    out = [0.0]
    for a, b in zip(points, points[1:]): out.append(out[-1]+distance(a, b))
    return out


def project(points, distances, point, after=0):
    candidates = []
    cosine = math.cos(math.radians(point[1]))
    for i, (a, b) in enumerate(zip(points, points[1:])):
        ax, ay = (a[0]-point[0])*cosine, a[1]-point[1]
        dx, dy = (b[0]-a[0])*cosine, b[1]-a[1]
        denominator = dx*dx+dy*dy
        if denominator == 0: continue
        t = max(0, min(1, -(ax*dx+ay*dy)/denominator))
        along = distances[i]+t*(distances[i+1]-distances[i])
        if along < after-2: continue
        projected = [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]
        candidates.append((distance(point, projected), along))
    if not candidates: raise ValueError('A stop cannot follow the preceding stop on this shape')
    nearest = min(candidates)
    if nearest[0] > 250: raise ValueError(f'Stop {nearest[0]:.0f} m from shape; manual validation required')
    return round(max(after, nearest[1]), 2)


def document(line, name, points, source):
    if not 2 <= len(points) <= 50000 or offsets(points)[-1] < 1: raise ValueError('Invalid fixed shape')
    return {'line': line, 'name': name, 'direction': 'none', 'kind': 'service', 'color': '#2463eb',
            'geometry': {'type': 'LineString', 'coordinates': points}, 'stops': [], 'instructions': [], 'notes': '',
            'source': source}


def gtfs_key(route_id, shape_id, direction, pattern):
    identity = json.dumps([route_id, shape_id, direction, list(pattern)], separators=(',', ':'))
    return 'gtt:' + hashlib.sha256(identity.encode()).hexdigest()


def gtfs(path, source, selected, direction_map, with_identity=False):
    with zipfile.ZipFile(path) as z:
        entries = z.infolist()
        if len(entries) > 200 or sum(i.file_size for i in entries) > 250*1024*1024:
            raise ValueError('GTFS archive exceeds limits')
        def rows(name):
            return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig', newline=''))
        lines = {r['route_id']: r for r in rows('routes.txt') if r.get('route_type') == '3' and (not selected or r['route_short_name'] in selected)}
        trips = {r['trip_id']: r for r in rows('trips.txt') if r['route_id'] in lines and r.get('shape_id')}
        shape_ids = {t['shape_id'] for t in trips.values()}
        shapes = {s: [] for s in shape_ids}
        for row in rows('shapes.txt'):
            if row['shape_id'] in shapes:
                shapes[row['shape_id']].append((int(row['shape_pt_sequence']), coordinate(row['shape_pt_lon'], row['shape_pt_lat'])))
        stops = {r['stop_id']: r for r in rows('stops.txt')}
        patterns = {key: [] for key in trips}
        for row in rows('stop_times.txt'):
            if row['trip_id'] in patterns: patterns[row['trip_id']].append((int(row['stop_sequence']), row['stop_id']))
        distinct = {}
        for trip_id, trip in trips.items():
            pattern = tuple(stop_id for _, stop_id in sorted(patterns[trip_id]))
            key = (trip['route_id'], trip['shape_id'], trip.get('direction_id', ''), pattern)
            distinct.setdefault(key, trip)
        documents = []
        skipped = []
        for (route_id, shape_id, direction, pattern), trip in sorted(distinct.items()):
            identity = {'key': gtfs_key(route_id, shape_id, direction, pattern), 'route': route_id,
                        'shape': shape_id, 'direction': direction, 'stopIds': list(pattern)}
            line = lines[route_id]
            points = [point for _, point in sorted(shapes[shape_id])]
            name = f"{trip.get('trip_headsign') or line['route_long_name']} · {shape_id} · GTFS dir {direction or '?'}"
            try:
                result = document(line['route_short_name'], name[:200], points, source)
                result['direction'] = direction_map.get(direction, 'none')
                color = line.get('route_color', '')
                if len(color) == 6 and all(c in '0123456789abcdefABCDEF' for c in color): result['color'] = '#'+color
                result['notes'] = f"GTFS route_id={route_id}; shape_id={shape_id}; direction_id={direction}. Verify the operational andata/ritorno designation."
                previous = 0
                measured = offsets(points)
                for stop_id in pattern:
                    stop = stops[stop_id]
                    position = coordinate(stop['stop_lon'], stop['stop_lat'])
                    previous = project(points, measured, position, previous)
                    result['stops'].append({'id': str(uuid.uuid5(NAMESPACE, 'gtt-stop-'+stop_id)),
                        'code': stop.get('stop_code') or 'GTFS:'+stop_id, 'name': stop['stop_name'], 'coordinates': position,
                        'offsetM': previous, 'exchange': False, 'exchangeDirection': None, 'notes': stop.get('stop_desc', '')})
                if with_identity: result['_gtfs'] = identity
                documents.append(result)
            except (ValueError, KeyError) as error:
                skipped.append({**(identity if with_identity else {'route': route_id, 'shape': shape_id}), 'reason': str(error)})
        return documents, skipped


def tabular(path, source):
    if path.suffix.lower() == '.xlsx':
        import openpyxl
        book = openpyxl.load_workbook(path, read_only=True, data_only=True)
        def sheet(name):
            if name not in book.sheetnames: return []
            values = iter(book[name].values)
            headers = next(values, ())
            if any(not isinstance(h, str) for h in headers): raise ValueError('Sheet column names are required')
            return [dict(zip(headers, row)) for row in values if any(x is not None for x in row)]
        vertices, stops, instructions = sheet('vertices'), sheet('stops'), sheet('instructions')
        book.close()
    else:
        with path.open(encoding='utf-8-sig', newline='') as file: vertices = list(csv.DictReader(file))
        stops, instructions = [], []
    groups = {}
    for row in vertices: groups.setdefault(str(row['route_id']), []).append(row)
    documents = []
    for key, rows in groups.items():
        ordered = sorted(rows, key=lambda row: int(row['sequence']))
        if len({int(row['sequence']) for row in rows}) != len(rows): raise ValueError('Duplicate vertex sequence')
        points = [coordinate(r['longitude'], r['latitude']) for r in ordered]
        result = document(str(ordered[0]['line']), str(ordered[0]['name']), points, source)
        result['direction'] = ordered[0].get('direction') or 'none'
        result['kind'] = ordered[0].get('kind') or 'service'
        for s in sorted((s for s in stops if str(s['route_id']) == key), key=lambda r: int(r['sequence'])):
            exchange = str(s.get('exchange', '')).lower() in ('true','1')
            code = str(s.get('code') or '')
            result['stops'].append({'id': str(uuid.uuid5(NAMESPACE, 'import-stop-'+str(s.get('stop_id') or code or uuid.uuid4()))), 'code': code,
                'name': str(s['name']), 'coordinates': coordinate(s['longitude'],s['latitude']), 'offsetM': float(s['offset_m']),
                'exchange': exchange, 'exchangeDirection': s.get('exchange_direction') if exchange else None, 'notes': str(s.get('notes') or '')})
        for s in sorted((s for s in instructions if str(s['route_id']) == key), key=lambda r: int(r['sequence'])):
            result['instructions'].append({'offsetM': float(s['offset_m']), 'text': str(s['text']), 'notes': str(s.get('notes') or ''), 'kind': str(s.get('kind') or 'note')})
        documents.append(result)
    return documents, []


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--lines', default='', help='Comma-separated exact GTFS route_short_name values; buses only')
    p.add_argument('--source-name', default='GTT S.p.A. – Gruppo Torinese Trasporti')
    p.add_argument('--source-url', default='https://www.gtt.to.it/open_data/gtt_gtfs.zip')
    p.add_argument('--license', default='GTT GTFS non-commercial use; attribution required. https://www.gtt.to.it/gtt_gtfs_license.html')
    p.add_argument('--direction-0', choices=['andata','ritorno','circular','none'], default='none')
    p.add_argument('--direction-1', choices=['andata','ritorno','circular','none'], default='none')
    a = p.parse_args()
    source = {'name': a.source_name, 'url': a.source_url, 'license': a.license, 'retrievedAt': datetime.now(timezone.utc).date().isoformat()}
    if a.input.stat().st_size > 100*1024*1024: raise ValueError('Input exceeds 100 MiB')
    docs, skipped = gtfs(a.input, source, set(filter(None,a.lines.split(','))), {'0':a.direction_0,'1':a.direction_1}) if a.input.suffix.lower()=='.zip' else tabular(a.input, source)
    if not docs: raise ValueError('No valid route documents found')
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(docs, ensure_ascii=False, separators=(',',':'))+'\n')
    manifest = {'source': str(a.input.name), 'sha256': hashlib.sha256(a.input.read_bytes()).hexdigest(), 'routes': len(docs), 'skipped': skipped, 'status': 'draft_only'}
    a.output.with_suffix('.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print(f'{len(docs)} route drafts; {len(skipped)} patterns require manual geometry review')
