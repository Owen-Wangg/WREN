/**
 * Sanitize an untrusted value before writing it to a console log.
 *
 * Strips CR/LF and other C0/C1 control characters so attacker-influenced data
 * (e.g. a crafted WebSocket frame or subscription error) cannot forge or split
 * log lines (CWE-117, CodeQL js/log-injection), and caps length so an oversized
 * value cannot flood the console. Returns a string safe to interpolate into a
 * single log entry; callers should still parse/handle the original value
 * separately where needed.
 */
export function sanitizeForLog(value: unknown): string {
  const str = typeof value === 'string' ? value : String(value);
  // eslint-disable-next-line no-control-regex
  const stripped = str.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
  return stripped.length > 2000 ? stripped.slice(0, 2000) + '…' : stripped;
}
