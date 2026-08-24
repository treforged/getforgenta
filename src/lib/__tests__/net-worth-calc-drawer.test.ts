// The Net Worth calc drawer must split its rows on the SAME predicate the total is built from.
//
// `openNetWorthCalc` in Dashboard.tsx used to carry its own copy of the liability type list, and
// the copy had drifted: it omitted 'mortgage'. So a mortgage account was itemised under "Assets"
// while the "Total Liabilities" line directly beneath it — computed by `net-worth.ts`, which does
// know about mortgages — correctly counted it as debt. A drawer whose only job is to explain a
// number was contradicting that number, and no type check or render can see it.
//
// The fix is not "add mortgage to the list", it is "stop keeping a second list". The structural
// half of this file is what stops the copy coming back; the unit half pins the predicate itself.
//
// Would-fail check: put a literal `['credit_card', ...]` liability list back into
// `openNetWorthCalc` and the first case goes red.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLiabilityAccountType, LIABILITY_ACCOUNT_TYPES } from '@/lib/net-worth';

const DASHBOARD = join(process.cwd(), 'src', 'pages', 'Dashboard.tsx');

/** A commented-out call still contains the name, and a guard a `//` defeats is not a guard. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The body of `openNetWorthCalc`, up to the next top-level `const … = ` at the same indent. */
function openNetWorthCalcBody(): string {
  const source = stripComments(readFileSync(DASHBOARD, 'utf8'));
  const start = source.indexOf('const openNetWorthCalc');
  expect(start, 'openNetWorthCalc must exist in Dashboard.tsx').toBeGreaterThan(-1);
  const end = source.indexOf('\n  const ', start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

describe('Dashboard net worth calc drawer', () => {
  it('derives its asset/liability split from net-worth.ts, not a local list', () => {
    const body = openNetWorthCalcBody();
    expect(body).toContain('isLiabilityAccountType');
    // No hand-written type list of its own — that is the thing that drifted.
    expect(body).not.toContain("'credit_card'");
    expect(body).not.toContain("'other_liability'");
  });

  it('files a mortgage under Liabilities, which the old local list did not', () => {
    expect(isLiabilityAccountType('mortgage')).toBe(true);
    expect([...LIABILITY_ACCOUNT_TYPES]).toContain('mortgage');
    // The same predicate that decides the row also decides the total, so they cannot disagree.
    expect(isLiabilityAccountType('checking')).toBe(false);
    expect(isLiabilityAccountType('brokerage')).toBe(false);
  });
});
