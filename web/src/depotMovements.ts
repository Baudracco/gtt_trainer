import { emptyRoute, type RouteDocument, type RouteSnapshot } from './model';
import { request } from './api';

/** One explicit bold DAPER heading and its literal body; it has no generated geometry. */
export type DepotMovement = {
  id: string;
  sourceRefId: string;
  lineLabel: string;
  kind: 'depot_out' | 'depot_in';
  movement: 'uscita' | 'rientro';
  title: string;
  depot: string;
  depotCode: string;
  origin: string;
  destination: string;
  pages: number[];
  streetSequence: string[];
  sourceText: string;
  sourceTextSha256: string;
  reviewFlags: string[];
};
/** Versioned index of small immutable source parts, suitable for independent caching. */
export type MovementIndex = {
  available: true;
  schemaVersion: 1;
  title: string;
  version: string;
  effectiveFrom: string;
  sourceSha256: string;
  sourceReferenceCount: number;
  movementCount: number;
  blocksSha256: string;
  parts: { file: string; sha256: string; count: number; movementIds: string[] }[];
};

/** Load authenticated private parts; no operational source text is fetched from public assets. */
export async function loadMovements(): Promise<{
  index: MovementIndex | null;
  movements: DepotMovement[];
  references: { id: string; line: string; pages: number[]; uscita: string; rientro: string }[];
}> {
  const index = await request<MovementIndex | { available: false }>('/references/depot');
  if (!index.available) return { index: null, movements: [], references: [] };
  if (index.schemaVersion !== 1 || !Array.isArray(index.parts) || index.parts.length > 100)
    throw Error('Invalid movement index');
  const parts = await Promise.all(
    index.parts.map(async (part) => {
      if (!/^[a-f0-9]{64}\.json$/.test(part.file) || part.file !== `${part.sha256}.json`)
        throw Error('Invalid source part');
      const movements = await request<DepotMovement[]>(`/references/depot/parts/${part.sha256}`);
      if (
        !Array.isArray(movements) ||
        movements.length !== part.count ||
        movements.some((m, i) => m.id !== part.movementIds[i])
      )
        throw Error('Source part count/identity mismatch');
      return movements;
    }),
  );
  const movements = parts.flat();
  if (
    movements.length !== index.movementCount ||
    new Set(movements.map((m) => m.id)).size !== movements.length
  )
    throw Error('Movement catalogue count/identity mismatch');
  if (!/^[a-f0-9]{64}$/.test(index.blocksSha256)) throw Error('Invalid source block identity');
  const blocks = await request<{
    references: { id: string; line: string; pages: number[]; uscita: string; rientro: string }[];
  }>(`/references/depot/blocks/${index.blocksSha256}`);
  return { index, movements, references: blocks.references };
}

/** Start exactly one source movement with empty geometry and an immutable source-text snapshot. */
export function movementDraft(movement: DepotMovement, index: MovementIndex): RouteDocument {
  const doc = emptyRoute();
  doc.line = movement.lineLabel;
  doc.name = `${movement.lineLabel} · ${movement.title}`.slice(0, 200);
  doc.direction = 'none';
  doc.kind = movement.kind;
  doc.notes = '';
  doc.source = {
    name: `${index.title} · ${index.version} · p. ${movement.pages.join(', ')}`.slice(0, 200),
    url: '',
    license: 'User-provided operational reference; original document is not redistributed.',
    retrievedAt: index.effectiveFrom,
    provenance: {
      documentSha256: index.sourceSha256,
      referenceId: movement.sourceRefId,
      movementId: movement.id,
      pages: movement.pages,
      title: movement.title,
      text: movement.sourceText,
      textSha256: movement.sourceTextSha256,
      streets: movement.streetSequence,
    },
  };
  return doc;
}

/** Resume existing variants by source document and movement, preserving version/history semantics. */
export function linkedMovements(routes: RouteSnapshot[], index: MovementIndex) {
  const linked = new Map<string, RouteSnapshot[]>();
  for (const route of routes) {
    const provenance = route.source.provenance;
    if (route.deleted || provenance?.documentSha256 !== index.sourceSha256) continue;
    const group = linked.get(provenance.movementId) ?? [];
    group.push(route);
    linked.set(provenance.movementId, group);
  }
  return linked;
}
