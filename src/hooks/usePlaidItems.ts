/**
 * usePlaidItems — compatibility shim over useFinancialConnections.
 *
 * The app now supports more than one aggregator, so the underlying hook is
 * useFinancialConnections. This wrapper keeps the older call sites (Dashboard,
 * CardProjectionContext, CreditCardEngine, OnboardingChecklist) working while
 * they migrate, and quietly widens them: a user's Akoya connections now count
 * as linked institutions too, which is what those call sites actually mean when
 * they ask "does this user have a bank linked?".
 *
 * Prefer useFinancialConnections in new code.
 */

import {
  type FinancialConnection,
  useFinancialConnections,
} from '@/hooks/useFinancialConnections';

export interface PlaidItem {
  id: string;
  /** Provider-scoped item id. Named for history; not necessarily Plaid's. */
  plaid_item_id: string;
  provider: FinancialConnection['provider'];
  institution_id: string | null;
  institution_name: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export function usePlaidItems() {
  const { connections, loading, error, remove, invalidate } = useFinancialConnections();

  const items: PlaidItem[] = connections.map(c => ({
    id: c.id,
    plaid_item_id: c.provider_item_id,
    provider: c.provider,
    institution_id: c.institution_id,
    institution_name: c.institution_name,
    last_synced_at: c.last_synced_at,
    created_at: c.created_at,
  }));

  return {
    items,
    loading,
    error,
    /** Takes a connection id — not a provider item id. */
    remove,
    invalidate,
  };
}
