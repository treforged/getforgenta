// @vitest-environment jsdom
//
// Offline recapture of the golden fixture (`forecast-inputs.real.json`) from a raw Supabase row
// dump, with no signed-in browser.
//
// WHY THIS EXISTS. Every real-data measurement in this repo - the convergence loop, the red-month
// enumeration, the cycling backlog - reads a fixture captured in a browser on 2026-07-20. When a
// question is about what Tre's forecast does TODAY, a July answer is not evidence, and the only
// other capture path (`window.__convergenceDebug` in CardProjectionContext) needs a signed-in
// localhost session that a session without Chrome cannot get to.
//
// WHY IT RENDERS THE REAL PROVIDER. `CardProjectionProvider` is where `payConfig`, `cashFloor`,
// `syncCutoffDate`, `forecastFundingAccountId`, the scheduled events and the assumptions
// hydration are derived from the raw rows. Calling `useCardProjection` and
// `useForecastEngineInputs` directly would mean reimplementing all of that here, and a harness
// that derives its inputs differently from the app produces a fixture that answers questions
// about the harness. So the rows go in at the data-hook boundary and the provider does the rest.
//
// WHY THE ENV GATE. The output is built from real financial data and is gitignored. A plain
// `npm test` must never rewrite it, so the test self-skips unless RECAPTURE=1 is set AND the raw
// dump is present. To run it:
//
//   RECAPTURE=1 npx vitest run src/lib/__tests__/recapture-forecast-fixture.test.tsx
//
// To produce the dump see `docs/forecast-fixture-recapture.md`.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CardProjectionProvider, useCardProjectionContext } from '@/contexts/CardProjectionContext';
import type { ForecastInputs } from '@/lib/forecast-engine';
import { serializeForecastCapture } from './fixtures/forecast-fixture-io';

interface RawDump {
  dumpedAt: string;
  userId: string;
  tables: Record<string, unknown>;
}

// `vi.mock` factories are hoisted above the imports, so the dump has to be loaded in a hoisted
// block too - an ordinary top-level const is still in its temporal dead zone when a factory runs.
const h = await vi.hoisted(async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const RAW = join(__dirname, 'fixtures', 'raw-rows.real.json');
  const empty: RawDump = { dumpedAt: '', userId: '', tables: {} };
  if (!existsSync(RAW)) return { present: false, dump: empty };
  return { present: true, dump: JSON.parse(readFileSync(RAW, 'utf8')) as RawDump };
});

vi.mock('@/hooks/useSupabaseData', () => {
  const t = h.dump.tables;
  return {
    useAccounts: () => ({ data: t.accounts ?? [] }),
    useTransactions: () => ({ data: t.transactions ?? [] }),
    useRecurringRules: () => ({ data: t.recurring_rules ?? [] }),
    useDebts: () => ({ data: t.debts ?? [] }),
    useSavingsGoals: () => ({ data: t.savings_goals ?? [] }),
    useCarFunds: () => ({ data: t.car_funds ?? [] }),
    useBudgetItems: () => ({ data: t.budget_items ?? [] }),
    usePaymentPlans: () => ({ data: t.payment_plans ?? [] }),
    useSyncedTransactions: () => ({ data: t.synced_transactions ?? [] }),
    useSyncedTransactionReviews: () => ({ data: t.synced_transaction_reviews ?? [] }),
    // The provider debounce-saves edited assumptions back through this mutation. Nothing here
    // edits them, but the call must not throw if the debounce ever fires.
    useProfile: () => ({ data: t.profile ?? null, update: { mutate: () => {} } }),
  };
});

vi.mock('@/hooks/usePlaidItems', () => ({
  usePlaidItems: () => ({ items: (h.dump.tables.plaid_items ?? []) as unknown[] }),
}));

const canRun = h.present && process.env.RECAPTURE === '1';
const maybeIt = canRun ? it : it.skip;

describe('recapture the golden forecast fixture from a raw Supabase dump', () => {
  maybeIt('rebuilds forecast-inputs.real.json through the real provider', async () => {
    const { writeFileSync, copyFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');

    let engineInputs: ForecastInputs | null = null;
    let converged = false;

    function Capture() {
      const ctx = useCardProjectionContext();
      engineInputs = ctx.forecastInputsBundle.engineInputs;
      converged = ctx.debtCashConverged;
      return null;
    }

    render(
      <CardProjectionProvider>
        <Capture />
      </CardProjectionProvider>,
    );

    expect(engineInputs).toBeTruthy();
    const captured = engineInputs as unknown as ForecastInputs;

    const accountRows = h.dump.tables.accounts as unknown[];
    expect(captured.accounts.length).toBe(accountRows.length);
    expect(captured.cardProjectionData).toBeTruthy();

    const serialized = serializeForecastCapture(captured, h.dump.dumpedAt);
    const out = join(__dirname, 'fixtures', 'forecast-inputs.real.json');

    // Keep the fixture this run replaces. The first run of this harness overwrote the 2026-07-20
    // golden capture with no copy, and every measurement recorded against it lost its baseline.
    // The name matches the `forecast-inputs.real*.json` ignore rule, so the copy stays untracked.
    if (existsSync(out)) {
      const stamp = h.dump.dumpedAt.slice(0, 10);
      copyFileSync(out, join(__dirname, 'fixtures', `forecast-inputs.real.replaced-${stamp}.json`));
    }

    writeFileSync(out, serialized, 'utf8');

    console.log(
      `[recapture] wrote ${serialized.length} bytes to forecast-inputs.real.json, `
      + `dumpedAt ${h.dump.dumpedAt}, debtCashConverged ${converged}`,
    );
  });
});
