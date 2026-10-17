import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import { downloadDocument } from './importers';
import { errorText, type Translate, type TextKey } from './i18n';
import type { RouteDocument } from './model';

type Status = {
  archiveSha256: string | null;
  downloadedAt: string | null;
  appliedAt: string | null;
  summary: Record<string, number> | null;
  download: {
    lastAttemptAt?: string;
    lastDownloadAt?: string;
    nextAttemptAt?: string;
    outcome?: string;
  } | null;
  projectionRecoveries?: {
    key: string;
    variantId: string | null;
    identity: { route: string; shape: string; projectionRecovery: { maxDistanceM: number } };
  }[];
  issues: {
    key: string;
    variantId: string | null;
    state: 'conflict' | 'rejected' | 'missing' | 'deleted';
    reason: string;
    identity: { route?: string; shape?: string };
    hasDocument: boolean;
  }[];
};
/** Read editor-only synchronization provenance and export conflicting incoming documents.
 * Opening this panel cannot trigger or bypass an external GTFS download. */
export function SyncStatus({ t }: { t: Translate }) {
  const [status, setStatus] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await api.request<Status>('/sources/gtt'));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }, [t]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function download(key: string) {
    setBusy(true);
    setError('');
    try {
      downloadDocument(await api.request<RouteDocument>(`/sources/gtt/${key}/document`));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  const date = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');
  const label = {
    created: 'syncCreated',
    adopted: 'syncAdopted',
    updated: 'syncUpdated',
    unchanged: 'syncUnchanged',
    conflicts: 'syncConflict',
    rejected: 'syncRejected',
    missing: 'syncMissing',
    deleted: 'syncDeleted',
  } as const;
  return (
    <section className="sync-status">
      <div className="section-heading">
        <h1>{t('syncTitle')}</h1>
        <button disabled={busy} onClick={() => void refresh()}>
          {t('reload')}
        </button>
      </div>
      <p>{t('syncHelp')}</p>
      <p className="muted">{t('syncCooldown')}</p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!status && <p aria-busy={busy}>{busy ? '…' : t('syncWaiting')}</p>}
      {status && (
        <>
          <dl className="source-facts">
            <dt>{t('syncDownloaded')}</dt>
            <dd>{date(status.download?.lastDownloadAt ?? status.downloadedAt)}</dd>
            <dt>{t('syncAttempt')}</dt>
            <dd>{date(status.download?.lastAttemptAt)}</dd>
            <dt>{t('syncNext')}</dt>
            <dd>{date(status.download?.nextAttemptAt)}</dd>
            <dt>SHA-256</dt>
            <dd>
              <code>{status.archiveSha256 ?? '—'}</code>
            </dd>
          </dl>
          {!!status.projectionRecoveries?.length && (
            <details className="projection-recoveries">
              <summary>
                {t('syncRecoveries')} · {status.projectionRecoveries.length}
              </summary>
              <p>{t('syncRecoveryHelp')}</p>
              {status.projectionRecoveries.map((item) => (
                <p key={item.key}>
                  <b>
                    {item.identity.route} · {item.identity.shape}
                  </b>{' '}
                  · {item.identity.projectionRecovery.maxDistanceM} m
                </p>
              ))}
            </details>
          )}
          {status.download?.outcome === 'failed' && (
            <p className="alert error">{t('syncFailed')}</p>
          )}
          {status.summary && (
            <dl className="sync-counts">
              {Object.entries(status.summary).map(([key, value]) => (
                <div key={key}>
                  <dt>{t((label[key as keyof typeof label] ?? 'syncTitle') as TextKey)}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <h2>
            {t('syncIssues')} <span className="count">{status.issues.length}</span>
          </h2>
          {status.issues.map((issue) => (
            <article className="reference-card" key={issue.key}>
              <h3>
                {issue.identity.route ?? 'GTT'} · {issue.identity.shape ?? '—'}
              </h3>
              <p>
                <b>
                  {t(
                    (
                      {
                        conflict: 'syncConflict',
                        rejected: 'syncRejected',
                        missing: 'syncMissing',
                        deleted: 'syncDeleted',
                      } as const
                    )[issue.state],
                  )}
                </b>
              </p>
              <p>
                {t(
                  (
                    {
                      conflict: 'syncConflictHelp',
                      rejected: 'syncRejectedHelp',
                      missing: 'syncMissingHelp',
                      deleted: 'syncDeletedHelp',
                    } as const
                  )[issue.state],
                )}
              </p>
              {issue.state === 'rejected' && <small>{issue.reason}</small>}
              {issue.hasDocument && (
                <button disabled={busy} onClick={() => void download(issue.key)}>
                  {t('syncIncoming')}
                </button>
              )}
            </article>
          ))}
        </>
      )}
      <p className="muted">
        GTT S.p.A. – Gruppo Torinese Trasporti ·{' '}
        <a href="https://www.gtt.to.it" target="_blank" rel="noreferrer">
          www.gtt.to.it
        </a>
      </p>
    </section>
  );
}
