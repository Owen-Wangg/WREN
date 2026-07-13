/**
 * `<AnchoredFeedbackEditorContainer>` — data-fetching wrapper around
 * `<AnchoredFeedbackEditor>` (task 18.2). Fetches Feedback Items + Anchors for
 * a writing environment via `useFeedbackItems`/`useAnchors` and passes them
 * through as props, keeping `<AnchoredFeedbackEditor>` itself a plain,
 * easily-testable presentational component (no React Query dependency in its
 * render tests).
 */
import { AnchoredFeedbackEditor, type AnchoredFeedbackEditorProps } from './AnchoredFeedbackEditor';

import { useAnchors, useFeedbackItems } from '../useAnchoredFeedback';

export interface AnchoredFeedbackEditorContainerProps
  extends Omit<AnchoredFeedbackEditorProps, 'feedbackItems' | 'anchors'> {
  readonly environmentId: string;
}

export function AnchoredFeedbackEditorContainer({
  environmentId,
  ...editorProps
}: AnchoredFeedbackEditorContainerProps) {
  const feedbackItemsQuery = useFeedbackItems(environmentId);
  const anchorsQuery = useAnchors(environmentId);

  if (feedbackItemsQuery.isLoading || anchorsQuery.isLoading) {
    return (
      <p role="status" className="text-bodySmall text-text-secondary">
        Loading feedback…
      </p>
    );
  }

  if (feedbackItemsQuery.isError || anchorsQuery.isError) {
    return (
      <p role="alert" className="text-bodySmall text-signal-critical">
        Couldn't load feedback for this draft.
      </p>
    );
  }

  return (
    <AnchoredFeedbackEditor
      {...editorProps}
      feedbackItems={feedbackItemsQuery.data ?? []}
      anchors={anchorsQuery.data ?? []}
    />
  );
}
