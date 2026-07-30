/**
 * Compact OCR engine selector for PDF ingest testing (Tesseract / Textract / Compare).
 */
import type { OcrEngineChoice } from '@/features/dashboard/dashboardApi';

export interface OcrEngineSelectProps {
  readonly value: OcrEngineChoice;
  readonly onChange: (value: OcrEngineChoice) => void;
  readonly className?: string;
}

const OPTIONS: Array<{ value: OcrEngineChoice; label: string }> = [
  { value: 'tesseract', label: 'Tesseract' },
  { value: 'textract', label: 'Textract' },
  { value: 'compare', label: 'Compare both' },
];

export function OcrEngineSelect({ value, onChange, className }: OcrEngineSelectProps) {
  return (
    <label
      className={['flex flex-col gap-[2px] text-caption font-sans text-text-secondary', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="font-medium text-text-muted">PDF OCR engine</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as OcrEngineChoice)}
        className="rounded-md border border-border-subtle bg-surface-primary px-sm py-xs text-bodySmall text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
        aria-label="PDF OCR engine"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
