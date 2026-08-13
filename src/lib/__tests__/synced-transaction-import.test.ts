import { describe, it, expect } from 'vitest';
import { planLedgerImport, type SyncedTransactionForImport } from '../synced-transaction-import';

const txn = (over: Partial<SyncedTransactionForImport> = {}): SyncedTransactionForImport => ({
  id: 'st1',
  account_id: 'acc1',
  amount: 42.5,
  date: '2026-08-03',
  name: 'ACME STORE #123',
  merchant_name: 'Acme',
  category: 'GENERAL_MERCHANDISE',
  ...over,
});

const ctx = (over: Partial<Parameters<typeof planLedgerImport>[1]> = {}) => ({
  accountName: 'TOTAL CHECKING',
  categoryOverride: null,
  hasSuggestion: false,
  reviews: null,
  ...over,
});

describe('planLedgerImport — the double-count guard', () => {
  // THE invariant of §1B. `public.transactions` is read by twelve surfaces, and `recurring_rules`
  // already projects the bills a suggestion would point at, so importing a charge that matched
  // something counts the same dollars twice everywhere at once.
  it('refuses a row that matched a rule or a ledger entry', () => {
    const plan = planLedgerImport(txn(), ctx({ hasSuggestion: true }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/already/i);
  });

  // Tre's "Not this" decision (2026-08-09): rejecting the guess must land somewhere, and one of the
  // three destinations is a brand-new ledger row. The override is deliberately its own named field
  // so a call site cannot defeat the guard by quietly forgetting to pass `hasSuggestion`.
  it('allows import of a suggestion the user explicitly rejected', () => {
    const plan = planLedgerImport(txn(), ctx({ hasSuggestion: true, suggestionRejected: true }));
    expect(plan.ok).toBe(true);
  });

  it('still refuses a suggestion the user has NOT rejected', () => {
    const plan = planLedgerImport(txn(), ctx({ hasSuggestion: true, suggestionRejected: false }));
    expect(plan.ok).toBe(false);
  });

  // A rejection overrules the matcher; it does not overrule a decision the user already recorded.
  it('does not let a rejection reopen a charge already dealt with', () => {
    const plan = planLedgerImport(txn(), ctx({
      hasSuggestion: true, suggestionRejected: true, reviews: [{ status: 'imported' }],
    }));
    expect(plan.ok).toBe(false);
  });

  // `'linked_plan'` and `'linked_car'` joined this list in Slice C. Both were always in
  // `HANDLED_STATUSES`, so the UI already hid the button; the two lists simply disagreed, and a
  // plan instalment or car charge imported to the ledger is the same double-count as a linked rule.
  it('refuses a row the user has already dealt with', () => {
    for (const status of ['linked_rule', 'linked_txn', 'imported', 'ignored', 'linked_plan', 'linked_car']) {
      const plan = planLedgerImport(txn(), ctx({ reviews: [{ status }] }));
      expect(plan.ok, status).toBe(false);
    }
  });

  // §1B SPLIT LINK — the reason this became a SET. A charge may hold several decisions, and the
  // blocking one need not be the first: asking about "the" review would read one row and let the
  // charge be imported alongside a link that already accounts for it.
  it('refuses when ANY of several decisions blocks, not just the first', () => {
    const plan = planLedgerImport(txn(), ctx({
      reviews: [{ status: 'categorized' }, { status: 'linked_rule' }],
    }));
    expect(plan.ok).toBe(false);
  });

  // `'categorized'` means only "the user fixed the label" — it asserts nothing about the charge
  // being handled, so it must NOT block an import. This is the whole reason the fifth status exists.
  it('allows a row whose only review is a category correction', () => {
    const plan = planLedgerImport(txn(), ctx({ reviews: [{ status: 'categorized' }], categoryOverride: 'Groceries' }));
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.draft.category).toBe('Groceries');
  });
});

describe('planLedgerImport — the sign convention', () => {
  // The two tables disagree and both are right in their own terms: `synced_transactions` is
  // OUTFLOW-POSITIVE (Stage A), while the ledger stores a positive amount and puts direction in
  // `type`. Getting this backwards would file income as spending on twelve surfaces.
  it('maps an outflow to a positive expense', () => {
    const plan = planLedgerImport(txn({ amount: 42.5 }), ctx());
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.draft).toMatchObject({ type: 'expense', amount: 42.5 });
  });

  it('maps an inflow to a positive income row', () => {
    const plan = planLedgerImport(txn({ amount: -1200 }), ctx());
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.draft).toMatchObject({ type: 'income', amount: 1200 });
  });

  it('accepts a numeric string, as PostgREST returns for numeric columns', () => {
    const plan = planLedgerImport(txn({ amount: '42.50' as unknown as number }), ctx());
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.draft.amount).toBe(42.5);
  });

  it('refuses a zero or unparseable amount rather than writing a meaningless row', () => {
    expect(planLedgerImport(txn({ amount: 0 }), ctx()).ok).toBe(false);
    expect(planLedgerImport(txn({ amount: NaN }), ctx()).ok).toBe(false);
  });
});

describe('planLedgerImport — the payment source and account label', () => {
  // `transactions.payment_source` is `account:`-prefixed on all 22 live rows while
  // `recurring_rules.payment_source` is a bare uuid. Writing the bare form here would make the
  // imported row invisible to the card/forecast source sets, which key on both spellings.
  it('writes the account:-prefixed payment source the ledger uses', () => {
    const plan = planLedgerImport(txn({ account_id: 'acc1' }), ctx());
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.draft.payment_source).toBe('account:acc1');
  });

  // `transactions.account` is a dead legacy free-text label that reads "Checking" on all 22 rows
  // INCLUDING ones whose payment_source points at a credit card. The import must not inherit that
  // lie, and `useTransactions().add` coerces a falsy account to the literal 'Checking' — which is
  // why import refuses rather than falling through to a default.
  it('takes the label from the real account name', () => {
    const plan = planLedgerImport(txn(), ctx({ accountName: 'Discover it Card' }));
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.draft.account).toBe('Discover it Card');
  });

  it('refuses when the account cannot be resolved instead of guessing a label', () => {
    const plan = planLedgerImport(txn(), ctx({ accountName: null }));
    expect(plan.ok).toBe(false);
    const noId = planLedgerImport(txn({ account_id: null }), ctx());
    expect(noId.ok).toBe(false);
  });
});

describe('planLedgerImport — a transfer leg is neither income nor spending', () => {
  it('refuses a leg of a movement between the user\'s own accounts', () => {
    const plan = planLedgerImport(txn(), ctx({ isTransferLeg: true }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/between your own accounts/i);
  });

  // ⚠️ THE ORDERING IS THE TEST. Every other refusal means "something already describes this", and
  // "Not this" is the user's legitimate way to overrule that. A transfer leg is different in kind:
  // no ledger row would be right, so importing the outflow books a transfer as spending and
  // importing the inflow books it as income. `suggestionRejected` must not reach it.
  it('stays refused even when the user pressed "Not this"', () => {
    const plan = planLedgerImport(txn(), ctx({ isTransferLeg: true, hasSuggestion: true, suggestionRejected: true }));
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/between your own accounts/i);
  });

  it('leaves every other charge importable — the flag is opt-in, not a new default', () => {
    expect(planLedgerImport(txn(), ctx()).ok).toBe(true);
    expect(planLedgerImport(txn(), ctx({ isTransferLeg: false })).ok).toBe(true);
  });
});

describe('planLedgerImport — the rest of the row', () => {
  it('falls back through merchant name to the raw descriptor', () => {
    const withMerchant = planLedgerImport(txn({ merchant_name: 'Acme', name: 'ACME #1' }), ctx());
    if (withMerchant.ok) expect(withMerchant.draft.note).toBe('Acme');
    const withoutMerchant = planLedgerImport(txn({ merchant_name: null, name: 'ACME #1' }), ctx());
    if (withoutMerchant.ok) expect(withoutMerchant.draft.note).toBe('ACME #1');
  });

  it('uses the mapped provider category when the user has not overridden it', () => {
    const plan = planLedgerImport(txn({ category: 'FOOD_AND_DRINK' }), ctx());
    if (plan.ok) expect(plan.draft.category).toBe('Dining');
  });

  it('ignores an override that is not a real app category', () => {
    const plan = planLedgerImport(txn({ category: 'FOOD_AND_DRINK' }), ctx({ categoryOverride: 'Nonsense' }));
    if (plan.ok) expect(plan.draft.category).toBe('Dining');
  });

  it('keeps the bank date, not today', () => {
    const plan = planLedgerImport(txn({ date: '2026-01-17' }), ctx());
    if (plan.ok) expect(plan.draft.date).toBe('2026-01-17');
  });

  // Risk 4 in the plan: once imports exist the ledger is no longer purely hand-entered, and the
  // review table cannot answer "where did this row come from" for rows that predate it.
  it('stamps provenance so an imported row is never mistaken for a typed one', () => {
    const plan = planLedgerImport(txn(), ctx());
    if (plan.ok) expect(plan.draft.origin).toBe('synced');
  });
});
