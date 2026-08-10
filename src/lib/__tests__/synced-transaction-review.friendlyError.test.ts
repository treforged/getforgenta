// §1B SPLIT LINK — the database's unique indexes are the backstop for races the routing cannot see,
// and when one fires the user gets whatever supabase-js hands back. During the 2026-08-10 live pass
// that was the raw constraint name in a toast — true, and unactionable. `friendlyReviewWriteError`
// turns each index into a sentence; these tests pin the mapping, and the parity block parses the
// shipped migration so a renamed or added index cannot quietly fall back to the generic message.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { friendlyReviewWriteError } from '../synced-transaction-review';

const MIGRATION = join(
  process.cwd(),
  'supabase/migrations/20260810_synced_transaction_reviews_split_link.sql',
);

const pgDuplicate = (index: string) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${index}"`,
});

describe('friendlyReviewWriteError', () => {
  it.each([
    ['synced_transaction_reviews_one_rule_link', /already linked to that bill/i],
    ['synced_transaction_reviews_one_plan_link', /already linked to that payment plan/i],
    ['synced_transaction_reviews_one_car_link', /already linked to that vehicle charge/i],
    ['synced_transaction_reviews_one_exclusive', /already has a decision/i],
  ])('maps %s to a sentence about what the user did', (index, expected) => {
    expect(friendlyReviewWriteError(pgDuplicate(index))).toMatch(expected);
  });

  it('still says something honest for an unmapped unique index on the review table', () => {
    const message = friendlyReviewWriteError(
      pgDuplicate('synced_transaction_reviews_synced_transaction_id_key'),
    );
    expect(message).toMatch(/refresh and try again/i);
    // Never leak the raw constraint name into the friendly sentence.
    expect(message).not.toMatch(/synced_transaction_reviews/);
  });

  it('recognises the violation by message alone when no code is present', () => {
    expect(
      friendlyReviewWriteError({
        message: 'duplicate key value violates unique constraint "synced_transaction_reviews_one_rule_link"',
      }),
    ).toMatch(/already linked to that bill/i);
  });

  // Falling back to the original message on anything else is the point: mislabelling an RLS
  // rejection or a network failure as "already linked" would send the user to undo a link that
  // does not exist.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an FK violation', { code: '23503', message: 'violates foreign key constraint' }],
    ['a network failure', { message: 'Failed to fetch' }],
    ['a unique violation on another table', pgDuplicate('net_worth_snapshots_user_id_snapshot_date_key')],
  ])('returns null for %s', (_label, error) => {
    expect(friendlyReviewWriteError(error)).toBeNull();
  });

  // The mapping and the migration are one rule written twice — same shape as the LINK_STATUSES
  // parity test beside this file. Every unique index the migration creates on the review table must
  // map to a SPECIFIC sentence, not the generic fallback.
  it('covers every unique index the shipped migration creates', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const indexes = [...sql.matchAll(/create unique index if not exists (\w+)/gi)].map(m => m[1]);
    expect(indexes.length).toBeGreaterThanOrEqual(4);
    const generic = friendlyReviewWriteError(pgDuplicate('synced_transaction_reviews_unmapped'));
    for (const index of indexes) {
      const message = friendlyReviewWriteError(pgDuplicate(index));
      expect(message, `${index} must map to a specific sentence`).not.toBeNull();
      expect(message, `${index} must not fall through to the generic fallback`).not.toBe(generic);
    }
  });
});
