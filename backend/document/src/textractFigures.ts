/**
 * Textract Figure Extractor — extract LAYOUT_FIGURE regions from source PDFs.
 *
 * Extracts figure regions as PNG images using bounding box coordinates,
 * uploads them to S3, and returns TipTap image nodes at reading-order positions.
 * Falls back to placeholder paragraphs on any failure.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
import type { Block } from '@aws-sdk/client-textract';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { TipTapNode } from '@wren/types';

/**
 * Result of processing a single LAYOUT_FIGURE block.
 */
export interface FigureResult {
  /** TipTap image node (on success) or placeholder paragraph (on failure). */
  node: TipTapNode;
  /** S3 key where the extracted figure PNG is stored. Only present on success. */
  s3Key?: string;
}

/** Minimum bounding box dimension for figure extraction (2% of page). */
const MIN_FIGURE_DIMENSION = 0.02;

/** Maximum number of figures to extract per document (Requirement 3.6). */
const MAX_FIGURES_PER_DOCUMENT = 20;

/** Total time budget for all figure extraction in milliseconds (Requirement 3.5). */
const EXTRACTION_TIME_BUDGET_MS = 30_000;

/** Placeholder text inserted when figure extraction fails (Requirement 3.4). */
const PLACEHOLDER_TEXT = '[Figure could not be rendered]';

/**
 * Build a placeholder paragraph node for a figure that could not be rendered.
 */
function placeholderNode(): TipTapNode {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: PLACEHOLDER_TEXT }],
  };
}

/**
 * Build a TipTap image node referencing the S3 key for an extracted figure.
 */
function imageNode(s3Key: string): TipTapNode {
  return {
    type: 'image',
    attrs: { src: s3Key },
  };
}

/**
 * Compute the S3 key for a figure image.
 *
 * Format: `figures/{documentId}/figure-{pageNumber}-{figureIndex}.png`
 * - pageNumber: 1-based page number from the block
 * - figureIndex: zero-padded sequential integer (e.g., "00", "01")
 *
 * Requirement 3.2
 */
export function computeFigureS3Key(
  documentId: string,
  pageNumber: number,
  figureIndex: number,
): string {
  const paddedIndex = String(figureIndex).padStart(2, '0');
  return `figures/${documentId}/figure-${pageNumber}-${paddedIndex}.png`;
}

/**
 * Determine whether a figure block meets the minimum size threshold.
 *
 * Requirement 3.1: Width > 0.02 AND Height > 0.02
 */
function meetsMinimumSize(block: Block): boolean {
  const bbox = block.Geometry?.BoundingBox;
  if (!bbox) return false;
  return (bbox.Width ?? 0) > MIN_FIGURE_DIMENSION &&
    (bbox.Height ?? 0) > MIN_FIGURE_DIMENSION;
}

/**
 * Attempt to render a figure region from the source PDF page as a PNG buffer.
 *
 * Uses pdf-lib to get page dimensions and sharp to crop/render the region.
 * Since pdf-lib cannot rasterize PDFs and sharp may not have PDF support
 * depending on the libvips build, this wraps the attempt in error handling
 * and returns null on failure.
 *
 * Both pdf-lib and sharp are loaded dynamically at runtime so that this module
 * compiles even when their type declarations are not installed.
 */
async function renderFigureRegion(
  pdfBuffer: Buffer,
  pageNumber: number,
  left: number,
  top: number,
  width: number,
  height: number,
): Promise<Buffer | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfLib = await (Function('return import("pdf-lib")')() as Promise<{
      PDFDocument: {
        load: (data: Buffer | Uint8Array) => Promise<{
          getPages: () => Array<{ getSize: () => { width: number; height: number } }>;
          copyPages: (src: unknown, indices: number[]) => Promise<unknown[]>;
        }>;
        create: () => Promise<{
          copyPages: (src: unknown, indices: number[]) => Promise<unknown[]>;
          addPage: (page: unknown) => void;
          save: () => Promise<Uint8Array>;
        }>;
      };
    }>);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharpModule = await (Function('return import("sharp")')() as Promise<{
      default: (input: Buffer | Uint8Array, opts?: { density?: number }) => {
        png: () => { toBuffer: () => Promise<Buffer> };
        metadata: () => Promise<{ width?: number; height?: number }>;
        extract: (opts: { left: number; top: number; width: number; height: number }) => {
          png: () => { toBuffer: () => Promise<Buffer> };
        };
      };
    }>);
    const sharp = sharpModule.default;

    const { PDFDocument } = pdfLib;

    // Load the PDF and extract the target page
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const pageIndex = pageNumber - 1;

    if (pageIndex < 0 || pageIndex >= pages.length) {
      return null;
    }

    const page = pages[pageIndex];
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Create a single-page PDF containing just the target page
    const singlePageDoc = await PDFDocument.create();
    const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pageIndex]);
    singlePageDoc.addPage(copiedPage);
    const singlePageBytes = await singlePageDoc.save();

    // Attempt to render the single-page PDF via sharp (requires libvips PDF support)
    const fullPageImage = await sharp(Buffer.from(singlePageBytes), {
      density: 150, // 150 DPI for reasonable quality/size balance
    }).png().toBuffer();

    // Get the rendered image dimensions
    const metadata = await sharp(fullPageImage).metadata();
    const imgWidth = metadata.width ?? Math.round(pageWidth * 2);
    const imgHeight = metadata.height ?? Math.round(pageHeight * 2);

    // Compute pixel crop region from normalized coordinates
    const cropLeft = Math.round(left * imgWidth);
    const cropTop = Math.round(top * imgHeight);
    const cropWidth = Math.round(width * imgWidth);
    const cropHeight = Math.round(height * imgHeight);

    // Validate crop dimensions
    if (cropWidth <= 0 || cropHeight <= 0) return null;
    if (cropLeft + cropWidth > imgWidth || cropTop + cropHeight > imgHeight) return null;

    // Extract the figure region
    const croppedBuffer = await sharp(fullPageImage)
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .png()
      .toBuffer();

    return croppedBuffer;
  } catch {
    // Any failure in rendering → return null, caller will use placeholder
    return null;
  }
}

/**
 * Upload a figure PNG to S3.
 *
 * Returns true on success, false on failure.
 */
async function uploadFigureToS3(
  s3Client: S3Client,
  bucketName: string,
  s3Key: string,
  pngBuffer: Buffer,
): Promise<boolean> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: pngBuffer,
        ContentType: 'image/png',
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract LAYOUT_FIGURE regions from a source PDF and upload as PNG to S3.
 *
 * Processing rules:
 * - Only figures with Width > 0.02 AND Height > 0.02 are extracted (Req 3.1)
 * - S3 key: `figures/{documentId}/figure-{pageNumber}-{figureIndex}.png` (Req 3.2)
 * - Image node at reading-order position (Req 3.3)
 * - Placeholder on any failure: undersized, render error, S3 upload failure (Req 3.4)
 * - Total extraction time capped at 30 seconds (Req 3.5)
 * - Max 20 figures per document; remainder get placeholders (Req 3.6)
 *
 * @param figureBlocks - LAYOUT_FIGURE blocks from Textract (in reading order)
 * @param pdfBuffer - Original source PDF as a Buffer
 * @param documentId - Unique document identifier for S3 key construction
 * @param s3Client - Configured AWS S3 client
 * @param bucketName - Target S3 bucket name
 * @returns Array of FigureResult in the same order as input figureBlocks
 */
export async function extractFigures(
  figureBlocks: Block[],
  pdfBuffer: Buffer,
  documentId: string,
  s3Client: S3Client,
  bucketName: string,
): Promise<FigureResult[]> {
  const results: FigureResult[] = [];
  const startTime = Date.now();
  let extractedCount = 0;

  for (let i = 0; i < figureBlocks.length; i++) {
    const block = figureBlocks[i];

    // Requirement 3.5: Check time budget before each extraction
    const elapsed = Date.now() - startTime;
    if (elapsed >= EXTRACTION_TIME_BUDGET_MS) {
      // Time budget exceeded — all remaining figures get placeholders
      results.push({ node: placeholderNode() });
      continue;
    }

    // Requirement 3.4: Undersized figures get placeholders
    if (!meetsMinimumSize(block)) {
      results.push({ node: placeholderNode() });
      continue;
    }

    // Requirement 3.6: Beyond max limit get placeholders
    if (extractedCount >= MAX_FIGURES_PER_DOCUMENT) {
      results.push({ node: placeholderNode() });
      continue;
    }

    // Compute S3 key (Requirement 3.2)
    const pageNumber = block.Page ?? 1;
    const s3Key = computeFigureS3Key(documentId, pageNumber, i);

    // Attempt extraction
    const bbox = block.Geometry?.BoundingBox;
    if (!bbox) {
      results.push({ node: placeholderNode() });
      continue;
    }

    const pngBuffer = await renderFigureRegion(
      pdfBuffer,
      pageNumber,
      bbox.Left ?? 0,
      bbox.Top ?? 0,
      bbox.Width ?? 0,
      bbox.Height ?? 0,
    );

    // Requirement 3.4: Render failure → placeholder
    if (!pngBuffer) {
      results.push({ node: placeholderNode() });
      continue;
    }

    // Upload to S3
    const uploaded = await uploadFigureToS3(s3Client, bucketName, s3Key, pngBuffer);

    // Requirement 3.4: Upload failure → placeholder
    if (!uploaded) {
      results.push({ node: placeholderNode() });
      continue;
    }

    // Success: produce image node (Requirement 3.3)
    extractedCount++;
    results.push({ node: imageNode(s3Key), s3Key });
  }

  return results;
}
