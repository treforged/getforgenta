/**
 * vercel.json -> Cloudflare Workers static-asset `_headers` (ask 8a5268d9).
 *
 * ⚠️ vercel.json STAYS THE ONE SOURCE OF TRUTH until Vercel is shut down. Two hand-kept copies of
 * the CSP is two chances to disagree, and the copy nobody reads is the one that drifts (the
 * landing-proof check already caught prod's CSP missing itunes.apple.com once). So the Cloudflare
 * file is DERIVED at build time, never edited.
 *
 * Only the source shapes vercel.json uses today are translated. Anything else THROWS, so a new
 * Vercel rule fails the Cloudflare build instead of silently not applying there.
 *
 * Deliberately NOT translated, and handled elsewhere (docs/cloudflare-move-plan.md):
 *   - `rewrites` (SPA fallback): wrangler.jsonc `not_found_handling: single-page-application`.
 *     Cloudflare serves index.html only for NAVIGATION requests, so a missing /assets chunk is a
 *     404, never HTML - the same guarantee the `(?!assets/)` lookahead gives on Vercel.
 *   - `redirects` (host app.treforged.com): `_redirects` cannot match on host; it is a Cloudflare
 *     Redirect Rule, set in the dashboard at cutover.
 *   - `ignoreCommand`: Workers Builds uses Build Watch Paths instead.
 */

// Cloudflare's documented static-asset limits (developers.cloudflare.com/workers/platform/limits,
// read 2026-10-08): 100 _headers rules, 2,000 characters per line.
export const MAX_HEADER_RULES = 100;
export const MAX_LINE_CHARS = 2000;

/** Vercel path-to-regexp source -> Cloudflare _headers URL pattern. */
export function toCloudflarePath(source) {
  if (source === '/(.*)') return '/*';
  const prefix = source.match(/^(\/[A-Za-z0-9._\-/]*\/)\(\.\*\)$/);
  if (prefix) return `${prefix[1]}*`;
  if (/^\/[A-Za-z0-9._\-/]*$/.test(source)) return source;
  throw new Error(`cloudflare-assets: no translation for Vercel header source "${source}"`);
}

/** Build the `_headers` text from a parsed vercel.json. */
export function headersFileFromVercel(vercel) {
  const rules = vercel.headers ?? [];
  if (rules.length > MAX_HEADER_RULES) {
    throw new Error(`cloudflare-assets: ${rules.length} header rules > ${MAX_HEADER_RULES}`);
  }
  const blocks = rules.map((rule) => {
    if (rule.has || rule.missing) {
      throw new Error(`cloudflare-assets: conditional header rule "${rule.source}" has no _headers form`);
    }
    const lines = [toCloudflarePath(rule.source)];
    for (const { key, value } of rule.headers) {
      const line = `  ${key}: ${value}`;
      if (line.length > MAX_LINE_CHARS) {
        throw new Error(`cloudflare-assets: ${key} line is ${line.length} chars > ${MAX_LINE_CHARS}`);
      }
      lines.push(line);
    }
    return lines.join('\n');
  });
  return [
    '# GENERATED from vercel.json by scripts/cloudflare-prepare.mjs - do not edit.',
    ...blocks,
    '',
  ].join('\n');
}
