/**
 * MONTH 0: THE PART OF ANOTHER ACCOUNT'S BILLS THAT CHECKING HAS TO PAY.
 *
 * Asks 5810a568 / d651b7b5. forecast-engine.ts step 4b-iii pays an account-paid bill out of its own
 * account first, floors that account at $0, and charges the rest to the funding checking account
 * (`unfundedAccountOutflow`). Month 0's cash is decided by useCardProjection's month-0 chain, not by
 * the engine, so the chain has to subtract the same dollars or the Dashboard and the Forecast print
 * two different month-end cash figures for one month (measured on the synthetic persona in
 * month0-unfunded-parity.test.ts: Dashboard $1,604 against Forecast $1,304, a $300 bill).
 *
 * ⚠️ THIS IS A SECOND COPY OF 4b, 4b-ii AND 4b-iii, FOR MONTH 0 ONLY. It is not the engine's own
 * code because the hook runs BEFORE the engine and month 0 is live-anchored: the engine cannot hand
 * its figure back to the hook the way the convergence loop feeds months 1+ (see
 * `ForecastInputs.unfundedAccountOutflowByMonth`). Month 0 needs no history to copy: every balance
 * here is the synced balance plus this month's own movements, in the engine's order:
 *   4b    a transfer from checking credits a savings, investment or retirement account;
 *   4b-ii a transfer between non-checking accounts moves what its source holds (floored at $0) in
 *         passes, so a chain does not depend on rule order; a source this file does not track pays
 *         in full;
 *   4b-iii a second checking account takes non-cash transfers out at the full amount and in at what
 *         was given, then the transfers from checking; then each bill pays what its account holds
 *         and the rest is charged to checking. An account that STARTS overdrawn keeps its overdraft
 *         and the whole bill goes to checking.
 * month0-unfunded-parity.test.ts asserts the two copies agree on month 0 to the cent.
 *
 * NOT MODELLED, and each one can only make this figure HIGHER than the engine's (it leaves a credit
 * out): step 4a's paycheck retirement deductions, which credit a retirement account before 4b-iii.
 * A bill paid out of a 401(k) is the only case that reaches it.
 */

/** Liquid (checking-shaped) account types - forecast-engine.ts `liquidTypes`. */
const LIQUID_TYPES = ['checking', 'business_checking', 'cash'];
const SAVINGS_TYPES = ['savings', 'high_yield_savings'];
const INVEST_TYPES = ['brokerage'];
const RETIRE_TYPES = ['roth_ira', '401k', 'ira', 'hsa'];

export interface Month0AccountRow {
  id: string;
  account_type: string;
  balance: number | string | null;
  active: boolean;
}

export interface Month0AccountMovements {
  /** Transfers whose money leaves the funding account, by destination, at the amount the cash walk
   *  charges (forecast-engine.ts `cashTransferInItems`). */
  cashTransfersIn: readonly { toAcctId: string; amount: number }[];
  /** Transfers whose source is NOT the funding account (forecast-engine.ts `nonCashTransferItems`). */
  nonCashTransfers: readonly { fromAcctId: string; toAcctId: string | null; amount: number }[];
  /** Bills paid out of another account: recurring rules first, then one-time transactions, the
   *  order 4b-iii charges them in. */
  expenseItems: readonly { fromAcctId: string; amount: number }[];
}

type Bal = { balance: number };

/**
 * Dollars of month 0's other-account bills that the funding account pays. 0 when there is no
 * funding account (nothing can be "other than" it, and the engine lists no such bill either).
 */
export function month0UnfundedAccountOutflow(
  accounts: readonly Month0AccountRow[],
  fundingAccountId: string | null | undefined,
  movements: Month0AccountMovements,
): number {
  if (!fundingAccountId) return 0;
  const active = accounts.filter(a => a.active);
  const tracker = (types: string[], extra: (a: Month0AccountRow) => boolean = () => true) =>
    new Map<string, Bal>(active.filter(a => types.includes(a.account_type) && extra(a))
      .map(a => [a.id, { balance: Number(a.balance) || 0 }]));
  const savings = tracker(SAVINGS_TYPES);
  const invest = tracker(INVEST_TYPES);
  const retire = tracker(RETIRE_TYPES);
  const otherLiquid = tracker(LIQUID_TYPES, a => a.id !== fundingAccountId);

  // 4b: money sent from checking into a savings, investment or retirement account.
  for (const t of movements.cashTransfersIn) {
    const acct = retire.get(t.toAcctId) ?? invest.get(t.toAcctId) ?? savings.get(t.toAcctId);
    if (acct) acct.balance += t.amount;
  }

  // 4b-ii: non-cash transfers between those accounts, in passes, each source floored at 0.
  const nonCash = movements.nonCashTransfers;
  const tracked = (id: string | null) => (id ? savings.get(id) ?? invest.get(id) ?? retire.get(id) : undefined);
  const given = nonCash.map(() => 0);
  for (let pass = 0, moved = true; moved && pass <= nonCash.length; pass++) {
    moved = false;
    nonCash.forEach((item, k) => {
      const remaining = item.amount - given[k];
      if (remaining <= 1e-9) return;
      const src = tracked(item.fromAcctId);
      let paid = remaining;
      if (src) {
        const before = src.balance;
        src.balance = Math.max(0, before - remaining);
        paid = Math.max(0, before - src.balance);
      }
      if (paid <= 1e-9) return;
      given[k] += paid;
      const dest = tracked(item.toAcctId);
      if (dest) dest.balance += paid;
      moved = true;
    });
  }

  // 4b-iii: a second checking account's movements, then every bill.
  nonCash.forEach((t, k) => {
    const from = otherLiquid.get(t.fromAcctId);
    if (from) from.balance -= t.amount;
    const to = t.toAcctId ? otherLiquid.get(t.toAcctId) : undefined;
    if (to) to.balance += given[k];
  });
  for (const t of movements.cashTransfersIn) {
    const to = otherLiquid.get(t.toAcctId);
    if (to) to.balance += t.amount;
  }
  let unfunded = 0;
  for (const item of movements.expenseItems) {
    const liquid = otherLiquid.get(item.fromAcctId);
    const src = savings.get(item.fromAcctId) ?? invest.get(item.fromAcctId) ?? retire.get(item.fromAcctId) ?? liquid;
    if (!src) continue;
    unfunded += Math.max(0, item.amount - Math.max(0, src.balance));
    src.balance = src === liquid && src.balance < 0 ? src.balance : Math.max(0, src.balance - item.amount);
  }
  return unfunded;
}
