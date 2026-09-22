import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isPremiumEntitled, PREMIUM_ENTITLED_STATUSES } from '../premium-entitlement';

/**
 * THE PREMIUM ENTITLEMENT GATE.
 *
 * A failed renewal writes `subscription_status = 'past_due'` and leaves `plan = 'premium'`.
 * Before 2026-09-22 every reader in this repo asked for status in ('active','trialing'), so a
 * paying customer whose card bounced was locked out INSTANTLY - which is the exact thing the
 * billing grace period in App Store Connect exists to prevent. The fix was ONE predicate,
 * `isPremiumEntitled`, and this gate exists because a single predicate is one commit away from
 * being re-hand-rolled at the next call site somebody adds.
 *
 * HOW THE SUBJECT SET IS CHOSEN, and it is the part that matters. The sweep looks for the
 * DEFECT SHAPE - a literal array carrying both 'active' and 'trialing' - never for the
 * correctness marker. Searching for `isPremiumEntitled` would only ever have measured
 * compliance among the compliant. Every hit must be in ALLOWLIST with a recorded reason, or
 * the sweep fails and names the file and the line.
 *
 * THE ALLOWLIST IS ALSO THE POSITIVE CONTROL. Every entry must be FOUND by the sweep. A zero
 * from a broken matcher and a zero from a clean tree are the same zero, so if the matcher ever
 * stops working the four known-positives go missing and this goes RED rather than quietly
 * green. A synthetic string is matched too, assembled at runtime so that this file can carry
 * the control without matching itself.
 *
 * EACH EXCEPTION IS ASSERTED STILL JUSTIFIED, NEVER MERELY STILL PRESENT. An allowlist that
 * only checks presence records a decision nobody re-reads.
 *
 * WHAT THIS DOES NOT PROVE. It does not prove the app grants access during a REAL grace
 * window - that needs a genuine BILLING_ISSUE event in the RevenueCat sandbox, which this
 * machine cannot generate. It does not read SQL in migrations or RLS policies. It cannot see a
 * status list built by concatenation or held in a variable. And it deliberately skips
 * `*.gate.test.ts`, so a gate file may carry the shape freely.
 */

const REPO = join(__dirname, '..', '..', '..');
const ROOTS = ['src', join('supabase', 'functions')];
const QUOTE = String.fromCharCode(39);

/**
 * The canonical module DECLARES the list, so of course it carries the shape. It is the
 * definition, not a hand-rolled copy, and it is excluded from the sweep rather than
 * allowlisted - an allowlist entry would imply it is an exception to the rule when it IS the
 * rule. Its contents are asserted directly by the `isPremiumEntitled` block below.
 */
const CANONICAL = 'supabase/functions/_shared/premium-entitlement.ts';

/** A literal array carrying both statuses, in either quote style. This is the DEFECT shape. */
const SHAPE = /\[[^\]\n]*\bactive\b[^\]\n]*\btrialing\b[^\]\n]*\]/;

/**
 * A line that is entirely a comment is PROSE, not a decision the app executes. A gate that
 * cannot tell the two apart forbids naming the bug in the comment explaining the fix - and a
 * gate that punishes documentation is one somebody deletes. This tripped on its second run,
 * on a comment written to explain this very change.
 *
 * STATED LIMIT: a trailing comment on a line that also carries code is NOT stripped. That is
 * deliberate - such a line still carries the code. The stripper has its own positive control
 * below, because a stripper that removed everything would empty the sweep and read as clean.
 */
const isCommentLine = (s: string) => /^\s*(\/\/|\*|\/\*)/.test(s);

type Hit = { file: string; line: number; text: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.gate\.test\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const hits: Hit[] = [];
for (const root of ROOTS) {
  for (const file of walk(join(REPO, root))) {
    const rel = relative(REPO, file).replace(/\\/g, '/');
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      if (rel !== CANONICAL && !isCommentLine(text) && SHAPE.test(text)) {
        hits.push({ file: rel, line: i + 1, text });
      }
    });
  }
}

const ALLOWLIST: {
  file: string;
  why: string;
  stillJustified: (src: string, hit: Hit) => boolean;
}[] = [
  {
    file: 'supabase/functions/stripe-webhook/index.ts',
    why: 'It is the WRITER, and sub.status is Stripe own namespace. Accepting past_due here '
       + 'would write plan: premium permanently - granting premium for ever instead of grace.',
    stillJustified: (src, hit) =>
      /plan:\s*isActive\s*\?/.test(src.split('\n').slice(hit.line - 1, hit.line + 40).join('\n')),
  },
  {
    file: 'supabase/functions/plaid-sync-all/index.ts',
    why: 'A Postgres .in() filter cannot call a JS predicate, so it carries a deliberate '
       + 'parallel copy of the same list. It must EQUAL the module list, derived not typed.',
    // Read the statuses from INSIDE the brackets only. A first version scanned the whole
    // line and swallowed the quoted COLUMN NAME ("subscription_status"), so the comparison
    // was always false - an instrument fault that read exactly like a drifted list.
    stillJustified: (_src, hit) => {
      const inside = SHAPE.exec(hit.text)?.[0] ?? '';
      const q = '["' + QUOTE + ']';
      const found = [...inside.matchAll(new RegExp(q + '([a-z_]+)' + q, 'g'))].map((m) => m[1]);
      return JSON.stringify(found.sort())
        === JSON.stringify([...PREMIUM_ENTITLED_STATUSES].sort());
    },
  },
  {
    file: 'src/components/premium/NativePaywall.tsx',
    why: 'A purchase-confirmation poll, not an entitlement check. past_due rows already carry '
       + 'plan=premium, so accepting it would report success from the STALE row on attempt 1.',
    stillJustified: (src) => /pollUntilPremium/.test(src),
  },
  {
    file: 'src/pages/PremiumSuccess.tsx',
    why: 'Same: it polls for a NEW purchase landing, and must not be satisfied by a '
       + 'pre-existing past_due row.',
    stillJustified: (src) => /const poll\s*=/.test(src),
  },
];

describe('premium entitlement - positive controls', () => {
  it('the sweep reached files at all', () => {
    expect(walk(join(REPO, 'src')).length).toBeGreaterThan(200);
  });

  it('the matcher finds a synthetic list assembled at runtime', () => {
    const synthetic = 'const x = [' + QUOTE + 'active' + QUOTE + ', '
      + QUOTE + 'trialing' + QUOTE + '];';
    expect(SHAPE.test(synthetic)).toBe(true);
  });

  it('the matcher does NOT fire on a list missing one status', () => {
    expect(SHAPE.test('const x = [' + QUOTE + 'active' + QUOTE + '];')).toBe(false);
  });

  // The stripper is load-bearing in BOTH directions. One that stripped everything would
  // empty the sweep and print a clean bill of health, so it is asserted to keep code.
  it('the comment stripper removes prose and KEEPS code', () => {
    const code = 'const x = [' + QUOTE + 'active' + QUOTE + ', ' + QUOTE + 'trialing' + QUOTE + '];';
    expect(isCommentLine('  // ' + code)).toBe(true);
    expect(isCommentLine('   * ' + code)).toBe(true);
    expect(isCommentLine(code)).toBe(false);
  });

  it.each(ALLOWLIST.map((a) => a.file))('known-positive still found: %s', (file) => {
    expect(hits.filter((h) => h.file === file).length).toBeGreaterThan(0);
  });

  // The canonical module is EXCLUDED from the sweep, so prove the exclusion is hiding a
  // definition rather than an absence. If the list ever stops being declared there, this
  // goes red instead of the exclusion quietly covering an empty file.
  it('the excluded canonical module really does declare the list', () => {
    const src = readFileSync(join(REPO, CANONICAL), 'utf8');
    expect(SHAPE.test(src)).toBe(true);
  });
});

describe('premium entitlement - the sweep', () => {
  it('no site outside the allowlist hand-rolls the status list', () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.file));
    const stray = hits.filter((h) => !allowed.has(h.file));
    expect(stray.map((h) => h.file + ':' + h.line + '  ' + h.text.trim())).toEqual([]);
  });

  it.each(ALLOWLIST)('the exception is still JUSTIFIED: $file', (entry) => {
    const src = readFileSync(join(REPO, entry.file), 'utf8');
    for (const hit of hits.filter((h) => h.file === entry.file)) {
      expect(entry.stillJustified(src, hit), entry.why).toBe(true);
    }
  });
});

describe('isPremiumEntitled', () => {
  it('grants premium through a billing grace period', () => {
    expect(isPremiumEntitled({ plan: 'premium', subscription_status: 'past_due' })).toBe(true);
  });

  it.each([...PREMIUM_ENTITLED_STATUSES])('grants on %s', (s) => {
    expect(isPremiumEntitled({ plan: 'premium', subscription_status: s })).toBe(true);
  });

  it.each(['canceled', 'expired', 'incomplete', 'unpaid', ''])('refuses on %s', (s) => {
    expect(isPremiumEntitled({ plan: 'premium', subscription_status: s })).toBe(false);
  });

  it('refuses a free plan whatever the status', () => {
    for (const s of PREMIUM_ENTITLED_STATUSES) {
      expect(isPremiumEntitled({ plan: 'free', subscription_status: s })).toBe(false);
    }
  });

  it('refuses null, undefined and a shapeless row without throwing', () => {
    expect(isPremiumEntitled(null)).toBe(false);
    expect(isPremiumEntitled(undefined)).toBe(false);
    expect(isPremiumEntitled({})).toBe(false);
  });

  it('is a list of STATUSES, never a number of days', () => {
    for (const s of PREMIUM_ENTITLED_STATUSES) expect(Number.isNaN(Number(s))).toBe(true);
    expect(PREMIUM_ENTITLED_STATUSES).toContain('past_due');
  });
});
