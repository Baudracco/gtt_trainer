// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SyncStatus } from './SyncStatus';
import { translator } from './i18n';
import { emptyRoute, type RouteSnapshot } from './model';
import * as api from './api';
vi.mock('./api', () => ({ request: vi.fn() }));
afterEach(cleanup);

it('opens linked current variants from a source audit without making a write or downloading GTFS', async () => {
  const ids = ['variant-A', 'variant-B'];
  vi.mocked(api.request).mockResolvedValue({
    archiveSha256: 'a'.repeat(64),
    download: null,
    issues: [],
    summary: null,
    duplicateAudit: {
      counts: {
        sourceRecords: 2,
        sameLinePathStopGroups: 1,
        sameLineExactGroups: 1,
        crossLineSharedGroups: 0,
        nearGeometryPairs: 0,
      },
      groups: [
        {
          kind: 'same_line_exact',
          fingerprint: 'f',
          members: ids.map((id, index) => ({
            key: id,
            line: 'T',
            shape: `S${index}`,
            variantId: id,
          })),
        },
      ],
      nearGeometryPairs: [],
    },
  });
  const routes = ids.map((id) => ({ ...emptyRoute(), id })) as RouteSnapshot[];
  const onCompare = vi.fn();
  render(<SyncStatus t={translator('es')} routes={routes} onCompare={onCompare} />);
  fireEvent.click(await screen.findByText(/Revisión de repeticiones GTFS/));
  fireEvent.click(screen.getByRole('button', { name: 'Comparar versiones actuales' }));
  expect(onCompare).toHaveBeenCalledWith(ids);
  expect(api.request).toHaveBeenCalledExactlyOnceWith('/sources/gtt');
});
