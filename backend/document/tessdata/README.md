# Tesseract language data for LiteParse OCR

Bundled into the Document Lambda at `/var/task/tessdata` via CDK `commandHooks`.
Runtime: `TESSDATA_PREFIX=/var/task/tessdata`.

## Current pack

- `eng.traineddata` — English (tessdata_fast)
  Source: https://github.com/tesseract-ocr/tessdata_fast

## Adding languages

1. Download the matching `*.traineddata` (prefer tessdata_fast for size).
2. Place it under this folder (e.g. `fra.traineddata`).
3. Redeploy Compute so CDK copies tessdata into the Lambda asset.
4. Set `PDF_OCR_LANGUAGE` on the Document Lambda, e.g. `eng+fra`.

If a requested language file is missing, OCR is disabled automatically and a
warning is logged — digital (text-layer) PDFs still extract without OCR.

## Related env

| Variable | Default | Purpose |
|----------|---------|---------|
| `PDF_OCR_ENABLED` | `true` | Master OCR switch |
| `PDF_OCR_LANGUAGE` | `eng` | Tesseract langs (`+`-separated) |
| `TESSDATA_PREFIX` | `/var/task/tessdata` | traineddata directory |
| `PDF_OCR_SERVER_URL` | unset | Optional external OCR HTTP engine |
