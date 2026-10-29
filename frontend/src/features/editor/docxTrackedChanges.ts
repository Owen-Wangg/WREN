/**
 * Accept tracked changes in a `.docx` before `officeparser` reads it.
 *
 * `officeparser` walks into any element it doesn't recognise, so revision
 * markup leaks into the import:
 * - `w:moveFrom` holds the original copy of moved text as ordinary `w:t`
 *   runs, so every tracked move showed up twice (here and at `w:moveTo`).
 * - `w:pPrChange` / `w:rPrChange` hold the *previous* properties. A paragraph
 *   whose numbering was removed still has the old `w:numPr` in there, and
 *   `officeparser` picks the first `w:numPr` anywhere in the paragraph, so it
 *   imported as a numbered list item.
 * - `w:del` holds deleted runs (text in `w:delText`, which is skipped today,
 *   but drop the whole element so nothing deleted can resurface).
 *
 * Removing these yields the document as Word shows it with all changes
 * accepted. Inserted (`w:ins`) and moved-to (`w:moveTo`) content stays.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';

const STORIES = /^word\/(document|footnotes|endnotes)\.xml$/;

/** Elements removed with their content. None of them can nest in itself. */
const REVISION_TAGS = ['w:moveFrom', 'w:del', 'w:pPrChange', 'w:rPrChange'] as const;

/** Cheap pre-check so documents without revisions skip the re-zip. */
const HAS_REVISIONS = /<w:(?:moveFrom|del|pPrChange|rPrChange)[\s/>]/;

function stripElement(xml: string, tag: string): string {
  // `[\s/>]` after the name keeps `w:moveFromRangeStart` / `w:delText` intact.
  const selfClosing = new RegExp(`<${tag}(?=[\\s/>])[^>]*/>`, 'g');
  const paired = new RegExp(`<${tag}(?=[\\s>])[^>]*>[\\s\\S]*?</${tag}>`, 'g');
  return xml.replace(selfClosing, '').replace(paired, '');
}

/** Story XML with tracked changes accepted. */
export function acceptTrackedChangesXml(xml: string): string {
  if (!HAS_REVISIONS.test(xml)) return xml;
  return REVISION_TAGS.reduce(stripElement, xml);
}

/**
 * `.docx` bytes with tracked changes accepted in the body, footnotes and
 * endnotes. Returns the input unchanged when there is nothing to accept or
 * the archive can't be read (officeparser then reports the real error).
 */
export function acceptDocxTrackedChanges(bytes: Uint8Array): Uint8Array {
  let files: Unzipped;
  try {
    files = unzipSync(bytes);
  } catch {
    return bytes;
  }

  let changed = false;
  for (const name of Object.keys(files)) {
    if (!STORIES.test(name)) continue;
    const xml = strFromU8(files[name]!);
    const accepted = acceptTrackedChangesXml(xml);
    if (accepted !== xml) {
      files[name] = strToU8(accepted);
      changed = true;
    }
  }
  return changed ? zipSync(files) : bytes;
}
