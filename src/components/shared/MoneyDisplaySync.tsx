import { useProfile } from '@/hooks/useSupabaseData';
import { setMoneyDisplay } from '@/lib/calculations';

/**
 * MAKES THE CURRENCY PICKER DO SOMETHING.
 *
 * ⚠️ THE DEFECT THIS FIXES IS LIVE TODAY, before any international expansion.
 * `docs/international-release-plan.md`: *"a user in Dublin sets EUR, and every balance,
 * every projection and every payoff figure still renders in dollars… a control that was
 * built, described, and never pressed."*
 *
 * It was one level worse than the plan found. `setMoneyDisplay()` already existed in
 * `calculations.ts`, exported, documented, with a `getMoneyDisplay` and a `resetMoneyDisplay`
 * beside it — and **nothing outside the tests had ever called it.** The plumbing was laid and
 * never connected, which is why `formatCurrency`'s 446 call sites all still printed USD.
 *
 * ── WHY A COMPONENT, AND WHY IT SETS DURING RENDER ──────────────────────────
 * `formatCurrency` reads a module-level singleton, which is the right design for 446 call
 * sites — threading a prop through all of them would be a far larger and more breakable
 * change. But a singleton written in `useEffect` is written AFTER the first paint, so every
 * figure in the app would render in dollars for one frame and then restate itself. A visible
 * flicker on money is exactly the kind of thing that makes a finance app feel untrustworthy.
 *
 * So it is set during render, above the routes. Rendering `null`, this component's whole job
 * is to run that line before its siblings render.
 *
 * ⚠️ SETTING A MODULE SINGLETON DURING RENDER IS ONLY SAFE BECAUSE IT IS IDEMPOTENT AND
 * DERIVED. The same profile always produces the same value, so a double-invoked render
 * (StrictMode, a concurrent retry) writes the identical thing. It is not state, and nothing
 * reads it back to decide what to do next.
 *
 * ── LOCALE AND CURRENCY ARE DIFFERENT KNOBS ─────────────────────────────────
 * The plan is explicit about this: `en-US` renders `€1,234.56` where most of the eurozone
 * writes `1.234,56 €`. Symbol, grouping, separator and symbol POSITION come from the locale.
 * The CURRENCY is the user's stated choice, from their profile. The LOCALE is how they expect
 * numbers written, which is a property of their device, not of the money — so it comes from
 * the browser. A person in Berlin holding a USD account should see `1.234,56 $`, not
 * `$1,234.56`.
 *
 * ⚠️ DISPLAY ONLY. Nothing here converts an amount. Calling €100 "$100" would be worse than
 * useless, and whether Forgenta ever shows per-currency subtotals or one converted total is
 * an open product decision (multi-currency is PARKED — see handoff.md).
 */

/** The browser's own formatting preference, falling back to the US default the app has always
 *  used. `navigator.language` is absent in some embedded webviews, so it is not assumed. */
function browserLocale(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const candidate = nav?.languages?.[0] ?? nav?.language;
  if (!candidate) return 'en-US';
  // A malformed tag would make `Intl.NumberFormat` throw on every money render, which would be
  // a blank app rather than a wrong separator. Verified once, here, rather than 446 times.
  try {
    new Intl.NumberFormat(candidate, { style: 'currency', currency: 'USD' }).format(1);
    return candidate;
  } catch {
    return 'en-US';
  }
}

export default function MoneyDisplaySync() {
  const { data: profile } = useProfile();

  // An unset currency keeps the US default rather than guessing from the locale: somebody in
  // Berlin who has never opened Settings is far more likely to hold the USD account they signed
  // up with than to want their balances silently restated as euros.
  const currency = profile?.currency || 'USD';
  setMoneyDisplay({ currency, locale: browserLocale() });

  return null;
}
