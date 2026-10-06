/**
 * GATE: a FRESH free row, built from the table's REAL column defaults, is intro-eligible.
 *
 * Why it exists (2026-10-06): `user_subscriptions.purchase_provider` DEFAULTS to 'stripe', and
 * decideIntroEligibility read any non-null provider as "ever subscribed". So every free user whose
 * row existed lost the intro offer - 6 real users plus the probe account. The unit tests passed,
 * because they hand-built rows WITHOUT the default, and `check:intro-offer` answers create-checkout
 * inside the browser, so neither could see it. This test builds the row the way Postgres does.
 *
 * Defaults come from the migrations where a migration declares them. `plan` and
 * `subscription_status` predate the migrations folder, so they are pinned to a live read
 * (information_schema.columns, 2026-10-06: plan 'free', subscription_status 'inactive').
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decideIntroEligibility } from '../../../supabase/functions/_shared/intro-eligibility';

const MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations');

/** The LAST default a migration declares for `column` on user_subscriptions, or undefined. */
function migrationDefault(column: string): string | boolean | undefined {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found: string | boolean | undefined;
  const re = new RegExp(
    `alter\\s+table\\s+(?:public\\.)?user_subscriptions[^;]*?add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?${column}\\b[^,;]*?default\\s+('([^']*)'|true|false)`,
    'gi',
  );
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(re)) {
      const raw = m[1].toLowerCase();
      found = raw === 'true' ? true : raw === 'false' ? false : m[2];
    }
  }
  return found;
}

describe('intro eligibility - a fresh row from the real column defaults', () => {
  const purchaseProvider = migrationDefault('purchase_provider');
  const isComp = migrationDefault('is_comp');

  it('the defaults it relies on are found in the migrations (control: a broken reader finds nothing)', () => {
    expect(purchaseProvider).toBe('stripe');
    expect(isComp).toBe(true);
    expect(migrationDefault('no_such_column_xyz')).toBeUndefined();
  });

  it('the row create-checkout upserts for a new customer is eligible', () => {
    // create-checkout writes only user_id + stripe_customer_id; Postgres fills the rest.
    const freshRow = {
      plan: 'free',
      subscription_status: 'inactive',
      is_comp: isComp as boolean,
      purchase_provider: purchaseProvider as string,
      stripe_subscription_id: null,
      apple_original_transaction_id: null,
    };
    expect(decideIntroEligibility(freshRow, false)).toEqual({ eligible: true, reason: null });
  });
});
