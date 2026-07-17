/**
 * API error handler for Task 2.2: Handle 401/403 errors.
 *
 * 401 → Redirect to login
 * 403 → Show access denied
 * 429 → Show usage limit reached
 */
import type { ApiError } from '@/services/apiClient';

export interface ErrorHandlerContext {
  redirectToLogin: () => void;
  showAccessDenied: () => void;
  showUsageLimitReached: () => void;
  showError: (message: string) => void;
}

/**
 * Handle API errors by checking status code and taking appropriate action.
 */
export function handleApiError(error: ApiError, context: ErrorHandlerContext): void {
  if (error.kind === 'http') {
    switch (error.status) {
      case 401:
        // Unauthorized - token expired or invalid, redirect to login
        context.redirectToLogin();
        break;
      case 403:
        // Forbidden - user lacks permissions for this operation
        context.showAccessDenied();
        break;
      case 429:
        // Too Many Requests - usage limit exceeded
        context.showUsageLimitReached();
        break;
      default:
        context.showError(`Error: ${error.message}`);
    }
  } else if (error.kind === 'network') {
    context.showError('Network error - please check your connection');
  } else if (error.kind === 'validation') {
    context.showError('Invalid server response');
  }
}
