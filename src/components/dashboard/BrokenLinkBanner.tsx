/**
 * Dashboard banner for bank connections whose sync has STOPPED (reauth_required or error).
 *
 * A stopped sync makes every figure on this page stale - balances, Safe to Spend, the forecast -
 * and before 2026-10-06 nothing anywhere said so (found answering ask 8dd3c5ab). One Re-link per
 * broken bank opens Plaid in update mode; a good sync then sets the connection active again.
 * Dismiss lasts for this visit only: the sync is still stopped, so the banner comes back.
 */
import { useEffect, useState } from 'react';
import { Link2Off, X } from 'lucide-react';
import PlaidLinkButton from '@/components/shared/PlaidLinkButton';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { brokenLinkItems } from '@/lib/relink-prompt';

interface Props {
  /** Tells the Dashboard whether this banner is on screen, so other nudges can wait. */
  onVisibleChange?: (visible: boolean) => void;
}

export default function BrokenLinkBanner({ onVisibleChange }: Props) {
  const { items, invalidate } = usePlaidItems();
  const [dismissed, setDismissed] = useState(false);
  const broken = brokenLinkItems(items);
  const visible = !dismissed && broken.length > 0;

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  if (!visible) return null;

  const names = broken.map(i => i.institution_name ?? 'Your bank');
  const headline = broken.length === 1
    ? `${names[0]} needs you to sign in again`
    : `${broken.length} banks need you to sign in again`;

  return (
    <div data-testid="broken-link-banner" className="flex items-start gap-3 bg-secondary border border-border px-4 py-3" style={{ borderRadius: 'var(--radius)' }}>
      <Link2Off size={15} className="text-gold mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gold">{headline}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Balances from {broken.length === 1 ? 'it' : 'them'} stop updating until you re-link, so the figures here may be out of date.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {broken.map((item, idx) => (
            <PlaidLinkButton
              key={item.id}
              relinkItemId={item.plaid_item_id}
              label={broken.length === 1 ? 'Re-link' : `Re-link ${names[idx]}`}
              onSuccess={() => invalidate()}
            />
          ))}
        </div>
      </div>
      <button aria-label="Dismiss" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
        <X size={13} />
      </button>
    </div>
  );
}
