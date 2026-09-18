/**
 * THE PROVIDER'S BROWSER-LOCAL INPUTS, IN ONE PLACE, BECAUSE THEY MOVE A NUMBER THE USER IS SHOWN.
 *
 * ⚠️ THESE ARE INPUTS TO THE FORECAST THAT LIVE ONLY IN ONE BROWSER. A raw Supabase dump carries
 * DATABASE TABLES, so a fixture recaptured from a dump always takes the defaults below, whatever
 * the capturing browser actually held - and the difference is not cosmetic. Measured 2026-09-17
 * on Tre's own 31-Aug rows, clock pinned, Eastern:
 *
 *   pause-savings false -> true     the debt-free month moves 29 -> 24   FIVE MONTHS
 *   funding account changed          the debt-free month moves 29 -> 27   TWO MONTHS
 *   strategy avalanche -> snowball   no movement on this dataset
 *
 * `safeToPayTotal` held at 229.89 across all twelve configurations, so these move the PAYOFF and
 * not the month-0 recommendation - which is why the divergence hid for fourteen passes: the money
 * figure everyone was comparing is insensitive to exactly the inputs that were missing.
 *
 * SO THEY ARE EXPORTED AND NAMED ONCE. A capture records them through this constant and a replay
 * seeds them through it, which means the provider and the capture CANNOT DRIFT - the failure this
 * repo keeps hitting is a hand-named list that is blind to the entry nobody added to it.
 * `capture-local-state.gate.test.ts` derives the real set from `CardProjectionContext.tsx`'s own
 * `usePersistedState` calls and fails if a fourth one appears without being added here.
 *
 * ⚠️ IT LIVES IN A LEAF MODULE ON PURPOSE. It was first declared inside `CardProjectionContext`,
 * and importing that from the fixture helpers dragged in the supabase client - which touches
 * `localStorage` at module scope - and broke SIX node-environment suites at IMPORT time. They
 * reported 0 failed tests and 6 failed FILES, which reads as a harness problem rather than a
 * code one. A constant shared between app code and test helpers must not carry the app with it.
 */
export const PROJECTION_LOCAL_KEYS = {
  pauseSavings: 'tre:debtpayoff:pause-savings',
  debtStrategy: 'tre:debt:strategy',
  debtFundingAccount: 'tre:debt:fundingAccount',
} as const;

export type ProjectionLocalState = Partial<Record<keyof typeof PROJECTION_LOCAL_KEYS, string | null>>;
