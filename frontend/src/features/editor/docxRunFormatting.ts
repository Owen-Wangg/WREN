/**
 * Word run-formatting resolution for `.docx` import.
 *
 * `officeparser` (7.2.3) computes each run's `formatting` incorrectly in two
 * ways that make imported documents look unlike the original:
 *
 *   1. It applies the paragraph *mark* properties (`w:pPr/w:rPr` — the
 *      formatting of the invisible ¶ glyph) to every run in the paragraph,
 *      so text that is plain in Word comes back bold / resized.
 *   2. It ignores the style cascade — `w:docDefaults`, the default paragraph
 *      style, and `w:basedOn` chains — so runs without direct `w:sz` fall
 *      back to the editor's default size while their neighbours keep an
 *      explicit one.
 *
 * The browser build of `officeparser` is a single minified bundle, so instead
 * of patching it we re-resolve each run here from the paragraph's raw
 * `<w:p>` XML (`includeRawContent`) plus `word/styles.xml` and the theme,
 * following the OOXML cascade:
 *
 *   docDefaults → paragraph style chain ⊕ character style chain → direct rPr
 *
 * where ⊕ applies the spec's toggle rule (bold/italic/strike set by both the
 * paragraph and character style cancel out).
 */
import { strFromU8, unzipSync } from 'fflate';

/** Same shape `officeparser` uses for `OfficeContentNode.formatting`. */
export interface ResolvedRunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  size?: string;
  font?: string;
  color?: string;
  backgroundColor?: string;
}

/** A cascade layer: `false` means "explicitly turned off at this level". */
type FormattingLayer = {
  [K in keyof ResolvedRunFormatting]?: ResolvedRunFormatting[K] | false;
};

/** One `w:t` in source order with its resolved formatting. */
export interface ResolvedTextRun {
  text: string;
  formatting: ResolvedRunFormatting;
}

interface StyleDef {
  basedOn?: string;
  rPr: FormattingLayer;
}

interface ThemeFonts {
  major?: string;
  minor?: string;
}

const TOGGLE_KEYS = ['bold', 'italic', 'strikethrough'] as const;

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#00008b',
  darkCyan: '#008b8b',
  darkGreen: '#006400',
  darkMagenta: '#8b008b',
  darkRed: '#8b0000',
  darkYellow: '#808000',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  black: '#000000',
  white: '#ffffff',
};

function parseXml(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

function childElements(parent: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (!name || el.nodeName === name) out.push(el);
  }
  return out;
}

function childElement(parent: Element | null | undefined, name: string): Element | undefined {
  if (!parent) return undefined;
  return childElements(parent, name)[0];
}

function onOffValue(el: Element): boolean {
  const val = el.getAttribute('w:val');
  if (val === null) return true;
  return !(val === '0' || val === 'false' || val === 'off');
}

function themeFontFor(rFonts: Element, theme: ThemeFonts): string | undefined {
  const ref = rFonts.getAttribute('w:asciiTheme') ?? rFonts.getAttribute('w:hAnsiTheme');
  if (!ref) return undefined;
  if (ref.startsWith('major')) return theme.major;
  if (ref.startsWith('minor')) return theme.minor;
  return undefined;
}

/** Reads one `w:rPr` element into a cascade layer (direct children only). */
function layerFromRPr(rPr: Element | undefined, theme: ThemeFonts): FormattingLayer {
  const layer: FormattingLayer = {};
  if (!rPr) return layer;

  const b = childElement(rPr, 'w:b');
  if (b) layer.bold = onOffValue(b);
  const i = childElement(rPr, 'w:i');
  if (i) layer.italic = onOffValue(i);
  const strike = childElement(rPr, 'w:strike') ?? childElement(rPr, 'w:dstrike');
  if (strike) layer.strikethrough = onOffValue(strike);

  const u = childElement(rPr, 'w:u');
  if (u) layer.underline = u.getAttribute('w:val') !== 'none';

  const sz = childElement(rPr, 'w:sz')?.getAttribute('w:val');
  if (sz) {
    const halfPoints = Number.parseInt(sz, 10);
    if (Number.isFinite(halfPoints) && halfPoints > 0) layer.size = `${halfPoints / 2}pt`;
  }

  const rFonts = childElement(rPr, 'w:rFonts');
  if (rFonts) {
    const font =
      rFonts.getAttribute('w:ascii') ?? rFonts.getAttribute('w:hAnsi') ?? themeFontFor(rFonts, theme);
    if (font) layer.font = font;
  }

  const color = childElement(rPr, 'w:color')?.getAttribute('w:val');
  if (color) layer.color = color === 'auto' ? false : `#${color}`;

  const shdFill = childElement(rPr, 'w:shd')?.getAttribute('w:fill');
  if (shdFill) layer.backgroundColor = shdFill === 'auto' ? false : `#${shdFill}`;
  const highlight = childElement(rPr, 'w:highlight')?.getAttribute('w:val');
  if (highlight) {
    layer.backgroundColor = highlight === 'none' ? false : (HIGHLIGHT_COLORS[highlight] ?? false);
  }

  return layer;
}

function mergeLayers(...layers: FormattingLayer[]): FormattingLayer {
  const out: FormattingLayer = {};
  for (const layer of layers) {
    for (const key of Object.keys(layer) as Array<keyof FormattingLayer>) {
      const value = layer[key];
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Paragraph style ⊕ character style, honouring OOXML toggle properties. */
function combineStyleLayers(paragraph: FormattingLayer, character: FormattingLayer): FormattingLayer {
  const combined = mergeLayers(paragraph, character);
  for (const key of TOGGLE_KEYS) {
    if (paragraph[key] === true && character[key] === true) combined[key] = false;
  }
  return combined;
}

function finalizeLayer(layer: FormattingLayer): ResolvedRunFormatting {
  const out: ResolvedRunFormatting = {};
  if (layer.bold === true) out.bold = true;
  if (layer.italic === true) out.italic = true;
  if (layer.underline === true) out.underline = true;
  if (layer.strikethrough === true) out.strikethrough = true;
  if (typeof layer.size === 'string') out.size = layer.size;
  if (typeof layer.font === 'string') out.font = layer.font;
  if (typeof layer.color === 'string') out.color = layer.color;
  if (typeof layer.backgroundColor === 'string') out.backgroundColor = layer.backgroundColor;
  return out;
}

function parseThemeFonts(themeXml: string | undefined): ThemeFonts {
  if (!themeXml) return {};
  const doc = parseXml(themeXml);
  if (!doc) return {};
  const typeface = (tag: string) =>
    doc.getElementsByTagName(tag)[0]?.getElementsByTagName('a:latin')[0]?.getAttribute('typeface') ||
    undefined;
  return { major: typeface('a:majorFont'), minor: typeface('a:minorFont') };
}

/**
 * Resolves run formatting for paragraphs of one `.docx`, using its
 * `styles.xml` and theme. Construct via {@link createDocxRunFormatter}.
 */
export class DocxRunFormatter {
  private readonly styles = new Map<string, StyleDef>();
  private readonly resolvedStyles = new Map<string, FormattingLayer>();
  private docDefaults: FormattingLayer = {};
  private defaultParagraphStyleId: string | undefined;
  private defaultCharacterStyleId: string | undefined;
  private readonly theme: ThemeFonts;

  constructor(stylesXml: string | undefined, themeXml?: string) {
    this.theme = parseThemeFonts(themeXml);
    const doc = stylesXml ? parseXml(stylesXml) : null;
    if (!doc) return;
    const root = doc.documentElement;

    const rPrDefault = childElement(childElement(root, 'w:docDefaults'), 'w:rPrDefault');
    this.docDefaults = layerFromRPr(childElement(rPrDefault, 'w:rPr'), this.theme);

    for (const style of childElements(root, 'w:style')) {
      const id = style.getAttribute('w:styleId');
      if (!id) continue;
      const type = style.getAttribute('w:type');
      if (style.getAttribute('w:default') === '1') {
        if (type === 'paragraph' && !this.defaultParagraphStyleId) this.defaultParagraphStyleId = id;
        if (type === 'character' && !this.defaultCharacterStyleId) this.defaultCharacterStyleId = id;
      }
      this.styles.set(id, {
        basedOn: childElement(style, 'w:basedOn')?.getAttribute('w:val') ?? undefined,
        rPr: layerFromRPr(childElement(style, 'w:rPr'), this.theme),
      });
    }
    if (!this.defaultParagraphStyleId && this.styles.has('Normal')) {
      this.defaultParagraphStyleId = 'Normal';
    }
  }

  /** A style's own rPr merged over its `w:basedOn` ancestors. */
  private resolveStyle(id: string | undefined, seen = new Set<string>()): FormattingLayer {
    if (!id) return {};
    const cached = this.resolvedStyles.get(id);
    if (cached) return cached;
    const def = this.styles.get(id);
    if (!def || seen.has(id)) return {};
    seen.add(id);
    const resolved = mergeLayers(this.resolveStyle(def.basedOn, seen), def.rPr);
    this.resolvedStyles.set(id, resolved);
    return resolved;
  }

  /**
   * Every `w:t` of a paragraph's raw `<w:p>` XML, in source order, with its
   * resolved formatting. Returns `null` when the XML cannot be parsed.
   */
  resolveParagraph(paragraphXml: string): ResolvedTextRun[] | null {
    const doc = parseXml(paragraphXml);
    if (!doc) return null;
    const p = doc.documentElement;
    if (p.nodeName !== 'w:p') return null;

    const pStyleId =
      childElement(childElement(p, 'w:pPr'), 'w:pStyle')?.getAttribute('w:val') ??
      this.defaultParagraphStyleId;
    const paragraphLayer = this.resolveStyle(pStyleId);

    const runs: ResolvedTextRun[] = [];
    const visit = (el: Element) => {
      for (const child of childElements(el)) {
        const name = child.nodeName;
        // Not visible / not what officeparser emits for this paragraph.
        if (name === 'w:pPr' || name === 'w:del' || name === 'mc:Fallback' || name === 'w:p') {
          continue;
        }
        if (name === 'w:r' || name === 'm:r') {
          this.collectRun(child, paragraphLayer, runs);
          continue;
        }
        visit(child);
      }
    };
    visit(p);
    return runs;
  }

  private collectRun(run: Element, paragraphLayer: FormattingLayer, out: ResolvedTextRun[]): void {
    const rPr = childElement(run, 'w:rPr');
    const rStyleId =
      childElement(rPr, 'w:rStyle')?.getAttribute('w:val') ?? this.defaultCharacterStyleId;
    const formatting = finalizeLayer(
      mergeLayers(
        this.docDefaults,
        combineStyleLayers(paragraphLayer, this.resolveStyle(rStyleId)),
        layerFromRPr(rPr, this.theme),
      ),
    );
    for (const child of childElements(run)) {
      if (child.nodeName === 'w:t' || child.nodeName === 'm:t' || child.nodeName === 't') {
        out.push({ text: child.textContent ?? '', formatting });
      }
    }
  }
}

/**
 * Builds a {@link DocxRunFormatter} from `.docx` bytes. Returns `null` if the
 * archive cannot be read — callers keep officeparser's formatting then.
 */
export function createDocxRunFormatter(bytes: Uint8Array): DocxRunFormatter | null {
  try {
    const files = unzipSync(bytes, {
      filter: (file) => file.name === 'word/styles.xml' || /^word\/theme\/theme\d*\.xml$/.test(file.name),
    });
    const styles = files['word/styles.xml'];
    const themeName = Object.keys(files)
      .filter((name) => name.startsWith('word/theme/'))
      .sort()[0];
    const theme = themeName ? files[themeName] : undefined;
    return new DocxRunFormatter(
      styles ? strFromU8(styles) : undefined,
      theme ? strFromU8(theme) : undefined,
    );
  } catch {
    return null;
  }
}
