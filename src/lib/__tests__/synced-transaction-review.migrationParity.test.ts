// §1B SPLIT LINK — the app and the database must agree about how many decisions a charge may hold.
//
// `LINK_STATUSES` in `synced-transaction-review.ts` and the predicate of the partial unique index in
// `20260810_synced_transaction_reviews_split_link.sql` are ONE RULE WRITTEN TWICE. Both files say so
// in a comment, and a comment has never once stopped anyone.
//
// The failure it guards is quiet and user-facing rather than loud: add a link status to the Set
// alone and the UI cheerfully offers a second link that the database then rejects with a constraint
// name; add it to the migration alone and a charge silently acquires two exclusive rows, which is
// import idempotency — "a row already imported cannot be imported twice" — gone.
//
// So this reads the shipped SQL rather than a copy of it. Parsing a migration in a unit test is
// unusual here, and it is worth it precisely because the two halves live in different languages and
// no compiler spans them.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LINK_STATUSES } from '../synced-transaction-review';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260810_synced_transaction_reviews_split_link.sql',
);

describe('split-link migration parity with LINK_STATUSES', () => {
  it('ships the migration this app was written against', () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  it('the exclusive index excludes exactly the statuses the app treats as links', () => {
    const sql = readFileSync(MIGRATION, 'utf8');

    // The one index whose predicate is the shared rule: "at most one EXCLUSIVE decision per charge".
    const match = sql.match(
      /create unique index[^;]*synced_transaction_reviews_one_exclusive[^;]*?where\s+status\s+not\s+in\s*\(([^)]*)\)/is,
    );
    expect(match, 'the one_exclusive index and its NOT IN predicate must be findable').not.toBeNull();

    const inSql = new Set(
      match![1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean),
    );
    expect([...inSql].sort()).toEqual([...LINK_STATUSES].sort());
  });

  // The three dedupe indexes are the other half of the contract: they are what `linkTarget` keys on,
  // so a charge cannot hold the same rule, plan or vehicle charge twice. The car index carries
  // `car_charge_kind` because one vehicle bills two independently-gated obligations a month.
  it.each([
    ['synced_transaction_reviews_one_rule_link', '(synced_transaction_id, rule_id)'],
    ['synced_transaction_reviews_one_plan_link', '(synced_transaction_id, payment_plan_id)'],
    ['synced_transaction_reviews_one_car_link', '(synced_transaction_id, car_fund_id, car_charge_kind)'],
  ])('declares %s on %s', (name, columns) => {
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(name);
    expect(sql.replace(/\s+/g, ' ')).toContain(columns);
  });

  // Dropping this is the entire point of the migration; without it every index above is decoration.
  it('drops the whole-charge UNIQUE it is replacing', () => {
    expect(readFileSync(MIGRATION, 'utf8'))
      .toContain('drop constraint if exists synced_transaction_reviews_synced_transaction_id_key');
  });
});
