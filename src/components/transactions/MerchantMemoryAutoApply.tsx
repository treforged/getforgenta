// Runs the merchant-memory pass on the Dashboard, so charges are categorized BEFORE the user opens
// Transactions (Tre, 2026-10-02, dc34a4c7: "That should happen prior to the user even opening up to
// the transactions tab"). Renders nothing: the toast says what it did, and the undo lives on the
// Transactions tab, where the charges are.
//
// ⚠️ NO NEW QUERY. The Dashboard already loads both inputs (synced charges and their reviews)
// through `useMatchedOccurrences`, so this reads the cache those queries fill.
//
// ⚠️ NEVER IN THE DEMO OR A PARTNER VIEW. `setCategory` refuses both, and its `onError` would put an
// error toast on the Dashboard for a write the viewer never asked for.
import { useDemo } from '@/contexts/DemoContext';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { useSyncedTransactionReviews } from '@/hooks/useSupabaseData';
import MerchantMemoryPanel from './MerchantMemoryPanel';

export default function MerchantMemoryAutoApply() {
  const { isDemo } = useDemo();
  const { isPartnerView } = useViewedProfile();
  if (isDemo || isPartnerView) return null;
  return <Runner />;
}

function Runner() {
  const { setCategory } = useSyncedTransactionReviews();
  return <MerchantMemoryPanel setCategory={setCategory} background />;
}
