// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The native paywall's intro-offer copy (ask a6375f1c), rendered with the store calls mocked.
 * It proves what the paywall SAYS for each eligibility answer. It cannot prove the store applies
 * the offer - only a device purchase does.
 */
const eligibility = vi.hoisted(() => ({ value: {} as Record<string, number> }));

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true } }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: false, refetch: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/purchases', () => {
  const pkg = (identifier: string, packageType: string, productId: string, priceString: string, introPrice: unknown) =>
    ({ identifier, packageType, product: { identifier: productId, priceString, introPrice } });
  return {
    getOfferings: vi.fn(async () => ({
      current: {
        availablePackages: [
          pkg('$rc_annual', 'ANNUAL', 'premium_yearly', '$89.99',
            { price: 10, priceString: '$10.00', cycles: 1, period: 'P1Y', periodUnit: 'YEAR', periodNumberOfUnits: 1 }),
          pkg('$rc_monthly', 'MONTHLY', 'premium_monthly', '$9.99',
            { price: 1, priceString: '$1.00', cycles: 12, period: 'P1M', periodUnit: 'MONTH', periodNumberOfUnits: 1 }),
        ],
      },
    })),
    getIntroEligibility: vi.fn(async () => eligibility.value),
    purchasePackage: vi.fn(),
    restorePurchases: vi.fn(),
    presentCodeRedemptionSheet: vi.fn(),
    openAndroidOfferRedemption: vi.fn(),
  };
});

import NativePaywall from '../NativePaywall';

const cta = () => screen.getByRole('button', { name: /^Get Premium/ });

describe('NativePaywall intro offer (iOS)', () => {
  beforeEach(() => { eligibility.value = {}; });

  it('eligible: both rows show the offer, and the CTA follows the selected row', async () => {
    eligibility.value = { premium_yearly: 2, premium_monthly: 2 };
    render(<NativePaywall />);
    await waitFor(() => expect(screen.getAllByTestId('native-intro-offer')).toHaveLength(2));
    const rows = screen.getAllByTestId('native-intro-offer').map((e) => e.textContent);
    expect(rows).toEqual([
      '$10.00 for your first year, then $89.99/yr',
      '$1.00/mo for your first year, then $9.99/mo',
    ]);
    expect(cta().textContent).toContain('Get Premium — $10.00 first year');
    fireEvent.click(screen.getByRole('button', { name: /^Monthly/ }));
    expect(cta().textContent).toContain('Get Premium — $1.00/mo first year');
  });

  it('ineligible or unknown: no offer copy, regular prices', async () => {
    eligibility.value = { premium_yearly: 1, premium_monthly: 0 };
    render(<NativePaywall />);
    await waitFor(() => expect(cta().textContent).toContain('Get Premium — $89.99'));
    expect(screen.queryAllByTestId('native-intro-offer')).toHaveLength(0);
    expect(screen.getByText('$89.99/year')).toBeTruthy();
  });
});
