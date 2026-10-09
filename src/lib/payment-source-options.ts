/**
 * The Payment Source options every manual-entry form offers: Cash, then each ACTIVE account.
 * With no accounts at all, the generic Bank Account / Credit Card pair stands in so a new user
 * still has something truer than Cash to pick.
 *
 * ONE builder for the full Add Transaction form (`Transactions.tsx`) and the quick-add sheet
 * (`QuickAddSheet.tsx`), so the two cannot offer different accounts for the same row.
 */
export interface PaymentSourceAccount {
  id: string;
  name: string;
  account_type: string;
  active: boolean | null;
}

export function buildPaymentSourceOptions(accounts: readonly PaymentSourceAccount[]): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [{ value: 'cash', label: 'Cash' }];
  accounts.filter(a => a.active).forEach(a => {
    const typeLabel = a.account_type === 'credit_card' ? 'Credit Card'
      : a.account_type === 'high_yield_savings' ? 'HYS'
      : a.account_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    opts.push({ value: `account:${a.id}`, label: `${a.name} (${typeLabel})` });
  });
  if (opts.length === 1) {
    opts.push({ value: 'bank_account', label: 'Bank Account' });
    opts.push({ value: 'credit_card', label: 'Credit Card' });
  }
  return opts;
}
