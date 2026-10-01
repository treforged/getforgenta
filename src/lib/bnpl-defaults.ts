/**
 * Schedule defaults for a "Pay in 4" provider (PayPal, Klarna, Afterpay). These charge 4 payments
 * EVERY TWO WEEKS by product definition.
 *
 * ⚠️ WHY THIS EXISTS. The plan form defaults to monthly, and its own placeholder suggests
 * "PayPal Pay in 4". On 2026-10-01 a live user had four Pay in 4 plans saved as monthly. Three were
 * already fully paid by 09-27, and the app still scheduled $455.83 of October payments before his
 * lowest day, which held his Safe to Spend $455.83 too low.
 */
const PAY_IN_FOUR = /pay\s*-?\s*in\s*-?\s*(4|four)\b|payin4|\bpaypal\s*4\b|afterpay/i;

export function payInFourDefaults(provider: string): { frequency: 'biweekly'; total_payments: '4' } | null {
  return PAY_IN_FOUR.test(provider) ? { frequency: 'biweekly', total_payments: '4' } : null;
}
