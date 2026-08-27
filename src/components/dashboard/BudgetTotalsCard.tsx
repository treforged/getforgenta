import { useState } from 'react';
import { DollarSign, TrendingDown, CreditCard, ArrowLeftRight } from 'lucide-react';
import MetricCard from '@/components/shared/MetricCard';
import CalcDrawer, { type CalcDrawerLine } from '@/components/shared/CalcDrawer';
import { formatCurrency } from '@/lib/calculations';
import { useBudgetMonthTotals } from '@/hooks/useBudgetMonthTotals';
import { useProfile } from '@/hooks/useSupabaseData';
import { buildPayConfig, getPaycheckNet, getPaychecksInMonth } from '@/lib/pay-schedule';
import { nextExtraMonthLabel, type BudgetRule } from '@/lib/budget-month-totals';

/**
 * THE MONTH'S BUDGET, ON THE DASHBOARD — the seven figures that used to open Budget Control.
 *
 * Tre, 2026-08-27, with a screenshot of that page's KPI row: *"i wanted these moved to
 * dashboard"* — *"some are actually already answered on the dashboard so they could be deleted
 * instead of duplicating"*. Seven moved; the eighth, Remaining Cash, was deleted rather than
 * moved, because the Dashboard's SAFE TO PAY is the same engine figure under another name.
 *
 * ⚠️ IT DERIVES NOTHING. Every figure comes from `useBudgetMonthTotals`, the one hook Budget
 * Control reads too, so the two pages agree by construction rather than by inspection. Four of
 * the five buckets are merged from other tables (Subscriptions, Debt Payoff, Vehicles, Savings
 * Goals); a second copy of that assembly is the bug this shape exists to prevent.
 *
 * The drawers are OWNED HERE, state and all. They are the reason a tile is worth tapping, and a
 * card that shows the number without the arithmetic is a worse card than the one it replaced.
 */

/** The paycheck lines at the top of the Income drawer, from the profile the pay schedule lives in. */
function paycheckLines(profile: Parameters<typeof buildPayConfig>[0], now: Date): CalcDrawerLine[] {
  const payConfig = buildPayConfig(profile);
  const frequency = payConfig.frequency;
  const paycheckGross = frequency === 'biweekly' ? payConfig.weeklyGross * 2
    : frequency === 'monthly' ? payConfig.weeklyGross * 52 / 12
      : payConfig.weeklyGross;
  const preTax = payConfig.preTaxDeductions ?? 0;
  const postTax = payConfig.postTaxDeductions ?? 0;
  // `buildPayConfig` zeroes the rate when withholding/FICA/OASDI are itemized as deductions —
  // those ARE the tax, and charging `taxRate` on top would count it twice. A zero rate is
  // therefore the signal that the deductions are carrying it, which is what Budget Control's
  // `hasTaxDeductions` means on its own copy of this drawer.
  const taxViaDeductions = payConfig.taxRate === 0;
  const paycheckNet = getPaycheckNet(payConfig);
  const paychecks = getPaychecksInMonth(payConfig, now.getFullYear(), now.getMonth());
  const monthlyTakeHome = paycheckNet * paychecks.length;

  const lines: CalcDrawerLine[] = [
    { label: `Pay frequency: ${frequency}`, value: '' },
    { label: 'Gross per paycheck', value: formatCurrency(paycheckGross, false) },
  ];
  if (preTax > 0) {
    lines.push({ label: 'Pre-tax deductions (reduces taxable income)', value: formatCurrency(preTax, false), op: '−' });
    lines.push({ label: 'Taxable gross per paycheck', value: formatCurrency(paycheckGross - preTax, false), op: '=' });
  }
  if (!taxViaDeductions) {
    lines.push({ label: `Income tax (${payConfig.taxRate}%)`, value: formatCurrency((paycheckGross - preTax) * payConfig.taxRate / 100, false), op: '−' });
    if (preTax > 0) {
      lines.push({ label: 'Tax saved by pre-tax deductions', value: formatCurrency(preTax * payConfig.taxRate / 100, false) });
    }
    if (postTax > 0) {
      lines.push({ label: 'Other post-tax deductions', value: formatCurrency(postTax, false), op: '−' });
    }
  } else {
    lines.push({ label: 'Tax withheld via deductions (Fed Withholding / FICA / OASDI)', value: formatCurrency(postTax, false), op: '−' });
  }
  lines.push({ label: 'Net per paycheck', value: formatCurrency(paycheckNet, false), op: '=' });
  lines.push({ label: 'Paychecks this month', value: String(paychecks.length) });
  lines.push({ label: 'Total monthly take-home', value: formatCurrency(monthlyTakeHome, false), op: '=' });
  return lines;
}

export default function BudgetTotalsCard() {
  const { buckets, totals, toCurrentMonthAmount } = useBudgetMonthTotals();
  const { data: profile } = useProfile();
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: CalcDrawerLine[] } | null>(null);

  const now = new Date();
  const { incomeRules, fixedRules, variableRules, debtRules, transferRules } = buckets;

  const rowLines = (rows: BudgetRule[]): CalcDrawerLine[] => rows
    .filter(r => r.active)
    .map(r => ({ label: r.name, value: formatCurrency(toCurrentMonthAmount(r), false) }));

  const openIncomeCalc = () => {
    const lines = paycheckLines(profile, now);
    incomeRules.filter(r => r.active).forEach(r =>
      lines.push({ label: `  Rule: ${r.name}`, value: formatCurrency(toCurrentMonthAmount(r), false), op: '+' }),
    );
    lines.push({ label: 'Total recurring income', value: formatCurrency(totals.income, false), op: '=' });
    setCalcDrawer({ title: 'Income This Month', lines });
  };

  const openFixedCalc = () => setCalcDrawer({
    title: 'Fixed Expenses This Month',
    lines: [...rowLines(fixedRules), { label: 'Total Fixed Expenses', value: formatCurrency(totals.fixed, false), op: '=' }],
  });

  const openVariableCalc = () => setCalcDrawer({
    title: 'Variable Expenses This Month',
    lines: [...rowLines(variableRules), { label: 'Total Variable Expenses', value: formatCurrency(totals.variable, false), op: '=' }],
  });

  const openDebtCalc = () => setCalcDrawer({
    title: 'Debt Payments This Month',
    lines: [...rowLines(debtRules), { label: 'Total Debt Payments', value: formatCurrency(totals.debt, false), op: '=' }],
  });

  const openTransferCalc = () => {
    const lines: CalcDrawerLine[] = [
      ...rowLines(transferRules),
      { label: 'Total Transfers', value: formatCurrency(totals.transfers, false), op: '=' },
    ];
    // ⚠️ The ranked extra is LISTED, never summed in. It is paid out of the same surplus the debt
    // recommendations are already sized from, so adding it to this total would spend the same
    // dollars twice and understate what is left.
    transferRules
      .filter(r => r.active && (r.extraThisMonth ?? 0) > 0)
      .forEach(r => lines.push({
        label: `${r.name} — extra this month, from surplus`,
        value: formatCurrency(r.extraThisMonth ?? 0, false),
      }));
    // Same rule for the month that has none: name the next one instead of leaving the drawer
    // silent about a goal the forecast is going to start topping up.
    transferRules
      .filter(r => r.active && (r.extraThisMonth ?? 0) === 0 && r.nextExtra)
      .forEach(r => lines.push({
        label: `${r.name} — next extra from surplus, ${nextExtraMonthLabel(r.nextExtra!.monthIndex, now)}`,
        value: formatCurrency(r.nextExtra!.amount, false),
      }));
    setCalcDrawer({ title: 'Transfers This Month', lines });
  };

  const spendLines = (multiplier: number): CalcDrawerLine[] => [
    { label: 'Fixed Expenses', value: formatCurrency(totals.fixed * multiplier, false) },
    { label: 'Variable Expenses', value: formatCurrency(totals.variable * multiplier, false), op: '+' },
    { label: 'Debt Payments', value: formatCurrency(totals.debt * multiplier, false), op: '+' },
    { label: 'Transfers & Investing', value: formatCurrency(totals.transfers * multiplier, false), op: '+' },
  ];

  const openMonthlySpendCalc = () => setCalcDrawer({
    title: 'Monthly Spend Breakdown (planned)',
    lines: [...spendLines(1), { label: 'Total planned monthly spend', value: formatCurrency(totals.expenses, false), op: '=' }],
  });

  const openAnnualSpendCalc = () => setCalcDrawer({
    title: 'Annual Spend Breakdown (× 12)',
    lines: [...spendLines(12), { label: 'Total Annual Spend', value: formatCurrency(totals.expenses * 12, false), op: '=' }],
  });

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        This Month's Budget
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="cursor-pointer" onClick={openIncomeCalc}>
          <MetricCard label="Monthly Income" value={formatCurrency(totals.income, false)} accent="success" icon={DollarSign} clickHint />
        </div>
        <div className="cursor-pointer" onClick={openFixedCalc}>
          <MetricCard label="Fixed Expenses" value={formatCurrency(totals.fixed, false)} accent="crimson" icon={TrendingDown} clickHint />
        </div>
        <div className="cursor-pointer" onClick={openVariableCalc}>
          <MetricCard label="Variable" value={formatCurrency(totals.variable, false)} accent="gold" icon={TrendingDown} clickHint />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="cursor-pointer" onClick={openDebtCalc}>
          <MetricCard label="Debt Payments" value={formatCurrency(totals.debt, false)} accent="crimson" icon={CreditCard} clickHint />
        </div>
        <div className="cursor-pointer" onClick={openTransferCalc}>
          <MetricCard label="Transfers" value={formatCurrency(totals.transfers, false)} accent="gold" icon={ArrowLeftRight} clickHint />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="cursor-pointer" onClick={openMonthlySpendCalc}>
          {/* "planned" is load-bearing (§2.4 step 10): this is the sum of the budget RULES, not of
              anything that happened. Unlabeled it reads as an actual and gets compared to MONTHLY
              EXPENSES further down this same page, which is a different question entirely. */}
          <MetricCard label="Monthly Spend" sub="planned (from rules)" value={formatCurrency(totals.expenses, false)} accent="crimson" icon={TrendingDown} clickHint />
        </div>
        <div className="cursor-pointer" onClick={openAnnualSpendCalc}>
          <MetricCard label="Annual Spend" value={formatCurrency(totals.expenses * 12, false)} accent="crimson" icon={TrendingDown} clickHint />
        </div>
      </div>

      <CalcDrawer
        open={!!calcDrawer}
        onClose={() => setCalcDrawer(null)}
        title={calcDrawer?.title || ''}
        lines={calcDrawer?.lines || []}
      />
    </div>
  );
}
