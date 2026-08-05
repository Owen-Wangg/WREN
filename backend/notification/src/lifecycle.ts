/**
 * Notification lifecycle state machine.
 *
 * Valid transitions: unread → read, unread → dismissed, read → dismissed.
 * `dismissed` is terminal — no transition out of it.
 * All transitions are idempotent: repeating an already-applied transition
 * returns success without error (REQ-NOTIF-DATA-01, REQ-NOTIF-MULTISESSION-01).
 */
import type { NotificationState } from './types.js';

/** Valid (from, to) transitions. */
const VALID_TRANSITIONS: ReadonlySet<string> = new Set([
  'unread:read',
  'unread:dismissed',
  'read:dismissed',
]);

export interface TransitionResult {
  success: boolean;
  /** True when the notification was already in the target state (no-op). */
  alreadyInState: boolean;
  error?: string;
}

/**
 * Determine whether a state transition is valid.
 * Returns a TransitionResult indicating success, no-op (idempotent), or rejection.
 */
export function lifecycleStateMachine(
  currentState: NotificationState,
  requestedState: NotificationState,
): TransitionResult {
  // Idempotent: already in requested state
  if (currentState === requestedState) {
    return { success: true, alreadyInState: true };
  }

  // Check the transition is in the valid set
  const key = `${currentState}:${requestedState}`;
  if (VALID_TRANSITIONS.has(key)) {
    return { success: true, alreadyInState: false };
  }

  // Invalid transition
  return {
    success: false,
    alreadyInState: false,
    error: `Invalid state transition: '${currentState}' → '${requestedState}'. Allowed transitions: unread→read, unread→dismissed, read→dismissed.`,
  };
}

/**
 * Check whether a given state is terminal (no outgoing transitions).
 */
export function isTerminalState(state: NotificationState): boolean {
  return state === 'dismissed';
}
