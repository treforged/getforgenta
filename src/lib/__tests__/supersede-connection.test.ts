// Re-linking an institution supersedes the old connection to it.
//
// The rule decides whether a LIVE bank connection gets disconnected, so the failure that costs the
// user is a false positive — cutting a link they still need. Most of this file is about what must
// NOT be superseded.
//
// Would-fail check: drop the `provider_item_id !== incoming.provider_item_id` guard and
// "never supersedes the incoming item itself" fails — that is Plaid's update mode, where a user
// repairing a broken connection reuses the same item id and would have it revoked out from under
// them.

import { describe, it, expect } from 'vitest';
import {
  planSupersededConnections, type SupersedableConnection,
} from '../../../supabase/functions/_shared/supersede-connection';

const conn = (over: Partial<SupersedableConnection> = {}): SupersedableConnection => ({
  id: 'c-old', institution_id: 'ins_54', provider_item_id: 'item-old',
  connection_status: 'active', ...over,
});

describe('planSupersededConnections — the case it was built for', () => {
  it('supersedes the old Robinhood link when a new item arrives for the same bank', () => {
    const out = planSupersededConnections([conn()], { institution_id: 'ins_54', provider_item_id: 'item-new' });
    expect(out).toEqual(['c-old']);
  });

  it('supersedes every prior link to that bank, not just the newest', () => {
    const out = planSupersededConnections(
      [conn({ id: 'a', provider_item_id: 'i1' }), conn({ id: 'b', provider_item_id: 'i2' })],
      { institution_id: 'ins_54', provider_item_id: 'item-new' },
    );
    expect(out.sort()).toEqual(['a', 'b']);
  });
});

describe('planSupersededConnections — what it must never touch', () => {
  it('never supersedes the incoming item itself — that is Plaid update mode', () => {
    // A user repairing a broken connection reuses the same item_id. Revoking it here would
    // disconnect the link they just fixed.
    const out = planSupersededConnections(
      [conn({ provider_item_id: 'item-same' })],
      { institution_id: 'ins_54', provider_item_id: 'item-same' },
    );
    expect(out).toEqual([]);
  });

  it('never supersedes a DIFFERENT bank', () => {
    const out = planSupersededConnections(
      [conn({ institution_id: 'ins_3' })],
      { institution_id: 'ins_54', provider_item_id: 'item-new' },
    );
    expect(out).toEqual([]);
  });

  it('supersedes NOTHING when the incoming link has no institution id', () => {
    // Without it there is no safe way to tell "the same bank again" from "a second bank".
    const out = planSupersededConnections([conn()], { institution_id: null, provider_item_id: 'item-new' });
    expect(out).toEqual([]);
  });

  it('ignores a connection whose own institution id is null', () => {
    const out = planSupersededConnections(
      [conn({ institution_id: null })],
      { institution_id: 'ins_54', provider_item_id: 'item-new' },
    );
    expect(out).toEqual([]);
  });

  it('leaves an already-revoked connection alone — no repeated writes', () => {
    const out = planSupersededConnections(
      [conn({ connection_status: 'revoked' })],
      { institution_id: 'ins_54', provider_item_id: 'item-new' },
    );
    expect(out).toEqual([]);
  });

  it('DOES supersede a reauth_required connection to the same bank', () => {
    // Re-linking is how a user fixes a broken connection, and the new item is the repair. Leaving
    // the broken one active is what produced the duplicate in the first place.
    const out = planSupersededConnections(
      [conn({ connection_status: 'reauth_required' })],
      { institution_id: 'ins_54', provider_item_id: 'item-new' },
    );
    expect(out).toEqual(['c-old']);
  });

  it('is empty for a first-time link', () => {
    expect(planSupersededConnections([], { institution_id: 'ins_54', provider_item_id: 'i' })).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const list = [conn()];
    planSupersededConnections(list, { institution_id: 'ins_54', provider_item_id: 'item-new' });
    expect(list).toEqual([conn()]);
  });
});
