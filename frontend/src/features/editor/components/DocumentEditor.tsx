/**
 * Document Editor - Task 3.2 + Task 4 (Feedback integration)
 * Textarea editor with Draft sync and async feedback generation polling
 */
import React, { useEffect, useState } from 'react';
import { useGetDocument, useSubmitDraft, usePollFeedbackStatus, useRequestFeedback, useGetFeedback } from '@/hooks';
import { draftToTiptapJSON, tiptapJSONToDraft, countWords, validateWordCount } from '../utils/documentParser';
import type { Draft } from '@wren/types';

export interface DocumentEditorProps {
  readonly documentId: string;
  readonly onDraftSaved?: (draft: Draft) => void;
}

export function DocumentEditor({ documentId, onDraftSaved }: DocumentEditorProps) {
  const [editorContent, setEditorContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedbackRequested, setFeedbackRequested] = useState(false);

  const getDocMutation = useGetDocument(documentId);
  const submitDraftMutation = useSubmitDraft();
  const feedbackStatusQuery = usePollFeedbackStatus(documentId);
  const feedbackQuery = useGetFeedback(documentId);
  const requestFeedbackMutation = useRequestFeedback();

  const document = getDocMutation.data;
  const currentDraft = document?.drafts?.[0];
  const wordCountError = document?.sizeLimitWords
    ? validateWordCount(editorContent, document.sizeLimitWords)
    : { valid: true };

  // Load draft on mount
  useEffect(() => {
    if (currentDraft) {
      const tiptapJson = draftToTiptapJSON(currentDraft);
      const { text } = tiptapJSONToDraft(tiptapJson, currentDraft.wordCount);
      setEditorContent(text);
    }
  }, [currentDraft]);

  // Update word count
  useEffect(() => {
    setWordCount(countWords(editorContent));
  }, [editorContent]);

  // When feedback generation completes, refetch feedback
  useEffect(() => {
    if (feedbackStatusQuery.data?.status === 'completed') {
      feedbackQuery.refetch();
    }
  }, [feedbackStatusQuery.data?.status, feedbackQuery]);

  const handleSaveDraft = async () => {
    if (!wordCountError.valid) {
      setError(wordCountError.message || 'Word count exceeded');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      const result = await submitDraftMutation.mutateAsync({
        documentId,
        source: {
          kind: 'paste',
          text: editorContent,
        },
      });

      onDraftSaved?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestFeedback = async () => {
    try {
      setError(null);
      setFeedbackRequested(true);
      await requestFeedbackMutation.mutateAsync(documentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request feedback');
      setFeedbackRequested(false);
    }
  };

  if (getDocMutation.isLoading) {
    return <div>Loading document...</div>;
  }

  if (getDocMutation.isError) {
    return <div>Error loading document</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{ padding: '1rem', borderBottom: '1px solid #ddd', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button onClick={handleSaveDraft} disabled={isSaving || submitDraftMutation.isPending}>
          {isSaving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={handleRequestFeedback}
          disabled={feedbackRequested && (feedbackStatusQuery.data?.status === 'queued' || feedbackStatusQuery.data?.status === 'processing') || requestFeedbackMutation.isPending}
        >
          {feedbackRequested && (feedbackStatusQuery.data?.status === 'queued' || feedbackStatusQuery.data?.status === 'processing') ? 'Generating Feedback...' : 'Request Feedback'}
        </button>
        {feedbackRequested && (feedbackStatusQuery.data?.status === 'queued' || feedbackStatusQuery.data?.status === 'processing') && (
          <span style={{ marginLeft: '1rem', fontSize: '0.9em', color: '#666' }}>
            Status: {feedbackStatusQuery.data?.status || 'queued'}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          Words: {wordCount}
          {document?.sizeLimitWords && ` / ${document.sizeLimitWords}`}
        </span>
      </div>

      {/* Status */}
      {document && (
        <div style={{ padding: '0.5rem 1rem', fontSize: '0.9em', color: '#666' }}>
          Status: {document.status}
          {currentDraft && ` • Draft v${currentDraft.versionNumber}`}
        </div>
      )}

      {/* Editor */}
      <textarea
        value={editorContent}
        onChange={(e) => setEditorContent(e.target.value)}
        style={{
          flex: 1,
          padding: '1rem',
          fontFamily: 'monospace',
          fontSize: '0.95em',
          lineHeight: '1.6',
          border: wordCountError.valid ? 'none' : '2px solid red',
        }}
      />

      {/* Error message */}
      {error && <div style={{ padding: '1rem', color: 'red', borderTop: '1px solid #ddd' }}>{error}</div>}
      {!wordCountError.valid && (
        <div style={{ padding: '1rem', color: 'red', borderTop: '1px solid #ddd' }}>
          ⚠️ {wordCountError.message}
        </div>
      )}
    </div>
  );
}
