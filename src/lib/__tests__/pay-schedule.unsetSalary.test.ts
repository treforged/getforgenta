import { describe, it, expect } from 'vitest';
import { buildPayConfig, getMonthNetIncome, getPaycheckNet } from '../pay-schedule';

// Ask 9f385515: an unset salary used to become $1,875/week, so an empty account's forecast
// drew a $97,500 salary from month 1 on.
describe('buildPayConfig with no salary entered', () => {
  it.each([null, undefined, 0, '0', ''])('weekly_gross_income %p projects no pay', (wg) => {
    const cfg = buildPayConfig({ weekly_gross_income: wg as never });
    expect(cfg.weeklyGross).toBe(0);
    expect(getPaycheckNet(cfg)).toBe(0);
    expect(getMonthNetIncome(cfg, 2026, 9)).toBe(0);
  });

  it('flat deductions do not turn a missing salary into negative pay', () => {
    const cfg = buildPayConfig({
      weekly_gross_income: 0,
      paycheck_deductions: [{ value: 50, mode: 'flat', preTax: false, label: 'Union dues' }] as never,
    });
    expect(getPaycheckNet(cfg)).toBe(0);
    expect(getMonthNetIncome(cfg, 2026, 9)).toBe(0);
  });

  it('a salary that IS set is unchanged (1093/week, 22%, weekly)', () => {
    const cfg = buildPayConfig({ weekly_gross_income: 1093, tax_rate: 22, paycheck_frequency: 'weekly' });
    expect(cfg.weeklyGross).toBe(1093);
    expect(getPaycheckNet(cfg)).toBeCloseTo(1093 * 0.78, 6);
  });
});
