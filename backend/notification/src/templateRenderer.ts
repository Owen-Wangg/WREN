/**
 * Template rendering with HTML sanitization.
 *
 * Interpolates event context into a Notification_Type's display_template
 * (mustache-style `{{placeholder}}`). All dynamic values are sanitized via HTML
 * entity encoding before interpolation to prevent XSS
 * (REQ-NOTIF-CONTENT-SAFETY-01).
 *
 * On missing placeholder: renders with placeholder name visible and logs a
 * warning. Still persists — better to show a slightly degraded notification than
 * to lose it (design error-handling strategy).
 */

/** Characters that must be escaped to prevent HTML/script injection. */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

/**
 * Escape a string to prevent XSS in notification content.
 * All HTML special characters are entity-encoded.
 */
export function sanitizeValue(value: string): string {
  return value.replace(/[&<>"'/]/g, (char) => HTML_ENTITIES[char] ?? char);
}

/**
 * Regex matching mustache-style placeholders: {{name}}
 *
 * The name class `[^{}\s]+` excludes `{`, `}`, and whitespace. Excluding `{`
 * (in addition to the original `}` and `\s`) is what removes the polynomial
 * backtracking CodeQL flags (js/polynomial-redos): on an input such as `{{`
 * followed by many `{{!` repetitions, a name class that allowed `{` let the
 * engine re-enter the name at every `{{` offset while hunting for a closing
 * `}}` that never arrives. With `{` excluded, each `{{` can only ever begin a
 * fresh match attempt, so matching stays linear in the input length. The
 * surrounding `\s*` still trims any whitespace (including newlines) around the
 * name, preserving the original behavior for well-formed placeholders.
 */
const PLACEHOLDER_RE = /\{\{\s*([^{}\s]+)\s*\}\}/g;

export interface RenderResult {
  content: string;
  /** Placeholder names that were present in the template but missing from context. */
  missingPlaceholders: string[];
}

/**
 * Render a display template by interpolating sanitized context values.
 *
 * @param template - The display_template from the Notification_Type catalog.
 * @param context  - Key-value context from the notification event.
 * @returns The rendered content string and any missing placeholder names.
 */
export function renderTemplate(
  template: string,
  context: Record<string, string>,
): RenderResult {
  const missingPlaceholders: string[] = [];

  const content = template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const value = context[name];
    if (value === undefined || value === null) {
      missingPlaceholders.push(name);
      // Render with placeholder name visible so notification is not lost
      return `{{${name}}}`;
    }
    return sanitizeValue(value);
  });

  return { content, missingPlaceholders };
}

/**
 * Render an action URL template by interpolating context values (no HTML
 * escaping — URLs use percent-encoding at the caller level).
 */
export function renderActionUrl(
  template: string | null | undefined,
  context: Record<string, string>,
): string | null {
  if (!template) return null;

  const rendered = template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    const value = context[name];
    if (value === undefined || value === null) return `{{${name}}}`;
    return encodeURIComponent(value);
  });

  // Defense in depth: never emit a scheme-bearing URL (javascript:, https:, …).
  if (!rendered.startsWith('/') || rendered.startsWith('//') || rendered.includes(':')) {
    return null;
  }
  return rendered;
}
