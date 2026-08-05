/**
 * Debounced content-only draft autosave with unload flush and retry.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { patchCurrentDraft } from '@/features/dashboard/dashboardApi';
import { apiClient } from '@/services';
import { asTipTapDoc, stripAiMarksFromTipTapContent } from '@wren/types';

import type { JSONContent } from '@tiptap/react';
import type { Draft, TipTapDoc } from '@wren/types';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DEBOUNCE_MS = 2500;
const RETRY_DELAYS_MS = [1000, 3000, 8000] as const;

export interface UseDraftAutosaveOptions {
  readonly documentId: string;
  readonly content: JSONContent;
  /** Header TipTap doc to persist alongside body content. */
  readonly header?: JSONContent | null;
  /** Footer TipTap doc to persist alongside body content. */
  readonly footer?: JSONContent | null;
  /** When false, skip autosave (e.g. while initial draft is still loading). */
  readonly enabled: boolean;
  /** Changes when the persisted draft baseline resets (e.g. new version id). */
  readonly baselineKey?: string;
  /** Called after a successful PATCH so callers can refresh React Query cache. */
  readonly onSaved?: (draft: Draft) => void;
}

export interface UseDraftAutosaveResult {
  readonly status: AutosaveStatus;
  readonly retry: () => void;
  /** Flush immediately (e.g. before milestone createDraft). */
  readonly flush: () => Promise<void>;
}

export function useDraftAutosave({
  documentId,
  content,
  header,
  footer,
  enabled,
  baselineKey,
  onSaved,
}: UseDraftAutosaveOptions): UseDraftAutosaveResult {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const contentRef = useRef(content);
  const headerRef = useRef(header);
  const footerRef = useRef(footer);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const skipNextDirtyRef = useRef(true);
  const lastSavedJsonRef = useRef<string | null>(null);
  const baselineRef = useRef(baselineKey);
  const onSavedRef = useRef(onSaved);
  const persistRef = useRef<() => Promise<boolean>>(async () => false);

  contentRef.current = content;
  headerRef.current = header;
  footerRef.current = footer;
  onSavedRef.current = onSaved;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (baselineKey !== baselineRef.current) {
      baselineRef.current = baselineKey;
      skipNextDirtyRef.current = true;
      dirtyRef.current = false;
      retryAttemptRef.current = 0;
      clearTimer();
      setStatus('idle');
    }
  }, [baselineKey, clearTimer]);

  const persist = useCallback(
    async (opts?: { keepalive?: boolean }): Promise<boolean> => {
      if (!enabled || !documentId || savingRef.current) return false;
      const cleaned = asTipTapDoc(stripAiMarksFromTipTapContent(contentRef.current));
      if (!cleaned) return false;

      const serialized = JSON.stringify(cleaned);
      if (serialized === lastSavedJsonRef.current) {
        dirtyRef.current = false;
        setStatus((s) => (s === 'dirty' || s === 'error' ? 'saved' : s));
        return true;
      }

      savingRef.current = true;
      setStatus('saving');
      try {
        const draft = await patchCurrentDraft(apiClient, documentId, cleaned as TipTapDoc, {
          keepalive: opts?.keepalive,
          header: headerRef.current != null ? (headerRef.current as TipTapDoc) : null,
          footer: footerRef.current != null ? (footerRef.current as TipTapDoc) : null,
        });
        lastSavedJsonRef.current = serialized;
        dirtyRef.current = false;
        retryAttemptRef.current = 0;
        setStatus('saved');
        if (draft) {
          onSavedRef.current?.(draft);
        }
        return true;
      } catch {
        setStatus('error');
        const attempt = retryAttemptRef.current;
        if (attempt < RETRY_DELAYS_MS.length && !opts?.keepalive) {
          const delay = RETRY_DELAYS_MS[attempt]!;
          retryAttemptRef.current = attempt + 1;
          clearTimer();
          timerRef.current = setTimeout(() => {
            void persistRef.current();
          }, delay);
        }
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [clearTimer, documentId, enabled],
  );

  persistRef.current = persist;

  const schedule = useCallback(() => {
    if (!enabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [clearTimer, enabled, persist]);

  useEffect(() => {
    if (!enabled) return;
    if (skipNextDirtyRef.current) {
      skipNextDirtyRef.current = false;
      lastSavedJsonRef.current = JSON.stringify(
        asTipTapDoc(stripAiMarksFromTipTapContent(content)) ?? content,
      );
      return;
    }
    dirtyRef.current = true;
    setStatus('dirty');
    schedule();
  }, [content, enabled, schedule]);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === 'hidden' && dirtyRef.current) {
        clearTimer();
        void persist({ keepalive: true });
      }
    };
    const flushOnUnload = () => {
      if (!dirtyRef.current) return;
      clearTimer();
      void persist({ keepalive: true });
    };
    document.addEventListener('visibilitychange', flushOnHide);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('beforeunload', flushOnUnload);
    return () => {
      document.removeEventListener('visibilitychange', flushOnHide);
      window.removeEventListener('pagehide', flushOnUnload);
      window.removeEventListener('beforeunload', flushOnUnload);
      clearTimer();
      // SPA navigation does not fire pagehide reliably — flush pending edits.
      if (dirtyRef.current) {
        void persistRef.current();
      }
    };
  }, [clearTimer, persist]);

  const retry = useCallback(() => {
    retryAttemptRef.current = 0;
    void persist();
  }, [persist]);

  const flush = useCallback(async () => {
    clearTimer();
    if (dirtyRef.current || status === 'error') {
      await persist();
    }
  }, [clearTimer, persist, status]);

  return { status, retry, flush };
}
