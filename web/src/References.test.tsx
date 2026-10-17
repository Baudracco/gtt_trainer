// @vitest-environment jsdom
import React from 'react';
import fixture from '../e2e/fixtures/depot.json';
import { studySnapshot } from './cache';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { References } from './References';
import {
  linkedMovements,
  movementDraft,
  type DepotMovement,
  type MovementIndex,
} from './depotMovements';
import { validateDocument } from './importers';
import { translator } from './i18n';
import type { RouteSnapshot } from './model';

const index = fixture.index as MovementIndex;
const first = fixture.movements[0] as DepotMovement;
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        data: url.endsWith('/depot')
          ? fixture.index
          : url.includes('/parts/')
            ? fixture.movements
            : url.includes('/blocks/')
              ? fixture.blocks
              : { posts: [] },
      }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('filters individual movements and authors only the chosen synthetic source heading', async () => {
  const onAuthor = vi.fn();
  const { container } = render(
    <References t={translator('es')} authenticated onAuthor={onAuthor} />,
  );
  await screen.findByText(/3 movimientos individuales/);
  expect(container.querySelectorAll('.movement-card')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Línea'), { target: { value: 'S1' } });
  expect(container.querySelectorAll('.movement-card')).toHaveLength(2);
  const card = container.querySelector('.movement-card') as HTMLElement;
  fireEvent.click(
    within(card).getByRole('button', { name: 'Trazar este movimiento', hidden: true }),
  );
  const doc = onAuthor.mock.calls[0][0];
  expect(doc.geometry.coordinates).toEqual([]);
  expect(doc.direction).toBe('none');
  expect(doc.source.provenance.movementId).toBe('synthetic-out-1');
  expect(doc.source.provenance.pages).toEqual([2]);
  expect(doc.source.provenance.streets).toHaveLength(2);
  expect(doc.source.provenance.text).not.toContain('Road Return');
  expect(doc.notes).toBe('');
  fireEvent.change(screen.getByLabelText('Depósito'), { target: { value: 'gerbido' } });
  fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'depot_in' } });
  expect(container.querySelectorAll('.movement-card')).toHaveLength(1);
});

it('resumes a linked variant and excludes deleted or different-source links', async () => {
  const route: RouteSnapshot = {
    ...movementDraft(first, index),
    id: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    status: 'draft',
    revision: 2,
    version: 3,
    deleted: false,
    createdAt: '2026-10-17',
  };
  const other = structuredClone(route);
  other.source.provenance!.documentSha256 = 'b'.repeat(64);
  expect(linkedMovements([other, { ...route, deleted: true }], index).size).toBe(0);
  const onOpenRoute = vi.fn(),
    onAuthor = vi.fn();
  const { container } = render(
    <References
      t={translator('es')}
      authenticated
      routes={[route]}
      onOpenRoute={onOpenRoute}
      onAuthor={onAuthor}
    />,
  );
  await screen.findByText(/1 con trazado guardado/);
  fireEvent.change(screen.getByLabelText('Avance del trazado'), { target: { value: 'linked' } });
  expect(container.querySelectorAll('.movement-card')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Continuar trazado', hidden: true }));
  expect(onOpenRoute).toHaveBeenCalledWith(route);
  expect(screen.queryByRole('button', { name: 'Trazar este movimiento', hidden: true })).toBeNull();
  expect(onAuthor).not.toHaveBeenCalled();
});

it('retains the source snapshot through JSON import and separate editorial notes', () => {
  const doc = movementDraft(first, index);
  doc.geometry.coordinates = [
    [7.6, 45],
    [7.61, 45],
  ];
  doc.notes = 'Independent author observations';
  const result = validateDocument(JSON.parse(JSON.stringify(doc)));
  expect(result.source.provenance?.text).toBe(first.sourceText);
  expect(result.source.provenance?.documentSha256).toBe(index.sourceSha256);
  result.source.provenance!.pages = [0];
  expect(() => validateDocument(result)).toThrow('Invalid source provenance');
});

it('shows a failed source part explicitly without inventing or offering mixed routes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false })),
  );
  render(<References t={translator('es')} authenticated onAuthor={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Trazar este movimiento' })).toBeNull();
});

it('requires login before reading private material and strips evidence from offline publications', async () => {
  render(<References t={translator('es')} />);
  expect(
    screen.getByText('Iniciá sesión para consultar el material operativo privado.'),
  ).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  const route = { ...movementDraft(first, index), status: 'published' } as RouteSnapshot;
  expect(studySnapshot(route).source.provenance).toBeUndefined();
  expect(route.source.provenance).toBeTruthy();
});
