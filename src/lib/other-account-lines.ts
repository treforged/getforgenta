/**
 * "OTHER ACCOUNTS" — the month popup's section for money that moved an account the cash walk above
 * it is not about.
 *
 * Tre, 2026-08-27: *"in forecast pop ups ... that top section is a reflection of only the checking
 * account (the debt payment account). make a new section that shows the change in other accounts
 * when there is one."*
 *
 * The walk above is ONE account's story. Three kinds of movement belong to a different one:
 *   • a one-time expense paid from savings (his June 2027 lease-break fee, $3,830);
 *   • a recurring expense rule whose `payment_source` is another account;
 *   • a transfer between two non-cash accounts — which moves TWO accounts, out of one and into the
 *     other, and is the reason this groups by account instead of listing rows.
 *
 * Grouped by account, each item signed, each group closed by its own net change. An account whose
 * ins and outs cancel still gets a group: "nothing changed here" is an answer, and it is the truth
 * about a month where two transfers crossed.
 *
 * ⚠️ THE NET IS OF THESE ITEMS, NOT OF THE ACCOUNT. Interest growth, goal contributions and ranked
 * reserves also move these balances and they are reported in the assets block below with their own
 * numbers; a "net change" here that silently included them could not be reconciled against the
 * lines printed directly above it. The label says which one it is.
 */

export type OtherAccountMovement = {
  name: string;
  fromAcctId: string;
  fromAcctName: string;
  amount: number;
};

export type NonCashTransfer = OtherAccountMovement & {
  toAcctId: string | null;
  toAcctName: string;
};

export type PopupLine = { label: string; value: string; op?: '+' | '−' | '=' };

type Entry = { label: string; amount: number };

/** One account's movements, keyed by whatever identifies it — its id, or its name when a source
 *  carries no id (the vehicle down-payment rows have never had one). */
type Group = { name: string; entries: Entry[] };

export function buildOtherAccountLines(
  row: {
    nonCashTransferItems?: readonly NonCashTransfer[] | null;
    otherAccountExpenseItems?: readonly OtherAccountMovement[] | null;
    otherAccountOneTimeItems?: readonly OtherAccountMovement[] | null;
  },
  formatCurrency: (n: number, cents: boolean) => string,
): PopupLine[] {
  const groups = new Map<string, Group>();
  const push = (key: string, name: string, entry: Entry) => {
    if (!(Math.abs(entry.amount) > 0.005)) return;
    const g = groups.get(key) ?? { name, entries: [] };
    g.entries.push(entry);
    groups.set(key, g);
  };

  for (const t of row.nonCashTransferItems ?? []) {
    push(t.fromAcctId || t.fromAcctName, t.fromAcctName || 'Other account',
      { label: t.name, amount: -t.amount });
    // The receiving end, when the transfer records one. Without it a savings → brokerage move
    // reads as money that simply left the plan.
    if (t.toAcctId || t.toAcctName) {
      push(t.toAcctId || t.toAcctName, t.toAcctName || 'Other account',
        { label: `${t.name} — from ${t.fromAcctName || 'another account'}`, amount: t.amount });
    }
  }
  for (const e of row.otherAccountExpenseItems ?? []) {
    push(e.fromAcctId || e.fromAcctName, e.fromAcctName || 'Other account',
      { label: e.name, amount: -e.amount });
  }
  for (const e of row.otherAccountOneTimeItems ?? []) {
    push(e.fromAcctId || e.fromAcctName, e.fromAcctName || 'Other account',
      { label: e.name, amount: -e.amount });
  }

  if (groups.size === 0) return [];

  const lines: PopupLine[] = [{
    label: 'Other Accounts (not the account above)',
    value: '',
  }];
  for (const g of groups.values()) {
    lines.push({ label: `  ${g.name}`, value: '' });
    for (const e of g.entries) {
      lines.push({
        label: `    ${e.label}`,
        value: formatCurrency(Math.abs(e.amount), true),
        op: e.amount < 0 ? '−' : '+',
      });
    }
    const net = g.entries.reduce((s, e) => s + e.amount, 0);
    lines.push({
      label: '    Net change from these',
      value: `${net < 0 ? '−' : '+'}${formatCurrency(Math.abs(net), true)}`,
      op: '=',
    });
  }
  lines.push({ label: '', value: '' });
  return lines;
}
