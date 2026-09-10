const DEFAULT_PBT_RUNS = 25;

/**
 * Parse the optional fast-check run-count override.
 * Missing, blank, malformed, non-positive, and unsafe integer values use the
 * quick local default so an accidental environment value cannot slow tests.
 */
export function parsePbtRuns(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return DEFAULT_PBT_RUNS;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PBT_RUNS;
}

/** Default fast-check examples per property; set PBT_RUNS=100 for a full run. */
export const PBT_RUNS = parsePbtRuns(process.env.PBT_RUNS);
