/**
 * Side-by-side OCR comparison results after a Compare-mode PDF ingest.
 */
import type { OcrComparison } from '@/features/dashboard/dashboardApi';

export interface OcrComparisonPanelProps {
  readonly comparison: OcrComparison;
  readonly onDismiss?: () => void;
}

function enginePanel(
  title: string,
  result: OcrComparison['tesseract'] | OcrComparison['textract'],
) {
  if (!result) {
    return (
      <div className="min-w-0 flex-1">
        <h3 className="mb-xs text-caption font-sans font-semibold text-text-primary">{title}</h3>
        <p className="text-caption text-text-muted">No result</p>
      </div>
    );
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-xs flex flex-wrap items-baseline justify-between gap-xs">
        <h3 className="text-caption font-sans font-semibold text-text-primary">{title}</h3>
        <p className="text-caption text-text-muted">
          {result.durationMs} ms · {result.textLength.toLocaleString()} chars
        </p>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-muted/40 p-sm text-caption leading-relaxed text-text-secondary">
        {result.text || '(empty)'}
      </pre>
    </div>
  );
}

export function OcrComparisonPanel({ comparison, onDismiss }: OcrComparisonPanelProps) {
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(comparison, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-comparison.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="region"
      aria-label="OCR comparison results"
      className="border-b border-border-subtle bg-surface-primary px-lg py-sm"
    >
      <div className="mb-sm flex flex-wrap items-center justify-between gap-sm">
        <p className="text-bodySmall font-sans font-medium text-text-primary">
          OCR comparison (primary draft: {comparison.primaryEngine})
        </p>
        <div className="flex items-center gap-sm">
          <button
            type="button"
            className="text-caption font-sans font-medium text-text-secondary underline-offset-2 hover:underline"
            onClick={exportJson}
          >
            Export JSON
          </button>
          {onDismiss && (
            <button
              type="button"
              className="text-caption font-sans font-medium text-text-secondary underline-offset-2 hover:underline"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-md md:flex-row">
        {enginePanel('Tesseract', comparison.tesseract)}
        {enginePanel('Amazon Textract', comparison.textract)}
      </div>
    </div>
  );
}
