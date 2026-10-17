import type { SourceProvenance } from './model';
import type { Translate } from './i18n';

/** Keep the original individual movement visible while a separate fixed geometry is authored. */
export function SourceEvidence({ evidence, t }: { evidence: SourceProvenance; t: Translate }) {
  return (
    <details className="source-evidence" open>
      <summary>
        {t('movementEvidence')} · {t('sourcePage')} {evidence.pages.join(', ')}
      </summary>
      <strong>{evidence.title}</strong>
      <p className="muted">{t('sourcePlanHint')}</p>
      <ol>
        {evidence.streets.map((street, i) => (
          <li key={i}>{street}</li>
        ))}
      </ol>
      <details>
        <summary>{t('literalText')}</summary>
        <p className="source-text">{evidence.text}</p>
        <small>
          {evidence.movementId} · SHA-256 {evidence.documentSha256}
        </small>
      </details>
    </details>
  );
}
