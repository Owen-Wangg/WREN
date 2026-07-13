/**
 * `<WriterProgressSummary>` — the writer-facing, qualitative, pattern-level
 * progress summary shown *before* the remaining feedback items (task 18.4;
 * Requirements 18.1, 18.3, 18.4, 18.5).
 *
 * Presentational and pure: it takes an already-fetched, boundary-validated
 * {@link WriterProgressSummary} view model and renders it. Data fetching lives
 * in the connected `<WriterProgressPanel>`; keeping this component pure makes
 * the no-numeric-scoring compliance property (task 18.5 / Property 19) easy to
 * assert against arbitrary generated view models.
 *
 * **Draft-anchoring gate (Requirement 18.1, 18.5):** a progress summary is only
 * shown on a draft that has at least one prior draft — i.e. draft version ≥ 2.
 * On the first draft (`reflectsDraftVersion === 1`) this renders nothing, so no
 * pattern-level claims are made before a comparison point exists.
 *
 * **No numeric scoring (hard compliance, Requirement 18.3):** this component
 * emits no score, grade, ranking, rating, or User-to-User comparison in its
 * writer-facing text. Progress is expressed purely through qualitative tendency
 * labels (`improving` / `persistent` / `emerging`) and free-text prose. The
 * draft-version reference required for anchoring is exposed as a
 * `data-reflects-draft-*` attribute (a stable machine-readable contract for
 * tests and audit), not as rendered body text.
 *
 * **DOM contract** (relied on by the compliance render tests in task 18.5):
 *  - root `<section data-testid="writer-progress-summary">`
 *  - `data-reflects-draft-id` / `data-reflects-draft-version` carry the anchor
 *  - each pattern is an `<li data-tendency="...">`
 */
import { tendencyLabelMap } from '../tendencyLabelMap';

import type { WriterProgressSummary as WriterProgressSummaryModel } from '../progressTypes';

export interface WriterProgressSummaryProps {
  readonly summary: WriterProgressSummaryModel;
  readonly className?: string;
}

export const WRITER_PROGRESS_SUMMARY_TEST_ID = 'writer-progress-summary';

export function WriterProgressSummary({
  summary,
  className,
}: WriterProgressSummaryProps) {
  // Draft-anchoring gate: no summary until a prior draft exists (version ≥ 2).
  // First draft → render nothing (Requirements 18.1, 18.5).
  if (summary.reflectsDraftVersion < 2) {
    return null;
  }

  return (
    <section
      aria-labelledby="writer-progress-heading"
      data-testid={WRITER_PROGRESS_SUMMARY_TEST_ID}
      // Draft anchoring (steering §3): a stable reference to the exact draft
      // version this summary reflects, so it never silently drifts. Exposed as
      // an attribute — never rendered as writer-facing numeric text.
      data-reflects-draft-id={summary.draftId}
      data-reflects-draft-version={String(summary.reflectsDraftVersion)}
      className={[
        'flex flex-col gap-sm rounded-md border border-border-subtle bg-surface-muted px-md py-sm',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h3
        id="writer-progress-heading"
        className="text-bodySmall font-sans font-semibold text-text-primary"
      >
        Your progress so far
      </h3>

      {/* Qualitative headline — never a score or grade (Requirement 18.3, 18.4). */}
      <p className="text-bodySmall text-text-secondary">{summary.headline}</p>

      {summary.patterns.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {summary.patterns.map((pattern) => {
            const tendency = tendencyLabelMap[pattern.tendency];
            return (
              <li
                key={pattern.id}
                data-tendency={pattern.tendency}
                className="flex flex-col gap-xs rounded-md border border-border-subtle bg-surface-primary px-md py-sm"
              >
                <span className="flex items-center gap-xs">
                  {/* Qualitative tendency label — the accessible text-equivalent,
                      never a numeric magnitude (steering §8). */}
                  <span
                    className={[
                      'text-caption font-sans font-medium uppercase',
                      tendency.textClassName,
                    ].join(' ')}
                  >
                    {tendency.label}
                  </span>
                  <span className="text-caption text-text-muted">
                    {pattern.categoryLabel}
                  </span>
                </span>
                {/* Socratic-consistent, qualitative prose — never replacement
                    prose, never a rating (Requirement 18.4). */}
                <p className="text-bodySmall text-text-primary">
                  {pattern.description}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
