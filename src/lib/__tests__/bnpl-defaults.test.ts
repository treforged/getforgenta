import { describe, it, expect } from 'vitest';
import { payInFourDefaults } from '../bnpl-defaults';

describe('payInFourDefaults', () => {
  it.each(['PayPal Pay in 4', 'Paypal Pay in 4', 'Paypal 4', 'Klarna Pay in 4', 'Afterpay', 'pay-in-4', 'Pay in four', 'PYPL PAYIN4'])(
    'sets every 2 weeks x 4 for "%s"', (p) => {
      expect(payInFourDefaults(p)).toEqual({ frequency: 'biweekly', total_payments: '4' });
    });
  it.each(['', 'Amazon 12 Months', 'Flex Pay', 'MOTHER', 'Affirm', 'Pay in 12', 'PayPal Credit'])(
    'leaves "%s" alone', (p) => {
      expect(payInFourDefaults(p)).toBeNull();
    });
});
