# Tesseract language data for LiteParse OCR (eng).

Source: https://github.com/tesseract-ocr/tessdata_fast (eng.traineddata)

Bundled into the Document Lambda at `/var/task/tessdata` via CDK `commandHooks`.
Set `TESSDATA_PREFIX=/var/task/tessdata`. Optional: `PDF_OCR_SERVER_URL` for an
external OCR HTTP engine later.
