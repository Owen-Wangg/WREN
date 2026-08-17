/**
 * Decide whether regenerate must write a new draft version so the feedback
 * engine sees current paragraph segments (not a stale upload snapshot).
 */
export function segmentsNeedEngineSnapshot(
  editorSegments: ReadonlyArray<{ readonly index: number; readonly text: string }>,
  persistedSegments: unknown,
): boolean {
  if (!Array.isArray(persistedSegments)) return true;
  return JSON.stringify(persistedSegments) !== JSON.stringify(editorSegments);
}

export function editorContentDiffersFromPersisted(
  editorJson: string | null,
  persistedJson: string | null,
): boolean {
  if (persistedJson === null || editorJson === null) return true;
  return persistedJson !== editorJson;
}
