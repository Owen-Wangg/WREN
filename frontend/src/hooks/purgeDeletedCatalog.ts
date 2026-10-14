/**
 * Cache cleanup after an admin deletes a Department or Document Type.
 *
 * Both deletes cascade server-side (migration 0013): every student Document of
 * the deleted type(s) is removed together with its drafts and feedback. The app
 * runs a single QueryClient for every persona, so without this the Student view
 * keeps serving the cached document list and lets users open cards whose detail
 * endpoints now 404.
 */
import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from './queryKeys';

/**
 * Query keys for student-facing data that a catalog delete can invalidate.
 * `queryKeys.documents()` is a prefix of every per-document key (detail,
 * drafts, feedback, debrief, anchors, ...). The editor page also uses two
 * un-namespaced keys, listed explicitly.
 */
const STUDENT_CATALOG_KEYS: ReadonlyArray<readonly unknown[]> = [
  queryKeys.documents(),
  queryKeys.writingTypes(),
  queryKeys.organizations(),
  queryKeys.departments(),
  ['document'],
  ['document-draft'],
];

export async function purgeDeletedCatalogCaches(queryClient: QueryClient): Promise<void> {
  for (const queryKey of STUDENT_CATALOG_KEYS) {
    // Drop entries nobody is watching so the next mount shows a loading state
    // and fresh data, never the deleted cards.
    queryClient.removeQueries({ queryKey, type: 'inactive' });
  }
  // Anything still on screen refetches now.
  await Promise.all(
    STUDENT_CATALOG_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
