/**
 * No-leak validation for Student-targeted Notification_Types.
 *
 * Rejects Notification_Type definitions that would leak quantitative data to
 * Students. Scans the displayTemplate for placeholders bound to numeric/count/
 * score fields (REQ-NOTIF-NOLEAK-01).
 *
 * Applied on both create and update of Notification_Type catalog entries
 * when `targetRoles` includes 'Student' (REQ-NOTIF-CATALOG-GOVERN-01).
 */
import type { TargetRole } from './types.js';

export interface NoLeakValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Patterns that match numeric-bound placeholders in display templates.
 * These indicate per-Student quantitative indicators which are prohibited
 * in Student-facing notifications.
 */
const NUMERIC_PATTERNS: RegExp[] = [
  // Exact known numeric field names
  /\{\{\s*(score|count|total|number|quantity|numItems|itemCount|feedbackCount|rating|percentage|percent|avg|average|sum|min|max)\s*\}\}/gi,
  // Fields ending in common numeric suffixes
  /\{\{\s*\w*(Score|Count|Total|Number|Qty|Rating|Percentage|Percent)\s*\}\}/g,
];

/**
 * Validate that a Notification_Type display template does not contain numeric
 * placeholders when the type targets Students.
 *
 * @param displayTemplate - The template string to validate.
 * @param targetRoles     - The roles this type targets.
 * @returns Validation result with any violating placeholder strings.
 */
export function validateNoLeakConstraint(
  displayTemplate: string,
  targetRoles: TargetRole[],
): NoLeakValidationResult {
  // Only enforce for Student-targeted types
  if (!targetRoles.includes('Student')) {
    return { valid: true, violations: [] };
  }

  const violations: string[] = [];

  for (const pattern of NUMERIC_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    const matches = displayTemplate.matchAll(pattern);
    for (const match of matches) {
      if (!violations.includes(match[0])) {
        violations.push(match[0]);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
