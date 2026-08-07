// Finding §1.1 cause C regression guard.
//
// The bug: "already reflected in the balance" was decided in four places with three different
// rules — the hook used strict `<` on the raw sync date, the engine used `<=` for insurance and no
// gate at all for car loans, and each caller re-derived the date inline. Forecast charged a $537
// car-loan payment the Dashboard dropped, in the same month, for the same loan.
//
// THE POINT OF THIS FILE: pin the one rule. If someone reintroduces a second definition, or drops
// the settlement lag, or lets a future-dated sync swallow charges, these fail.

import { describe, it, expect } from 'vitest';
import {
  SETTLEMENT_LAG_DAYS, resolveSyncCutoffDate, isCapturedInBalance, dueDateInMonth,
} from '../sync-cutoff';

describe('resolveSyncCutoffDate', () => {
  it('returns the sync date itself — the lag is NOT applied here', () => {
    // This date also gates income. Lagging it re-admitted a $1,463 deposit already sitting in the
    // balance and moved Forecast month-0 END CASH $2,346 -> $4,346 (verified live 2026-08-05).
    // The lag is an outflow-only correction and lives in isCapturedInBalance.
    expect(resolveSyncCutoffDate({ lastSyncedAt: '2026-08-05T13:00:00Z', today: '2026-08-05' }))
      .toBe('2026-08-05');
    expect(SETTLEMENT_LAG_DAYS).toBe(3);
  });

  it('prefers the Plaid sync date over the manual row timestamp', () => {
    expect(resolveSyncCutoffDate({
      lastSyncedAt: '2026-08-05T13:00:00Z', balanceUpdatedAt: '2026-07-01T00:00:00Z', today: '2026-08-05',
    })).toBe('2026-08-05');
  });

  it('falls back to the manual balance timestamp when there is no Plaid link', () => {
    // A typed balance is current as of when the row was written — not as of today.
    expect(resolveSyncCutoffDate({ balanceUpdatedAt: '2026-07-20T09:00:00Z', today: '2026-08-05' }))
      .toBe('2026-07-20');
  });

  it('falls back to today when no timestamp is available at all', () => {
    expect(resolveSyncCutoffDate({ today: '2026-08-05' })).toBe('2026-08-05');
  });

  it('treats an empty timestamp as absent, not as a date', () => {
    // Demo account fixtures carry `updated_at: ''`. Parsing one gives NaN and a cutoff string that
    // captures nothing — one empty string would silently change every month-0 total.
    expect(resolveSyncCutoffDate({ balanceUpdatedAt: '', today: '2026-08-05' })).toBe('2026-08-05');
    expect(resolveSyncCutoffDate({ lastSyncedAt: '', balanceUpdatedAt: '2026-07-20T00:00:00Z', today: '2026-08-05' }))
      .toBe('2026-07-20');
  });

  it('never returns a cutoff past today, even with a future-dated sync', () => {
    // Clock skew or a bad timestamp must not silently swallow charges still to come.
    expect(resolveSyncCutoffDate({ lastSyncedAt: '2026-09-30T00:00:00Z', today: '2026-08-05' }))
      .toBe('2026-08-05');
  });

  it('applies the lag across month and year boundaries', () => {
    expect(isCapturedInBalance('2026-02-26', '2026-03-02')).toBe(true);
    expect(isCapturedInBalance('2026-02-27', '2026-03-02')).toBe(false);
    expect(isCapturedInBalance('2026-12-28', '2027-01-01')).toBe(true);
    expect(isCapturedInBalance('2026-12-29', '2027-01-01')).toBe(false);
  });
});

describe('isCapturedInBalance', () => {
  it('holds a charge inside the settlement window as NOT yet captured', () => {
    // Plaid stores balances.current, which excludes pending, so a debit due within the lag window
    // may have posted without settling and is absent from the balance we hold.
    expect(isCapturedInBalance('2026-08-04', '2026-08-05')).toBe(false);
    expect(isCapturedInBalance('2026-08-02', '2026-08-05')).toBe(false);
    expect(isCapturedInBalance('2026-08-01', '2026-08-05')).toBe(true);
  });

  it('treats a charge due ON the lagged boundary as not yet captured', () => {
    // Strict `<`. The engine used `<=` for loan insurance while the hook used `<`, so a due date
    // landing exactly on the boundary was charged by one surface and dropped by the other.
    expect(isCapturedInBalance('2026-08-02', '2026-08-05')).toBe(false);
  });
});

describe('isCapturedInBalance — §1A Stage C evidence', () => {
  // Stage C DEMOTES the date heuristic from the rule to the fallback. When settled transactions
  // cover the due date, they answer the question directly and the lag is not consulted at all.

  it('trusts a matched settled transaction over the date heuristic', () => {
    // Due yesterday, well inside the lag window, so the heuristic alone says "not captured".
    // A settled transaction matching it says otherwise, and it is evidence, not a guess.
    expect(isCapturedInBalance('2026-08-04', '2026-08-05')).toBe(false);
    expect(isCapturedInBalance('2026-08-04', '2026-08-05', { hasTxnCoverage: true, matched: true }))
      .toBe(true);
  });

  it('treats covered-but-unmatched as genuinely NOT captured', () => {
    // Old-enough due date the heuristic would have assumed settled. With full coverage of its
    // window and no matching transaction, the charge demonstrably has not hit — keep charging it.
    expect(isCapturedInBalance('2026-07-01', '2026-08-05')).toBe(true);
    expect(isCapturedInBalance('2026-07-01', '2026-08-05', { hasTxnCoverage: true, matched: false }))
      .toBe(false);
  });

  it('falls back to the date heuristic when there is no coverage', () => {
    // Non-negotiable branch: manual accounts, brand-new connections and un-backfilled
    // institutions have no evidence at all, and deleting the heuristic would regress every one.
    const noEvidence = { hasTxnCoverage: false, matched: false };
    expect(isCapturedInBalance('2026-08-01', '2026-08-05', noEvidence)).toBe(true);
    expect(isCapturedInBalance('2026-08-04', '2026-08-05', noEvidence)).toBe(false);
  });

  it('honours a match even where coverage was not claimed', () => {
    // Coverage requires the WHOLE match window to have been observed, so a match can land just
    // outside it. A real settled transaction outranks a conservatism about window completeness.
    expect(isCapturedInBalance('2026-08-04', '2026-08-05', { hasTxnCoverage: false, matched: true }))
      .toBe(true);
  });

  it('is unchanged for every caller that passes no evidence', () => {
    // The parameter is optional so Stage C can be wired one call site at a time.
    expect(isCapturedInBalance('2026-08-01', '2026-08-05', undefined)).toBe(true);
    expect(isCapturedInBalance('2026-08-04', '2026-08-05', undefined)).toBe(false);
  });
});

describe('dueDateInMonth', () => {
  it('zero-pads the day so string comparison is date comparison', () => {
    expect(dueDateInMonth('2026-08', 1)).toBe('2026-08-01');
    expect(dueDateInMonth('2026-08', 15)).toBe('2026-08-15');
    // The whole gate is string `<`, which only works while every date is fixed-width.
    expect(dueDateInMonth('2026-08', 9) < dueDateInMonth('2026-08', 10)).toBe(true);
  });
});
