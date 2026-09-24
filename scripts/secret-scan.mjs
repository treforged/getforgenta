/*
 * Refuse a commit that carries credential-shaped material, WHATEVER the ignore
 * file says.
 *
 * PORTED from tre-forged-conductor@6097b08 (2026-09-24, ask 6942ae27). Before
 * this, getforgenta's pre-commit hook checked only for stubbed exports in
 * src/lib: a staged `OPENROUTER_API_KEY=sk-or-v1-...` line passed it with exit 0
 * (measured). Four getforgenta changes, each measured against this repo's 1,591
 * tracked files, where the original flagged 5 files that are ordinary work - and
 * a guard that refuses ordinary commits is a guard somebody --no-verify's:
 *   1. `.env.example` / `.sample` / `.template` are documentation, not env files.
 *   2. the `-keys.` FILENAME rule skips source files: projection-local-keys.ts and
 *      check-no-leaked-keys.mjs are code ABOUT keys, not keys.
 *   3. the Firebase Android key in android/app/google-services.json is public by
 *      design (restricted by package name and signing SHA in the Google console).
 *      It is allowed by the SHA-256 OF THE EXACT VALUE, never by the file, so any
 *      other key pasted into that file is still refused.
 *   4. lines split on CRLF as well as LF, so a trailing carriage return can never
 *      decide whether a line matches.
 *
 * A .gitignore IS A DEFAULT, NOT A GATE: `git add -f`, an edit to the ignore
 * file, or a new secret at an already-allowed path all end with the material
 * STAGED, which is where this looks. It does not consult the ignore file at all.
 *
 * WHAT IT STOPS AND WHAT IT DOES NOT. It stops the ACCIDENT: a key pasted into a
 * script, a credential file force-added, a new `.env`. It does NOT stop a
 * determined bypass - `git commit --no-verify` skips every hook, and anyone able
 * to edit the tracked hook can remove it. `check:leaked-keys` is a DIFFERENT
 * guard: it reads the built bundle, not commits.
 */
import { createHash } from 'node:crypto';

// Patterns for credential VALUES. Deliberately specific prefixes rather than
// entropy heuristics: entropy flags minified code and base64 fixtures, and a
// check that cries wolf is a check people bypass.
const VALUE_PATTERNS = [
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}/ },
  // The OpenAI-style rule requires ALPHANUMERICS after `sk-`, so an OpenRouter
  // `sk-or-v1-<hex>` key breaks it at character three. Name the prefix rather
  // than widening that rule to hyphens, which would match slugs and minified code.
  { name: 'OpenRouter key', re: /\bsk-or-v1-[A-Za-z0-9]{32,}/ },
  { name: 'Cerebras key', re: /\bcsk-[A-Za-z0-9]{20,}/ },
  { name: 'Resend key', re: /\bre_[A-Za-z0-9]{20,}/ },
  // NOT COVERED: a Mistral key is 32 bare alphanumerics with no prefix,
  // indistinguishable from a hash or an id. The `-keys.` filename rule and
  // .gitignore are the only cover for it.
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Groq key', re: /\bgsk_[A-Za-z0-9]{30,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Stripe secret key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { name: 'private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { name: 'Supabase service role key', re: /\bservice_role["'\s:=]+[A-Za-z0-9._-]{40,}/i },
];

// Filenames that are credentials whatever is inside them.
const NAME_PATTERNS = [
  { name: 'credentials file', re: /(^|\/)\.?credentials(\.json)?$/i },
  { name: 'env file', re: /(^|\/)[^/]*\.env(?!\.(?:example|sample|template)$)(\.[^/]+)?$/i },
  { name: 'key file', re: /(^|\/)[^/]*(id_rsa|id_ed25519|\.pem|\.pfx|\.p12)$/i },
  { name: 'keys file', re: /(^|\/)[^/]*-keys\.(?!(?:[\w-]+\.)*(?:ts|tsx|js|jsx|mjs|cjs)$)[^/]+$/i },
];

// A line that is an EXAMPLE rather than a secret. The escape is per LINE, never
// per file, because "this file is documentation" is the excuse a leak hides behind.
const PLACEHOLDER = /\.\.\.|<[^>]*>|xxx+|YOUR[_ -]?|EXAMPLE|PLACEHOLDER|REDACTED|\bfake\b|\bdummy\b/i;

// Public-by-design values, allowed by the SHA-256 of the exact match (change 3).
const ALLOWED_PUBLIC_SHA256 = new Set([
  '75644d7e6dc9e26b97785ba9bef6014c0862eba4a97b3242fca65ea8eda0a473', // Firebase Android API key
]);
const isAllowedPublic = (value) => ALLOWED_PUBLIC_SHA256.has(createHash('sha256').update(value).digest('hex'));

export function scanContent(path, text) {
  const findings = [];
  for (const p of NAME_PATTERNS) {
    if (p.re.test(path)) {
      findings.push({ path, line: 0, kind: p.name, why: 'the FILENAME is a credential, whatever is inside it' });
    }
  }
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const p of VALUE_PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      if (isAllowedPublic(m[0])) continue;
      if (PLACEHOLDER.test(line)) continue;
      findings.push({ path, line: i + 1, kind: p.name, why: 'credential-shaped value in staged content' });
    }
  });
  return findings;
}

/**
 * The verdict over every staged file. EXAMINING ZERO FILES EXITS 2, never 0: a
 * hook that examined nothing must never read as a clean commit.
 */
export function verdict(fileResults) {
  const rows = fileResults ?? [];
  const findings = rows.flatMap((r) => r.findings ?? []);
  return {
    examined: rows.length,
    findings,
    exitCode: rows.length === 0 ? 2 : findings.length ? 1 : 0,
  };
}
