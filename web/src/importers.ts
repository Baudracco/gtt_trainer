import { emptyRoute, type Coordinate, type RouteDocument, type RouteStop } from './model';
import { measure, nearestOffset } from './geometry';

/** Read a finite longitude/latitude pair, deliberately discarding optional source altitude. */
export function coordinate(value: unknown): Coordinate {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !value.slice(0, 2).every((v) => typeof v === 'number' && Number.isFinite(v)) ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[1]) > 90
  )
    throw Error('Invalid WGS84 coordinate [longitude, latitude].');
  return [value[0], value[1]];
}
/** Validate an import preview locally; the server remains authoritative and validates again. */
export function validateDocument(value: unknown): RouteDocument {
  const d = value as RouteDocument;
  if (
    !d ||
    typeof d.line !== 'string' ||
    !d.line.trim() ||
    typeof d.name !== 'string' ||
    !d.name.trim() ||
    d.geometry?.type !== 'LineString' ||
    !Array.isArray(d.geometry.coordinates) ||
    d.geometry.coordinates.length < 2 ||
    d.geometry.coordinates.length > 50000
  )
    throw Error('Invalid route document.');
  if (
    !['andata', 'ritorno', 'circular', 'none'].includes(d.direction) ||
    !['service', 'depot_out', 'depot_in', 'deadhead', 'partial', 'circular'].includes(d.kind)
  )
    throw Error('Invalid route direction or kind.');
  if (!/^#[0-9a-f]{6}$/i.test(d.color)) throw Error('Invalid route color.');
  const geometry = {
    type: 'LineString' as const,
    coordinates: d.geometry.coordinates.map(coordinate),
  };
  const length = measure(geometry.coordinates).length;
  if (
    length < 1 ||
    !Array.isArray(d.stops) ||
    !Array.isArray(d.instructions) ||
    d.stops.length > 1000 ||
    d.instructions.length > 2000
  )
    throw Error('Invalid stops or instructions.');
  for (const entries of [d.stops, d.instructions]) {
    let last = -1;
    for (const entry of entries) {
      if (
        typeof entry.offsetM !== 'number' ||
        !Number.isFinite(entry.offsetM) ||
        entry.offsetM < last ||
        entry.offsetM < 0 ||
        entry.offsetM > length + 5
      )
        throw Error('Invalid travel order or route offset.');
      last = entry.offsetM;
    }
  }
  const stops = d.stops.map((s) => {
    if (
      typeof s.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(s.id) ||
      typeof s.name !== 'string' ||
      typeof s.code !== 'string' ||
      typeof s.notes !== 'string' ||
      typeof s.exchange !== 'boolean' ||
      (s.exchange && !['andata', 'ritorno', 'circular'].includes(s.exchangeDirection ?? ''))
    )
      throw Error('Invalid stop.');
    return { ...s, coordinates: coordinate(s.coordinates) };
  });
  for (const instruction of d.instructions)
    if (
      typeof instruction.text !== 'string' ||
      !instruction.text.trim() ||
      typeof instruction.notes !== 'string'
    )
      throw Error('Invalid instruction.');
  const reference = (r: unknown) => {
    const m = r as { id?: unknown; caption?: unknown; credit?: unknown };
    if (
      !m ||
      typeof m.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.id) ||
      typeof m.caption !== 'string' ||
      m.caption.length > 500 ||
      typeof m.credit !== 'string' ||
      m.credit.length > 500
    )
      throw Error('Invalid media reference.');
  };
  if (d.video) reference(d.video);
  let photos = 0;
  for (const step of d.instructions) {
    if (step.photos !== undefined) {
      if (!Array.isArray(step.photos) || step.photos.length > 3)
        throw Error('Maximum three photos per instruction.');
      step.photos.forEach(reference);
      photos += step.photos.length;
    }
  }
  if (photos > 200) throw Error('Maximum 200 photo references per route.');
  if (
    typeof d.notes !== 'string' ||
    !d.source ||
    Object.values(d.source).some((v) => typeof v !== 'string')
  )
    throw Error('Invalid source or notes.');
  return { ...d, geometry, stops };
}

/** Preserve LineString order and explicitly associated stop memberships.
 * Disconnected MultiLineStrings are rejected rather than joined with invented roads. */
export function parseGeoJSON(json: unknown, filename: string): RouteDocument[] {
  if (Array.isArray(json)) return json.map(validateDocument);
  const obj = json as any;
  if (obj?.geometry?.type === 'LineString' && obj.stops) return [validateDocument(obj)];
  const features =
    obj?.type === 'FeatureCollection'
      ? obj.features
      : obj?.type === 'Feature'
        ? [obj]
        : [{ type: 'Feature', geometry: obj, properties: {} }];
  if (!Array.isArray(features) || features.length > 60000)
    throw Error('Invalid feature collection.');
  const shapes = features.filter((f: any) => f?.geometry?.type === 'LineString');
  const points = features.filter((f: any) => f?.geometry?.type === 'Point');
  if (
    shapes.length > 1 &&
    points.length &&
    (shapes.some((f: any) => !f.properties?.route_id) ||
      points.some((f: any) => !f.properties?.route_id))
  )
    throw Error(
      'Multiple routes with stops require explicit route_id on each LineString and Point.',
    );
  if (
    shapes.length > 1 &&
    new Set(shapes.map((f: any) => f.properties?.route_id).filter(Boolean)).size !==
      shapes.filter((f: any) => f.properties?.route_id).length
  )
    throw Error('Route variant identifiers must be unique.');
  const routes: RouteDocument[] = [];
  const identities = new Map<string, string>();
  for (const f of features)
    if (f?.geometry?.type === 'LineString') {
      const p = f.properties ?? {},
        doc = emptyRoute();
      doc.line = String(p.line ?? 'IMPORT');
      doc.name = String(p.name ?? filename);
      doc.direction = p.direction ?? 'none';
      doc.kind = p.kind ?? 'service';
      doc.color = p.color ?? doc.color;
      doc.geometry.coordinates = f.geometry.coordinates.map(coordinate);
      doc.notes = String(p.notes ?? '');
      doc.source = { ...doc.source, ...(p.source ?? {}), name: String(p.source?.name ?? filename) };
      const measured = measure(doc.geometry.coordinates);
      for (const point of features.filter(
        (x: any) =>
          x?.geometry?.type === 'Point' &&
          String(x.properties?.route_id ?? '') === String(p.route_id ?? ''),
      )) {
        const props = point.properties ?? {},
          code = String(props.code ?? props.stop_id ?? '');
        const key = code || String(props.id ?? '') || crypto.randomUUID();
        const id = identities.get(key) ?? crypto.randomUUID();
        identities.set(key, id);
        const position = coordinate(point.geometry.coordinates);
        const stop: RouteStop = {
          id,
          code,
          name: String(props.name ?? code),
          coordinates: position,
          offsetM:
            typeof props.offset_m === 'number' ? props.offset_m : nearestOffset(measured, position),
          exchange: props.exchange === true,
          exchangeDirection: props.exchange_direction ?? null,
          notes: String(props.notes ?? ''),
        };
        doc.stops.push(stop);
      }
      doc.stops.sort((a, b) => a.offsetM - b.offsetM);
      doc.instructions = p.instructions ?? [];
      routes.push(validateDocument(doc));
    }
  if (!routes.length)
    throw Error(
      'No LineString found. MultiLineStrings must be split into explicit route variants.',
    );
  return routes;
}

/** Import each GPX track segment as a separate draft candidate, without joining gaps. */
export function parseGpx(text: string, filename: string): RouteDocument[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('GPX entities are not supported.');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw Error('Invalid GPX.');
  const segments = [...xml.getElementsByTagNameNS('*', 'trkseg')];
  if (!segments.length)
    throw Error(
      'GPX needs track segments. Route points alone do not describe a fixed road geometry.',
    );
  return segments.map((segment, index) => {
    const doc = emptyRoute();
    doc.line = 'IMPORT';
    doc.name = `${filename} · ${index + 1}`;
    doc.geometry.coordinates = [...segment.getElementsByTagNameNS('*', 'trkpt')].map((p) =>
      coordinate([Number(p.getAttribute('lon') ?? NaN), Number(p.getAttribute('lat') ?? NaN)]),
    );
    doc.source.name = filename;
    return validateDocument(doc);
  });
}

/** Read one bounded JSON/GeoJSON/GPX file into a preview; this function never persists a route. */
export async function importFile(file: File): Promise<RouteDocument[]> {
  if (file.size > 4194304)
    throw Error(
      'Maximum file size: 4 MiB. Use tools/import_routes.py for larger feeds and spreadsheets.',
    );
  const text = await file.text();
  return file.name.toLowerCase().endsWith('.gpx')
    ? parseGpx(text, file.name)
    : parseGeoJSON(JSON.parse(text), file.name);
}

/** Download a complete route document with its source and revision content for review. */
export function downloadDocument(document: RouteDocument): void {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
  const a = window.document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gtt-route-${document.line.replace(/[^a-z0-9_-]/gi, '_')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
