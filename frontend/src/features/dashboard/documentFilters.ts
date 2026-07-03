/**
 * Pure helpers for the "My Documents" dashboard (task 19.1).
 *
 * The dashboard cards surface each Document's Topic (the "Writing Topic" custom
 * metadata value — product decision 1 / frontend steering §4 "content tag") and
 * Status, with client-side search and status filtering. The search + filter
 * logic is factored out here so it is unit-testable independent of rendering.
 */
import type { Document, DocumentStatus } from '@wren/types';

/**
 * The custom metadata key the dashboard reads a Document's Topic from. Kept in
 * sync with the seeded field in `features/documents/documentMetadataConfig.ts`
 * (`DEFAULT_METADATA_FIELDS`). "Location Reference" is intentionally not used
 * (product decision 1).
 */
export const WRITING_TOPIC_METADATA_KEY = 'Writing Topic';

/** Reads a Document's Topic from its custom metadata, or `undefined` if unset. */
export function getDocumentTopic(document: Document): string | undefined {
  const topic = document.metadata[WRITING_TOPIC_METADATA_KEY];
  return topic?.trim() ? topic : undefined;
}

/** Sentinel meaning "no status filter applied". */
export const ALL_STATUSES = 'all' as const;
export type StatusFilterValue = typeof ALL_STATUSES | DocumentStatus;

export interface DocumentFilterCriteria {
  /** Case-insensitive substring matched against name and Topic. */
  readonly search: string;
  readonly status: StatusFilterValue;
}

/**
 * Filters documents by a free-text search (over name + Topic) and an optional
 * status. Empty/whitespace search matches everything; `ALL_STATUSES` disables
 * the status filter.
 */
export function filterDocuments(
  documents: readonly Document[],
  { search, status }: DocumentFilterCriteria,
): Document[] {
  const needle = search.trim().toLowerCase();

  return documents.filter((document) => {
    if (status !== ALL_STATUSES && document.status !== status) {
      return false;
    }
    if (needle === '') {
      return true;
    }
    const haystack = [document.name, getDocumentTopic(document) ?? '']
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
