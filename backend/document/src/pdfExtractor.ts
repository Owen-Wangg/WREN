/**
 * PDF text-extraction port (design "Document / Draft Service — Ingestion &
 * extraction": best-effort extraction via **LiteParse**, `run-llama/liteparse`,
 * Apache-2.0 — local, in-Lambda, layout-aware parsing with no cloud API calls
 * and no per-page cost; REQ-DOC-SUBMIT-01 criteria 3, 4).
 *
 * ---------------------------------------------------------------------------
 * LITEPARSE IS DIRECTLY USABLE FROM NODE — NO CROSS-RUNTIME BRIDGE NEEDED
 * ---------------------------------------------------------------------------
 * LiteParse's core is a Rust crate (`liteparse`) that ships first-class,
 * native-addon (napi-rs) language bindings — not just Python. The published
 * npm package `@llamaindex/liteparse` (Apache-2.0) wraps that same Rust core
 * for Node.js via prebuilt platform binaries (darwin-{x64,arm64},
 * linux-{x64,arm64}-gnu, linux-x64-musl, win32-{x64,arm64}-msvc), selected
 * automatically through `optionalDependencies` — no separate Python process,
 * Lambda layer, or cross-runtime call is required. `linux-x64-gnu` /
 * `linux-arm64-gnu` cover Lambda's Amazon-Linux Node 22 runtime directly.
 *
 * This was verified directly (not assumed) before wiring it in:
 *   - `npm view @llamaindex/liteparse license` → `Apache-2.0`.
 *   - Installed the package and called `new LiteParse().parse(bytes)` against
 *     hand-built PDF fixtures (valid single/multi-paragraph text, a
 *     no-text-layer page, a corrupt/non-PDF buffer, and an empty buffer).
 *     Valid PDFs returned real extracted text with paragraph-preserving line
 *     breaks (a large vertical gap between two lines of text is rendered as a
 *     blank line, matching `segmentParagraphs`'s boundary rule); the
 *     no-text-layer page returned `""`; the corrupt/non-PDF and empty buffers
 *     both threw. All of those outcomes map directly onto the fallback
 *     contract this module and `ingestion.ts` already implement.
 *
 * The one caveat: `@llamaindex/liteparse`'s published package is ESM-only
 * (`"type": "module"`, `exports` only an `import` condition) while this
 * package compiles to CommonJS (`tsconfig.json`: `"module": "CommonJS"`, per
 * the Node 22 Lambda baseline). CommonJS CAN consume an ESM-only package via
 * the dynamic `import()` expression — Node resolves it at runtime regardless
 * of the calling module's format — but TypeScript's CommonJS emit rewrites a
 * literal `import(...)` expression down to `require(...)`, which then fails
 * on an ESM-only package (`ERR_PACKAGE_PATH_NOT_EXPORTED`; verified directly
 * against the built output before choosing this workaround). {@link
 * getParser} therefore obtains `import()` indirectly, through a
 * `Function`-constructed wrapper, which TypeScript cannot see and rewrite —
 * a documented, narrowly-scoped technique for exactly this ESM-from-CJS
 * interop gap, not a general pattern to reuse elsewhere in this codebase.
 * `getParser` caches the constructed parser, once, and reuses it across warm
 * Lambda invocations.
 *
 * OCR is left OFF (`ocrEnabled: false`): LiteParse's OCR path renders pages
 * to images and runs Tesseract, which needs `.traineddata` files present on
 * disk (`TESSDATA_PREFIX`) — bundling those is a future infrastructure task
 * (a Lambda layer), not part of this ingestion/segmentation task. With OCR
 * off, extraction is pure text-layer extraction: fast, and it still recovers
 * text from any PDF that has a real text layer (the overwhelming majority of
 * `.docx`-exported and word-processor-produced PDFs this feature targets).
 * Purely scanned/image-only PDFs correctly yield no text and fall through to
 * the `.docx`/paste fallback (Requirement 6.1.4) — see `ingestion.ts`.
 *
 * RUNNING TESTS: ts-jest still executes this file's compiled CommonJS, so
 * `getParser`'s indirect `import()` reaches Node's real ESM loader — which
 * requires `--experimental-vm-modules` under Jest (Jest's own module
 * registry otherwise intercepts dynamic `import()` calls). The repo root
 * `npm test` / `npm run test:ci` scripts set this flag already; running
 * `npx jest` directly without it will fail this file's tests with
 * `A dynamic import callback was invoked without --experimental-vm-modules`.
 */

/** Best-effort PDF text extraction. Implementations MAY throw on failure. */
export interface PdfExtractor {
  extract(bytes: Buffer): Promise<string>;
}

/** The subset of the `@llamaindex/liteparse` module surface this file uses. */
interface LiteParseModule {
  LiteParse: new (config?: { ocrEnabled?: boolean }) => {
    parse(input: Buffer | Uint8Array): Promise<{ text: string }>;
  };
}

/**
 * A genuine dynamic `import()`, obtained indirectly so TypeScript's
 * CommonJS emit cannot rewrite it to `require()` (see the module comment
 * above). This is the ONLY way this CommonJS package can load the ESM-only
 * `@llamaindex/liteparse` module.
 */
const importEsm = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<unknown>;

/**
 * Lazily imports the ESM-only `@llamaindex/liteparse` package and caches the
 * constructed parser so repeated Lambda invocations on a warm container
 * reuse it instead of re-importing.
 */
let cachedParser: InstanceType<LiteParseModule['LiteParse']> | undefined;

async function getParser(): Promise<InstanceType<LiteParseModule['LiteParse']>> {
  if (!cachedParser) {
    const mod = (await importEsm('@llamaindex/liteparse')) as LiteParseModule;
    cachedParser = new mod.LiteParse({ ocrEnabled: false });
  }
  return cachedParser;
}

/**
 * `LiteParse`-backed extractor (see the module comment above). Local,
 * in-Lambda, Apache-2.0-licensed extraction — no cloud API calls, no
 * per-page cost. Throws on unparseable input (corrupt bytes, non-PDF magic,
 * empty buffer); returns `""` for a PDF with no recoverable text layer
 * (e.g. a purely scanned page with OCR disabled). Both outcomes are handled
 * uniformly by the `ingestUpload` fallback contract in `ingestion.ts`.
 */
export class LiteParsePdfExtractor implements PdfExtractor {
  public async extract(bytes: Buffer): Promise<string> {
    const parser = await getParser();
    const result = await parser.parse(bytes);
    return result.text;
  }
}
