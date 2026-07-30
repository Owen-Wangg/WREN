/**
 * Subscribe to TipTap selection/transactions so toolbar active/disabled
 * states stay in sync without lifting editor state into React Query.
 */
import { useEffect, useReducer } from 'react';

import type { Editor } from '@tiptap/react';

export function useToolbarEditorState(editor: Editor | null): number {
  const [revision, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => bump();
    editor.on('selectionUpdate', onUpdate);
    editor.on('transaction', onUpdate);
    return () => {
      editor.off('selectionUpdate', onUpdate);
      editor.off('transaction', onUpdate);
    };
  }, [editor]);

  return revision;
}
