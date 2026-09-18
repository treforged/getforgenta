/**
 * ONBOARDING MUST NOT POINT AT A CONTROL THAT DOES NOT EXIST.
 *
 * Measured 2026-09-18 (docs/onboarding-inventory-2026-09-18.md): the finish step sent every user
 * to "Settings -> Quick Access", a name that occurred TWICE in src/ and both times inside
 * Onboarding.tsx itself - and it was shown on WEB, where the control it names renders nothing,
 * because its guard's right-hand side (`typeof window !== 'undefined'`) is true in every browser.
 * The expenses step named "Budget Control" for a tab labelled "Plan".
 *
 * WHAT THIS GATE IS. A SOURCE gate. It can see a wrong string and a wrong boolean guard, which is
 * exactly what both defects were. It CANNOT see layout, a step that fails to mount, or whether the
 * corrected sentence reads well. A rendered walk is a separate instrument and is not this.
 *
 * EVERY ASSERTION IS PAIRED WITH A POSITIVE CONTROL IN THE SAME RUN, because a zero from a broken
 * read and a zero from clean source are the same zero. A control failing means the INSTRUMENT is
 * wrong, which is a different diagnosis from the app being wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const ONBOARDING = read('src/pages/Onboarding.tsx');
const APP_LOCK = read('src/components/settings/AppLockSettings.tsx');
const SETTINGS = read('src/pages/Settings.tsx');
const TRANSACTIONS = read('src/pages/Transactions.tsx');

/**
 * ASSERT ON COPY, NOT ON SOURCE.
 *
 * The first version of this gate failed on its own fix: the comment explaining the defect QUOTES
 * the defect in order to refute it, so "Quick Access" and the old `|| typeof window` guard both
 * appear in prose that exists precisely to stop the next person reinstating them. A gate that
 * forbids NAMING a bug in a comment is a gate somebody deletes.
 *
 * The stripper therefore has its own positive control below: an extraction that silently returned
 * nothing would make every "does not contain" assertion pass for ever.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments, including the JSX {/* ... */} form
    .replace(/^[ \t]*\/\/.*$/gm, '');  // whole-line // comments
}

const COPY = stripComments(ONBOARDING);
const SETTINGS_COPY = stripComments(SETTINGS);

describe('the instrument can find what it is looking for', () => {
  it('reads real files, not empty strings', () => {
    expect(ONBOARDING.length).toBeGreaterThan(10_000);
    expect(APP_LOCK.length).toBeGreaterThan(500);
    expect(TRANSACTIONS.length).toBeGreaterThan(10_000);
  });

  it('the comment stripper removes comments and keeps copy', () => {
    expect(ONBOARDING).toContain('The ONE onboarding flow');    // a comment, before stripping
    expect(COPY).not.toContain('The ONE onboarding flow');      // gone after
    expect(COPY).toContain('Welcome to Forgenta');              // real copy survives
    expect(COPY.length).toBeGreaterThan(ONBOARDING.length / 2); // and most of the file survives
  });

  it('the app lock control is named "App lock" and is native-only', () => {
    expect(APP_LOCK).toContain('App lock');
    expect(APP_LOCK).toContain('!Capacitor.isNativePlatform()');
  });

  it('the app lock control is mounted under Account Security in Settings', () => {
    expect(SETTINGS).toContain('<AppLockSettings />');
    expect(SETTINGS).toContain('Account Security');
  });

  it('the budget tab is labelled "Plan"', () => {
    expect(TRANSACTIONS).toMatch(/id: 'budget'[^}]*label: 'Plan'/);
  });
});

describe('onboarding names controls that exist', () => {
  it('never says "Quick Access" - no such control exists anywhere in the app', () => {
    expect(COPY).not.toContain('Quick Access');
  });

  it('never says "Budget Control" in user-visible copy - the tab reads "Plan"', () => {
    expect(COPY).not.toContain('Budget Control');
  });

  it('names the app lock by its real name and its real location', () => {
    expect(COPY).toContain('App lock');
    expect(COPY).toContain('Account Security');
  });
});

describe('the app lock hint is not shown to people who cannot use it', () => {
  it('does not carry a `typeof window` escape hatch beside the native check', () => {
    expect(COPY).not.toMatch(/isNativePlatform\(\)\s*\|\|\s*typeof window/);
  });

  it('gates the hint on the native platform alone', () => {
    expect(COPY).toMatch(/\{Capacitor\.isNativePlatform\(\) && \(/);
  });
});

describe('premium copy only promises what premium enforces', () => {
  /**
   * "Unlimited history" sat in TWO surfaces until 2026-09-18 and was VACUOUS, not merely
   * undocumented: no plan-bounded history query exists anywhere in src/ - no `.gte`/`.lt`/`.limit`
   * on a date gated by plan - so free users already had it and an upgrader received nothing new.
   * Tre approved replacing it (abd764bf); the wording is this desk's.
   *
   * ⚠️ CASE-INSENSITIVE, AND THAT IS THE WHOLE POINT. The first sweep was case-sensitive, found
   * `Onboarding.tsx` and missed `Settings.tsx`'s lowercase copy, and reported one site where there
   * were two. Fourth sighting of that trap on this machine in a week.
   *
   * ⚠️ COPY, NOT SOURCE. The comment left at the fix site names the retired phrase so nobody
   * reinstates it, and a gate that forbids naming a retired bug is a gate somebody deletes.
   */
  it('never promises "unlimited history" in either surface, whatever the casing', () => {
    expect(COPY.toLowerCase()).not.toContain('unlimited history');
    expect(SETTINGS_COPY.toLowerCase()).not.toContain('unlimited history');
  });

  it('CONTROL: the search can find a benefit that IS really there', () => {
    // Without this, a broken read makes the absence above meaningless. "Priority support" sits in
    // the same sentence and the same grid as the phrase that was removed.
    expect(COPY.toLowerCase()).toContain('priority support');
    expect(SETTINGS_COPY.toLowerCase()).toContain('priority support');
  });

  it('CONTROL: the replacements name limits the app actually enforces', () => {
    // A benefit claim is only checkable if the gate it refers to exists.
    //
    // ⚠️ THIS CONTROL CAUGHT ITS OWN PREMISE MOVING, which is what a control is for. It used to
    // assert `isPremium ? 10 : FREE_LINK_LIMIT` in Accounts.tsx; that line was correctly REPLACED
    // by `bankLinkCeilingFor()` when the typed numbers were pulled into src/lib/plan-limits.ts.
    // Asserting the old text would now fail over an improvement, so it asserts the new source -
    // and `plan-limits.gate.test.ts` is what holds THAT against the server's own ceilings.
    expect(read('src/components/debt/CreditCardEngine.tsx'))
      .toContain('(isPremium || isDemo) ? yearMonths.length : (yearIdx === 1 ? Math.min(3, yearMonths.length) : 0)');
    expect(read('src/lib/plan-limits.ts')).toMatch(/export const PREMIUM_MAX_LINKED\s*=\s*\d+/);
    expect(read('src/pages/Accounts.tsx')).toContain('bankLinkCeilingFor(isPremium)');
  });
});
