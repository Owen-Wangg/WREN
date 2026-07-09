/**
 * Error types for the Admin_Service.
 *
 * These make the two ways a privileged operation can fail explicit and
 * distinguishable by callers (the API layer maps them to 403 / 404):
 *
 *   - {@link AuthorizationError} — the actor's capability check failed. It MUST
 *     be thrown BEFORE any mutation, so a denied actor never changes state
 *     (Requirements 36.2, 36.3). It carries the audit-friendly `reason` from the
 *     capability matrix.
 *   - {@link NotFoundError} — the targeted Department / Document Type does not
 *     exist (raised only after the authorization check has passed).
 */

/** Thrown when the capability matrix denies an operation (deny-with-no-mutation). */
export class AuthorizationError extends Error {
  public constructor(reason: string) {
    super(reason);
    this.name = 'AuthorizationError';
  }
}

/** Thrown when a targeted entity does not exist. */
export class NotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
