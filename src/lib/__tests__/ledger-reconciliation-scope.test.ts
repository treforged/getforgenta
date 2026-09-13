/**
 * The ledger-side link — the half of "it should merge when the real transaction shows" that was
 * written, exported, documented, and never called.
 *
 * ⚠️ THE TESTS THAT MATTER HERE ARE THE ONES ASSERTING SILENCE, and for one specific reason: this
 * feature's failure mode is not "no button", it is "a SECOND button for a pair the bank queue is
 * already offering", where only the queue's version records the link. So the boundary — answered
 * but never linked — is exercised in all three directions rather than only the one that shows a
 * button.
 *
 * The fixtures are Tre's real shapes, measured 2026-09-13: a typed `$8.00` Subscriptions row whose
 * only bank twin is `Spotify $7.93`, reviewed months ago and therefore permanently unreachable from
 * the queue. Amounts here are OUTFLOW POSITIVE, as `synced_transactions` stores them.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcilableLedgerRows,
  type ReconcilableLedgerRow,
  type ReconcilableReview,
} from '@/lib/ledger-reconciliation-scope';
import type { MatchableTransaction } from '@/lib/transaction-matching';

const ACCOUNT = '9111bd9f-4704-4acb-97f7-cf1ab40bc764';

const typed = (over: Partial<ReconcilableLedgerRow> = {}): ReconcilableLedgerRow => ({
  id: 'ledger-1',
  amount: 8,
  date: '2026-03-17',
  type: 'expense',
  payment_source: ACCOUNT,
  origin: 'manual',
  ...over,
});

const spotify = (over: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  id: 'bank-spotify',
  account_id: ACCOUNT,
  amount: 7.93,
  date: '2026-03-17',
  pending: false,
  merchant_name: 'Spotify',
  ...over,
});

/** Answered by the user, never linked to a ledger row — the state this feature exists for. */
const answered = (id: string): ReconcilableReview => ({ synced_transaction_id: id, transaction_id: null });

describe('the boundary — only charges the bank queue can no longer offer', () => {
  it('offers the link for a charge answered long ago but never linked', () => {
    const out = reconcilableLedgerRows([typed()], [spotify()], [answered('bank-spotify')]);
    expect(out['ledger-1']).toBeTruthy();
    expect(out['ledger-1'].typedAmount).toBe(8);
    expect(out['ledger-1'].actualAmount).toBe(7.93);
    expect(out['ledger-1'].amountDiffers).toBe(true);
  });

  it('⚠️ SAYS NOTHING about an UNREVIEWED charge — Bank Activity still owns that one', () => {
    // The same pair, with no review row. A button here would be a second way to link the same two
    // rows, and only the queue's version writes the review that records the link.
    expect(reconcilableLedgerRows([typed()], [spotify()], [])).toEqual({});
  });

  it('⚠️ SAYS NOTHING about a charge already linked to this very row', () => {
    const linked: ReconcilableReview = { synced_transaction_id: 'bank-spotify', transaction_id: 'ledger-1' };
    expect(reconcilableLedgerRows([typed()], [spotify()], [linked])).toEqual({});
  });

  it('⚠️ SAYS NOTHING about a charge linked to some OTHER ledger row', () => {
    // The charge is spoken for. Offering it again would point a second typed row at one charge.
    const linked: ReconcilableReview = { synced_transaction_id: 'bank-spotify', transaction_id: 'ledger-other' };
    expect(reconcilableLedgerRows([typed()], [spotify()], [linked])).toEqual({});
  });
});

describe('what is never a candidate on the ledger side', () => {
  it('a GENERATED row is refused — a rule projected it, nobody typed it', () => {
    const projection = typed({ isGenerated: true });
    expect(reconcilableLedgerRows([projection], [spotify()], [answered('bank-spotify')])).toEqual({});
  });

  it('⚠️ A ROW WITH NO `origin` IS REFUSED, NOT DEFAULTED TO MANUAL', () => {
    // `origin` is absent on generated rows. Defaulting it to 'manual' would offer to rewrite the
    // amount of a projection that does not exist in the ledger at all — so absence must reject.
    const noOrigin = typed({ origin: undefined });
    expect(reconcilableLedgerRows([noOrigin], [spotify()], [answered('bank-spotify')])).toEqual({});
  });

  it('a row the bank already confirmed is refused — it is not a prediction any more', () => {
    const alreadyCorrected = typed({ origin: 'synced' });
    expect(reconcilableLedgerRows([alreadyCorrected], [spotify()], [answered('bank-spotify')])).toEqual({});
  });
});

describe('the matcher gates still hold through this caller', () => {
  it('refuses when two answered charges are equally good — ambiguity produces silence', () => {
    // Tre's 2026-03-20 $65 Gas row really does have two: 7-Eleven 64.69 and Costco 64.99, both
    // inside the tight band. A coin flip presented as evidence is worse than no button.
    const gas = typed({ id: 'ledger-gas', amount: 65, date: '2026-03-20' });
    const sevenEleven = spotify({ id: 'b1', amount: 64.69, date: '2026-03-15', merchant_name: '7-Eleven' });
    const costco = spotify({ id: 'b2', amount: 64.99, date: '2026-03-21', merchant_name: 'Costco' });
    const out = reconcilableLedgerRows([gas], [sevenEleven, costco], [answered('b1'), answered('b2')]);
    expect(out).toEqual({});
  });

  it('⚠️ DROPS A CHARGE TWO TYPED ROWS BOTH CLAIM, rather than awarding it to one', () => {
    // Confirming both would quietly merge away a real transaction the person never sees again.
    const a = typed({ id: 'ledger-a' });
    const b = typed({ id: 'ledger-b' });
    expect(reconcilableLedgerRows([a, b], [spotify()], [answered('bank-spotify')])).toEqual({});
  });

  it('direction is a hard gate — a refund never satisfies a purchase', () => {
    const refund = spotify({ amount: -7.93 });
    expect(reconcilableLedgerRows([typed()], [refund], [answered('bank-spotify')])).toEqual({});
  });

  it('a different account is never a candidate, however well the numbers agree', () => {
    const elsewhere = spotify({ account_id: '933cbc10-bceb-4c20-8227-4a02e6db728a' });
    expect(reconcilableLedgerRows([typed()], [elsewhere], [answered('bank-spotify')])).toEqual({});
  });

  it('beyond the date window it is a different purchase', () => {
    const tooLate = spotify({ date: '2026-03-25' });
    expect(reconcilableLedgerRows([typed()], [tooLate], [answered('bank-spotify')])).toEqual({});
  });
});

describe('a date-only correction is still worth offering', () => {
  it('reports dateDiffers with the amounts identical', () => {
    // Tre's settled paychecks land ~2 days after he types them. Nothing is wrong with the figure;
    // the row is simply on the wrong day, which moves which month it falls in.
    const out = reconcilableLedgerRows(
      [typed({ amount: 7.93 })],
      [spotify({ date: '2026-03-19' })],
      [answered('bank-spotify')],
    );
    expect(out['ledger-1'].amountDiffers).toBe(false);
    expect(out['ledger-1'].dateDiffers).toBe(true);
    expect(out['ledger-1'].actualDate).toBe('2026-03-19');
  });
});
