import type { OcrEngineChoice } from '@/features/dashboard/dashboardApi';

const OCR_ENGINE_KEY = 'wren-ocr-engine';

export function readOcrEnginePreference(): OcrEngineChoice {
  try {
    const stored = localStorage.getItem(OCR_ENGINE_KEY);
    if (stored === 'tesseract' || stored === 'textract' || stored === 'compare') {
      return stored;
    }
  } catch {
    // ignore
  }
  return 'tesseract';
}

export function writeOcrEnginePreference(engine: OcrEngineChoice): void {
  try {
    localStorage.setItem(OCR_ENGINE_KEY, engine);
  } catch {
    // ignore
  }
}
