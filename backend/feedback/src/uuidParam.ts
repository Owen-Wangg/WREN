/**
 * Guard UUID query params. The debrief UI uses the sentinel "none" when no
 * draft exists yet; Postgres rejects that as `22P02` on uuid columns.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuidParam(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return null;
  return UUID_RE.test(trimmed) ? trimmed : null;
}
