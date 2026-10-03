/**
 * Dashboard banner for bank connections Plaid says need statement-data consent (ask 3248738e).
 *
 * Until the user allows it, the bank sends no APR, minimum or due date, so the forecast runs on
 * whatever was typed by hand. One button per flagged bank opens Plaid in update mode, which asks
 * for the liabilities consent. Dismiss lasts for this visit only: the data stays missing, so the
 * banner comes back until it is fixed.
 */
import { useEffect, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import PlaidLinkButton from '@/components/shared/PlaidLinkButton';
import { usePlaidItems } from '@/hooks/usePlaidItems';
import { itemsNeedingConsent } from '@/lib/statement-consent';

interface Props {
  /** Tells the Dashboard whether this banner is on screen, so other nudges can wait. */
  onVisibleChange?: (visible: boolean) => void;
}

export default function StatementConsentBanner({ onVisibleChange }: Props) {
  const { items, invalidate } = usePlaidItems();
  const [dismissed, setDismissed] = useState(false);
  const flagged = itemsNeedingConsent(items);
  const visible = !dismissed && flagged.length > 0;

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  if (!visible) return null;

  const names = flagged.map(i => i.institution_name ?? 'Your bank');
  const headline = flagged.length === 1
    ? `${names[0]} needs your OK to share statements`
    : `${flagged.length} banks need your OK to share statements`;

  return (
    <div data-testid="statement-consent-banner" className="flex items-start gap-3 bg-secondary border border-border px-4 py-3" style={{ borderRadius: 'var(--radius)' }}>
      <CreditCard size={15} className="text-gold mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gold">{headline}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Allow it so your APR, minimum payment and due date fill in from your bank.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {flagged.map((item, idx) => (
            <PlaidLinkButton
              key={item.id}
              relinkItemId={item.plaid_item_id}
              label={flagged.length === 1 ? 'Allow statement data' : `Allow ${names[idx]}`}
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
