/**
 * Debounced content-only draft autosave with unload flush and retry.
 *
 * Transient failures (network, 5xx) are retried with backoff. A server
 * `OVER_SIZE_LIMIT` rejection is not retried — resending the same content
 * cannot succeed — and surfaces as the `'over-limit'` status instead. The next
 * edit schedules a normal save attempt.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { patchCurrentDraft } from '@/features/dashboard/dashboardApi';
import { parseOverSizeLimitError, type OverSizeLimitDetails } from '@/features/editor/wordLimit';
import { apiClient } from '@/services';
import { asTipTapDoc, stripAiMarksFromTipTapContent } from '@wren/types';

import type { JSONContent } from '@tiptap/react';
import type { Draft, TipTapDoc } from '@wren/types';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'over-limit';

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
  /**
   * Details of the most recent `OVER_SIZE_LIMIT` rejection. Kept while the
   * user edits (so the server's limit stays known) and cleared by the next
   * successful save or a baseline reset.
   */
  readonly overLimit: OverSizeLimitDetails | null;
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
  const [overLimit, setOverLimit] = useState<OverSizeLimitDetails | null>(null);
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
      setOverLimit(null);
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
        setOverLimit(null);
        setStatus((s) => (s === 'dirty' || s === 'error' || s === 'over-limit' ? 'saved' : s));
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
        setOverLimit(null);
        setStatus('saved');
        if (draft) {
          onSavedRef.current?.(draft);
        }
        return true;
      } catch (error) {
        const sizeRejection = parseOverSizeLimitError(error);
        if (sizeRejection) {
          // Retrying identical content cannot succeed. Leave dirtyRef set so the
          // next edit (or flush/Retry) attempts a normal save.
          retryAttemptRef.current = 0;
          clearTimer();
          setOverLimit(sizeRejection);
          setStatus('over-limit');
          return false;
        }
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
    if (dirtyRef.current || status === 'error' || status === 'over-limit') {
      await persist();
    }
  }, [clearTimer, persist, status]);

  return { status, overLimit, retry, flush };
}
