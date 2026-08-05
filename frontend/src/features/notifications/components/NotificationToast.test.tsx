/**
 * Tests for notification toast stack management.
 *
 * Feature: in-app-notifications (Wave 11)
 * Tests: toast queue behavior, max visible cap, overflow counting, dismiss
 */
import { renderHook, act } from '@testing-library/react';
import { useNotificationToastStack } from './NotificationToast';
import type { NotificationPayload } from '../types/notification';

function makeNotification(id: string): NotificationPayload {
  return {
    id,
    typeSlug: 'ai-debrief-ready',
    typeLabel: 'AI Debrief ready',
    renderedContent: `Notification ${id}`,
    actionUrl: null,
    createdAt: new Date().toISOString(),
  };
}

describe('useNotificationToastStack', () => {
  it('starts with empty toast list', () => {
    const { result } = renderHook(() => useNotificationToastStack());
    expect(result.current.toasts).toHaveLength(0);
    expect(result.current.overflowCount).toBe(0);
  });

  it('adds a toast via push', () => {
    const { result } = renderHook(() => useNotificationToastStack());
    act(() => {
      result.current.push(makeNotification('1'));
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toBe('1');
  });

  it('respects maxVisible cap (default 3)', () => {
    const { result } = renderHook(() => useNotificationToastStack());
    act(() => {
      result.current.push(makeNotification('1'));
      result.current.push(makeNotification('2'));
      result.current.push(makeNotification('3'));
      result.current.push(makeNotification('4'));
    });
    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.overflowCount).toBe(1);
  });

  it('removes a toast via dismiss', () => {
    const { result } = renderHook(() => useNotificationToastStack());
    act(() => {
      result.current.push(makeNotification('1'));
      result.current.push(makeNotification('2'));
    });
    act(() => {
      result.current.dismiss('1');
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toBe('2');
  });

  it('allows configurable maxVisible', () => {
    const { result } = renderHook(() =>
      useNotificationToastStack({ maxVisible: 2 }),
    );
    act(() => {
      result.current.push(makeNotification('1'));
      result.current.push(makeNotification('2'));
      result.current.push(makeNotification('3'));
    });
    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.overflowCount).toBe(1);
  });

  it('overflow count decreases when a toast is dismissed', () => {
    const { result } = renderHook(() =>
      useNotificationToastStack({ maxVisible: 2 }),
    );
    act(() => {
      result.current.push(makeNotification('1'));
      result.current.push(makeNotification('2'));
      result.current.push(makeNotification('3'));
    });
    expect(result.current.overflowCount).toBe(1);

    // Dismiss one visible toast — the overflow item should become visible
    act(() => {
      result.current.dismiss('1');
    });
    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.overflowCount).toBe(0);
  });

  it('returns configured duration', () => {
    const { result } = renderHook(() =>
      useNotificationToastStack({ duration: 8000 }),
    );
    expect(result.current.duration).toBe(8000);
  });

  it('defaults duration to 5000ms', () => {
    const { result } = renderHook(() => useNotificationToastStack());
    expect(result.current.duration).toBe(5000);
  });

  it('dismiss is a no-op for non-existent id', () => {
    const { result } = renderHook(() => useNotificationToastStack());
    act(() => {
      result.current.push(makeNotification('1'));
    });
    act(() => {
      result.current.dismiss('non-existent');
    });
    expect(result.current.toasts).toHaveLength(1);
  });
});
