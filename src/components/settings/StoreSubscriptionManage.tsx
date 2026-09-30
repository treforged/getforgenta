import { ExternalLink } from 'lucide-react';

/**
 * 5874c945 - A STORE SUBSCRIBER MUST BE ABLE TO FIND CANCEL ON THE PLAN CARD.
 *
 * An App Store or Google Play subscription cannot be cancelled by this app - only by the store -
 * so the Plan card's Stripe controls never render for one. Until this component, the store's
 * cancel steps appeared ONLY inside Delete Account: a subscriber looking for "cancel" where every
 * app puts it found a status and a renewal date and nothing else. That is the hard-to-cancel
 * shape, so the link lives where the subscription is shown.
 *
 * Linking to the store's own subscription page is what Apple and Google ask apps to do; it opens
 * the platform's management screen and changes no price or purchase.
 */
export const APPLE_MANAGE_URL = 'https://apps.apple.com/account/subscriptions';
export const GOOGLE_MANAGE_URL = 'https://play.google.com/store/account/subscriptions?package=com.treforged.forged';

export type StoreProvider = 'apple' | 'google';

export function storeManageUrl(provider: StoreProvider): string {
  return provider === 'apple' ? APPLE_MANAGE_URL : GOOGLE_MANAGE_URL;
}

export function StoreSubscriptionManage({ provider }: { provider: StoreProvider }) {
  const store = provider === 'apple' ? 'App Store' : 'Google Play';
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Your subscription is billed through {store}. You can change or cancel it there at any time.
      </p>
      <a
        href={storeManageUrl(provider)}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-md btn-secondary w-full sm:w-auto"
        style={{ borderRadius: 'var(--radius)' }}
      >
        <ExternalLink size={12} />
        Manage or cancel in {store}
      </a>
    </div>
  );
}
