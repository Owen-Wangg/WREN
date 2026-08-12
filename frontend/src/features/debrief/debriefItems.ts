/**
 * Helpers for splitting debrief items into What's Done Well vs Areas for Improvement.
 */
export function isStrengthItem(item: {
  kind: string;
  positiveNote?: string | null;
}): boolean {
  return item.kind === 'strength' || Boolean(item.positiveNote?.trim());
}

export function strengthDisplayText(item: {
  positiveNote?: string | null;
  questionText: string;
}): string {
  const note = item.positiveNote?.trim();
  return note || item.questionText;
}
