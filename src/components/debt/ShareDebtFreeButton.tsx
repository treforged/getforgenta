/**
 * The Share button beside Payoff ETA (ask 555a4c71, Tre 2026-09-20: "our app needs virality").
 *
 * OPT-IN AND PREVIEWED: pressing Share only renders the card; the image leaves the device only
 * after the user has seen exactly that image and pressed "Share image". The card carries a date
 * and a month count only - the renderer refuses anything else (see share-card.ts).
 * The dialog itself lives in ShareCardButton, shared with the Trophy Case's badge cards.
 */
import { buildDebtFreeCard } from '@/lib/share-card';
import ShareCardButton from '@/components/shared/ShareCardButton';

export default function ShareDebtFreeButton({
  etaMonth,
}: {
  etaMonth: number | null;
}) {
  return (
    <ShareCardButton
      spec={buildDebtFreeCard(etaMonth, new Date())}
      title="Share your debt-free date"
      note="This is exactly what will be shared. It shows a date only, never your balances."
      imageAlt="Your debt-free date card"
      filename="forgenta-debt-free.png"
      share={{ title: 'My debt-free date', campaign: 'debt_free_date' }}
      buttonTestId="share-debt-free"
    />
  );
}
