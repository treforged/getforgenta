/**
 * A SUPERSEDE MUST LEAVE NO ORPHAN — the invariant, after it was broken twice in one day.
 *
 * 2026-09-05, both found by Tre spotting leftovers rather than by anything in the system:
 *
 *   1. The dedupe retired ACCOUNTS but not the ITEM, so two dead Robinhood connections stayed
 *      on his Linked Banks screen forever.
 *   2. The cleanup then deleted the ITEMS but LEFT their account rows, on the reasoning that
 *      `active: false` made them harmless. It did not — he could still see them, and said so:
 *      *"you never deleted the stale robinhood cards from accounts."*
 *
 * The two halves fail in opposite directions and each looks complete on its own. Retiring
 * accounts alone leaves an item the user still sees; retiring the item alone leaves accounts
 * pointing at nothing. **A supersede is one unit: the accounts, the item, and the item at the
 * provider.**
 *
 * ⚠️ WHAT THIS FILE CAN AND CANNOT DO. The write itself lives in an edge function with no test
 * harness, so these assert the PLANNERS that decide the write, plus the invariant a caller must
 * hold. That is the same honest limit as `revenue-reporting.lock.test.ts`, and it is why the
 * invariant is expressed as a reusable check rather than as prose in a comment.
 *
 * Would-fail check: make `planAccountRetirement` skip a referenced account instead of
 * deactivating it, and "accounts for EVERY stale account" fails — which is the exact shape of
 * leaving a row behind.
 */
import { describe, it, expect } from 'vitest';
import { planAccountRetirement } from '../../../supabase/functions/_shared/retire-accounts';
import {
  planSupersededConnections, planProviderDisconnects,
  type SupersedableConnection,
} from '../../../supabase/functions/_shared/supersede-connection';

/**
 * THE INVARIANT, as a function so it can be asserted rather than described.
 *
 * After a supersede, no surviving account may point at a connection that is gone. Anything this
 * returns is a row the user can still see attached to a bank the app has forgotten.
 */
function orphanedAccounts(
  accounts: readonly { id: string; connection_id: string | null }[],
  survivingConnectionIds: ReadonlySet<string>,
): string[] {
  return accounts
    .filter(a => a.connection_id !== null && !survivingConnectionIds.has(a.connection_id))
    .map(a => a.id);
}

/** His real shape on 2026-09-05: three Robinhood links, two of them dead. */
const conns: SupersedableConnection[] = [
  { id: 'c-april', institution_id: 'ins_54', provider_item_id: 'item-april', connection_status: 'active' },
  { id: 'c-august', institution_id: 'ins_54', provider_item_id: 'item-august', connection_status: 'active' },
];
const incoming = { institution_id: 'ins_54', provider_item_id: 'item-live' };

describe('a supersede is one unit — accounts, item, and the provider', () => {
  it('picks exactly the dead links, and never the incoming one', () => {
    const superseded = planSupersededConnections(conns, incoming);
    expect(superseded).toEqual(['c-april', 'c-august']);
    expect(superseded).not.toContain('item-live');
  });

  it('accounts for EVERY stale account — none may be silently skipped', () => {
    // The rows on the two dead connections.
    const stale = ['acct-individual', 'acct-card', 'acct-savings'];
    // One is pointed at by a goal or a rule, so it may only be hidden, not deleted.
    const referenced = new Set(['acct-card']);

    const plan = planAccountRetirement(stale, referenced);

    // The invariant: every stale id is in exactly one bucket. A row in neither is a row left
    // behind, which is what Tre saw.
    const handled = [...plan.deletable, ...plan.deactivateOnly].sort();
    expect(handled).toEqual([...stale].sort());
    expect(plan.deletable).not.toContain('acct-card');
    expect(plan.deactivateOnly).toEqual(['acct-card']);
  });

  it('hangs up at the provider on the same set, so no Item is left live', () => {
    const rows = [
      { id: 'c-april', access_token: 'tok-april' },
      { id: 'c-august', access_token: 'tok-august' },
    ];
    expect(planProviderDisconnects(rows)).toEqual(['c-april', 'c-august']);
  });

  it('LEAVES NO ACCOUNT POINTING AT A CONNECTION THAT IS GONE — the thing Tre saw', () => {
    const accounts = [
      { id: 'acct-individual', connection_id: 'c-april' },
      { id: 'acct-card', connection_id: 'c-august' },
      { id: 'acct-live', connection_id: 'c-live' },
      { id: 'acct-manual', connection_id: null },
    ];
    const superseded = new Set(planSupersededConnections(conns, incoming));
    const surviving = new Set(['c-live']);

    // Before handling them, the two on superseded connections ARE orphans. This is the state the
    // cleanup created by deleting items and leaving rows.
    expect(orphanedAccounts(accounts, surviving).sort())
      .toEqual(['acct-card', 'acct-individual']);

    // After retiring every account on a superseded connection, nothing is left pointing at one.
    const stale = accounts
      .filter(a => a.connection_id !== null && superseded.has(a.connection_id))
      .map(a => a.id);
    const plan = planAccountRetirement(stale, new Set());
    const remaining = accounts.filter(a => !plan.deletable.includes(a.id));

    expect(orphanedAccounts(remaining, surviving)).toEqual([]);
    // A manual account with no connection is never an orphan and must never be touched.
    expect(remaining.map(a => a.id)).toContain('acct-manual');
  });

  it('never touches a manual account, which has no connection to be superseded by', () => {
    const accounts = [{ id: 'acct-manual', connection_id: null }];
    expect(orphanedAccounts(accounts, new Set())).toEqual([]);
  });
});
