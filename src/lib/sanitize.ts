/**
 * Input sanitization utilities.
 *
 * React already escapes all JSX output (no dangerouslySetInnerHTML in this app),
 * and Supabase-js uses parameterized queries, so the primary goal here is
 * clean data storage — stripping injected HTML/script tags and control
 * characters before anything touches the database.
 */

/**
 * Sanitize a single string value:
 * - Strip all HTML tags
 * - Remove ASCII control characters (except tab/newline)
 * - Trim leading/trailing whitespace
 * - Collapse internal runs of whitespace to a single space
 */
export function sanitizeString(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')                             // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // strip control chars
    .trim()
    .replace(/\s+/g, ' ');                               // normalize whitespace
}

/**
 * Recursively sanitize every string field in a plain object.
 * Non-string values (numbers, booleans, null, arrays) pass through unchanged,
 * except non-finite numbers (Infinity, NaN) which are coerced to null.
 */
export function sanitizePayload<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (typeof value === 'string') return [key, sanitizeString(value)];
      if (typeof value === 'number' && !Number.isFinite(value)) return [key, null];
      return [key, value];
    })
  ) as T;
}
