/**
 * `<AnchoredFeedbackEditorContainer>` — data-fetching wrapper around
 * `<AnchoredFeedbackEditor>` (task 18.2). Fetches Feedback Items + Anchors for
 * a writing environment via `useDocumentFeedback` and passes them through as
 * props, keeping `<AnchoredFeedbackEditor>` itself a plain, easily-testable
 * presentational component (no React Query dependency in its render tests).
 */
import { AnchoredFeedbackEditor, type AnchoredFeedbackEditorProps } from './AnchoredFeedbackEditor';

import { useDocumentFeedback } from '../useAnchoredFeedback';

export interface AnchoredFeedbackEditorContainerProps
  extends Omit<AnchoredFeedbackEditorProps, 'feedbackItems' | 'anchors'> {
  readonly environmentId: string;
}

export function AnchoredFeedbackEditorContainer({
  environmentId,
  ...editorProps
}: AnchoredFeedbackEditorContainerProps) {
  const feedbackQuery = useDocumentFeedback(environmentId);

  // Always render the editor — feedback overlays once data arrives.
  // Never replace the editor with a loading/error message so the student
  // can keep writing while feedback loads in the background.
  return (
    <AnchoredFeedbackEditor
      {...editorProps}
      feedbackItems={feedbackQuery.data?.items ?? []}
      anchors={feedbackQuery.data?.anchors ?? []}
    />
  );
}
