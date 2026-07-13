/**
 * useDocumentEditor - Task 3.2
 * Combines document loading, editing, and draft submission
 */
import { useGetDocument, useSubmitDraft } from '@/hooks';
import { draftToTiptapJSON, tiptapJSONToDraft } from '../utils/documentParser';

export function useDocumentEditor(documentId: string) {
  const { data: document, isLoading, isError } = useGetDocument(documentId);
  const submitDraftMutation = useSubmitDraft();

  const currentDraft = document?.drafts?.[0];

  const getEditorContent = () => {
    if (!currentDraft) return '';
    const tiptapJson = draftToTiptapJSON(currentDraft);
    const { text } = tiptapJSONToDraft(tiptapJson, currentDraft.wordCount);
    return text;
  };

  const submitDraft = async (content: string) => {
    return submitDraftMutation.mutateAsync({
      documentId,
      source: {
        kind: 'paste',
        text: content,
      },
    });
  };

  return {
    document,
    currentDraft,
    isLoading,
    isError,
    getEditorContent,
    submitDraft,
    isSubmitting: submitDraftMutation.isPending,
  };
}
