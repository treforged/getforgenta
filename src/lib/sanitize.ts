/**
 * Input sanitization utilities.
 *
 * React already escapes all JSX output (no dangerouslySetInnerHTML in this app; the PDF export escapes its own),
 * and Supabase-js uses parameterized queries, so the primary goal here is
 * clean data storage — stripping injected HTML/script tags and control
 * characters before anything touches the database.
 */

/**
 * Strip HTML tags to a fixed point (re-runs until no more matches), so a tag
 * straddling a removed match (e.g. `<scr<script>ipt>`) can't survive a single pass.
 */
function stripHtmlTags(value: string): string {
  let result = value;
  let previous: string;
  do {
    previous = result;
    result = previous.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
}

/**
 * Sanitize a single string value:
 * - Strip all HTML tags
 * - Remove ASCII control characters (tab and newline survive this step)
 * - Trim leading/trailing whitespace
 * - Collapse internal runs of whitespace, INCLUDING newlines, to a single space
 */
export function sanitizeString(value: string): string {
  return stripHtmlTags(value)
    // eslint-disable-next-line no-control-regex -- intentional: this strips control chars
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')  // strip control chars
    .trim()
    .replace(/\s+/g, ' ');                               // normalize whitespace
}

/**
 * Sanitize every string in a payload, INCLUDING inside nested plain objects and arrays - jsonb
 * columns such as `accounts.balance_tranches` carry user-typed labels (2026-10-07). Non-finite
 * numbers (Infinity, NaN) become null; other non-strings pass through. Object keys are not touched.
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeValue(v)]));
  }
  return value;
}

export function sanitizePayload<T extends Record<string, unknown>>(obj: T): T {
  return sanitizeValue(obj) as T;
}
