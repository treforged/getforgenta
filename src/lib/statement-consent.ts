/**
 * Which Plaid connections need the user to allow statement data (ask 3248738e).
 *
 * The sync sets `financial_connections.liabilities_consent_required` when Plaid answers
 * ADDITIONAL_CONSENT_REQUIRED for liabilities. Until the user allows it, the bank sends no APR,
 * minimum or due date, so the Debt tab and the Dashboard both point at the fix.
 */
import type { PlaidItem } from '@/hooks/usePlaidItems';

function needsConsent(item: PlaidItem): boolean {
  return item.provider === 'plaid' && item.liabilities_consent_required === true;
}

/** The flagged connection an account belongs to, or undefined. */
export function consentItemForAccount(
  account: { plaid_item_id?: string | null } | undefined,
  items: PlaidItem[],
): PlaidItem | undefined {
  const itemId = account?.plaid_item_id;
  if (!itemId) return undefined;
  return items.find(item => item.plaid_item_id === itemId && needsConsent(item));
}

/** Every flagged connection, sorted by bank name (unnamed last). Returns a new array. */
export function itemsNeedingConsent(items: PlaidItem[]): PlaidItem[] {
  return items.filter(needsConsent).sort((a, b) => {
    const aName = a.institution_name ?? '';
    const bName = b.institution_name ?? '';
    if (aName === '' && bName !== '') return 1;
    if (bName === '' && aName !== '') return -1;
    return aName.localeCompare(bName);
  });
}
