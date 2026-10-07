import { useState } from 'react';
import { Link } from 'react-router';
import { DollarSign, TrendingDown, CreditCard, ArrowLeftRight, BarChart2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import CalcDrawer, { type CalcDrawerLine } from '@/components/shared/CalcDrawer';
import { formatCurrency } from '@/lib/calculations';
import { useBudgetMonthTotals } from '@/hooks/useBudgetMonthTotals';
import { useAccounts, useProfile, useRecurringRules } from '@/hooks/useSupabaseData';
import { useEffectiveSalaryProfile } from '@/hooks/useEffectiveSalaryProfile';
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

type BudgetTileProps = {
  label: string;
  value: string;
  sub?: string;
  accent: 'gold' | 'crimson' | 'success';
  icon: LucideIcon;
  onOpen: () => void;
  figureClass: string;
  className?: string;
  /** Spans the whole row on a phone. Laid out label-left, figure-right there, so a full-width
   * tile is not a box with its right half empty (Tre, 2026-10-05, ask 4ee0a129). */
  wide?: boolean;
};

const ACCENT_TEXT = { gold: 'text-primary', crimson: 'text-destructive-text', success: 'text-success-text' } as const;
const ACCENT_GLOW = {
  gold: 'shadow-[0_0_20px_-8px_hsl(var(--gold)/0.3)]',
  crimson: 'shadow-[0_0_20px_-8px_hsl(var(--crimson)/0.2)]',
  success: 'shadow-[0_0_20px_-8px_hsl(var(--success)/0.2)]',
} as const;

/**
 * One type size for every figure in the section, stepped by the LONGEST value. Per-tile sizing
 * (MetricCard's ladder) put "$1,125.00" and "$1,470.00" on different baselines in the same row.
 * Phone steps by length; md+ is a fixed size because the tiles are wide enough for any
 * realistic figure, and the gate in scripts/check-budget-tiles.mjs asserts none wraps or clips.
 */
export function sharedFigureClass(values: string[]): string {
  const longest = Math.max(0, ...values.map(v => v.length));
  const phone = longest <= 9 ? 'text-xl' : longest <= 11 ? 'text-lg' : 'text-base';
  return `${phone} md:text-xl xl:text-2xl`;
}

/**
 * A compact, whole-tile button. The icon sits in the label row (no separate chip, so no nested
 * rounded box to keep concentric) and the chart glyph marks "opens the arithmetic" at the end of
 * that same row, instead of floating in a corner of empty space.
 */
function BudgetTile({ label, value, sub, accent, icon: Icon, onOpen, figureClass, className, wide = false }: BudgetTileProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${label} ${value}${sub ? `, ${sub}` : ''} — show how it adds up`}
      className={cn(
        'card-forged relative overflow-hidden w-full h-full text-left p-3 md:px-4 flex flex-col justify-start gap-1',
        'hover:border-primary/20 transition-colors duration-300',
        ACCENT_GLOW[accent],
        wide && 'max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-3',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <Icon size={14} className={cn('shrink-0', ACCENT_TEXT[accent])} aria-hidden="true" />
        <span className="text-[10px] md:text-xs font-medium text-muted-foreground uppercase tracking-wide leading-snug min-[360px]:whitespace-nowrap min-w-0">
          {label}
        </span>
        <BarChart2 size={12} className="ml-auto shrink-0 text-muted-foreground" aria-hidden="true" data-testid="budget-tile-glyph" />
      </span>
      <p className={cn('font-display font-bold tracking-tight whitespace-nowrap tabular-nums', figureClass, ACCENT_TEXT[accent], wide && 'max-md:col-start-2 max-md:row-start-1 max-md:row-span-2 max-md:text-right')}>
        {value}
      </p>
      {sub && <p className={cn('text-[11px] md:text-xs text-muted-foreground leading-snug', wide && 'max-md:col-start-1 max-md:row-start-2')}>{sub}</p>}
    </button>
  );
}

/** "3 items" - how many active rows the drawer behind a tile adds up. */
function countLabel(rows: BudgetRule[]): string {
  const n = rows.filter(r => r.active).length;
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

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
    { label: 'Gross per paycheck', value: formatCurrency(paycheckGross) },
  ];
  if (preTax > 0) {
    lines.push({ label: 'Pre-tax deductions (reduces taxable income)', value: formatCurrency(preTax), op: '−' });
    lines.push({ label: 'Taxable gross per paycheck', value: formatCurrency(paycheckGross - preTax), op: '=' });
  }
  if (!taxViaDeductions) {
    lines.push({ label: `Income tax (${payConfig.taxRate}%)`, value: formatCurrency((paycheckGross - preTax) * payConfig.taxRate / 100), op: '−' });
    if (preTax > 0) {
      lines.push({ label: 'Tax saved by pre-tax deductions', value: formatCurrency(preTax * payConfig.taxRate / 100) });
    }
    if (postTax > 0) {
      lines.push({ label: 'Other post-tax deductions', value: formatCurrency(postTax), op: '−' });
    }
  } else {
    lines.push({ label: 'Tax withheld via deductions (Fed Withholding / FICA / OASDI)', value: formatCurrency(postTax), op: '−' });
  }
  lines.push({ label: 'Net per paycheck', value: formatCurrency(paycheckNet), op: '=' });
  lines.push({ label: 'Paychecks this month', value: String(paychecks.length) });
  lines.push({ label: 'Total monthly take-home', value: formatCurrency(monthlyTakeHome), op: '=' });
  return lines;
}

export default function BudgetTotalsCard() {
  const { buckets, totals, toCurrentMonthAmount } = useBudgetMonthTotals();
  const { data: rawProfile } = useProfile();
  const { data: rules } = useRecurringRules();
  const { data: accounts } = useAccounts();
  // The legacy $1,875 default is not a salary for a never-onboarded user with no income rule.
  const profile = useEffectiveSalaryProfile(rawProfile, rules, accounts);
  const [calcDrawer, setCalcDrawer] = useState<{ title: string; lines: CalcDrawerLine[] } | null>(null);

  const now = new Date();
  const { incomeRules, fixedRules, variableRules, debtRules, transferRules } = buckets;

  // No rule in any bucket and no salary on the profile: every tile below would be a $0 the user
  // never entered. Say what is missing instead, and link to where it is added.
  const nothingEntered = Number(profile?.weekly_gross_income) <= 0
    && [incomeRules, fixedRules, variableRules, debtRules, transferRules].every(rows => rows.length === 0);
  if (nothingEntered) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          This Month's Budget
        </h3>
        <div className="card-forged p-4 sm:p-5">
          <p className="text-sm sm:text-base font-semibold">No budget yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your pay and your regular bills, and this month's income and spending add up here.
          </p>
          <Link to="/budget" className="inline-flex mt-3 text-xs font-medium text-primary hover:underline">
            Add income &amp; expenses
          </Link>
        </div>
      </div>
    );
  }

  const rowLines = (rows: BudgetRule[]): CalcDrawerLine[] => rows
    .filter(r => r.active)
    .map(r => ({ label: r.name, value: formatCurrency(toCurrentMonthAmount(r)) }));

  const openIncomeCalc = () => {
    const lines = paycheckLines(profile, now);
    incomeRules.filter(r => r.active).forEach(r =>
      lines.push({ label: `  Rule: ${r.name}`, value: formatCurrency(toCurrentMonthAmount(r)), op: '+' }),
    );
    lines.push({ label: 'Total recurring income', value: formatCurrency(totals.income), op: '=' });
    setCalcDrawer({ title: 'Income This Month', lines });
  };

  const openFixedCalc = () => setCalcDrawer({
    title: 'Fixed Expenses This Month',
    lines: [...rowLines(fixedRules), { label: 'Total Fixed Expenses', value: formatCurrency(totals.fixed), op: '=' }],
  });

  const openVariableCalc = () => setCalcDrawer({
    title: 'Variable Expenses This Month',
    lines: [...rowLines(variableRules), { label: 'Total Variable Expenses', value: formatCurrency(totals.variable), op: '=' }],
  });

  const openDebtCalc = () => setCalcDrawer({
    title: 'Debt Payments This Month',
    lines: [...rowLines(debtRules), { label: 'Total Debt Payments', value: formatCurrency(totals.debt), op: '=' }],
  });

  const openTransferCalc = () => {
    const lines: CalcDrawerLine[] = [
      ...rowLines(transferRules),
      { label: 'Total Transfers', value: formatCurrency(totals.transfers), op: '=' },
    ];
    // ⚠️ The ranked extra is LISTED, never summed in. It is paid out of the same surplus the debt
    // recommendations are already sized from, so adding it to this total would spend the same
    // dollars twice and understate what is left.
    transferRules
      .filter(r => r.active && (r.extraThisMonth ?? 0) > 0)
      .forEach(r => lines.push({
        label: `${r.name} — extra this month, from surplus`,
        value: formatCurrency(r.extraThisMonth ?? 0),
      }));
    // Same rule for the month that has none: name the next one instead of leaving the drawer
    // silent about a goal the forecast is going to start topping up.
    transferRules
      .filter(r => r.active && (r.extraThisMonth ?? 0) === 0 && r.nextExtra)
      .forEach(r => lines.push({
        label: `${r.name} — next extra from surplus, ${nextExtraMonthLabel(r.nextExtra!.monthIndex, now)}`,
        value: formatCurrency(r.nextExtra!.amount),
      }));
    setCalcDrawer({ title: 'Transfers This Month', lines });
  };

  const spendLines = (multiplier: number): CalcDrawerLine[] => [
    { label: 'Fixed Expenses', value: formatCurrency(totals.fixed * multiplier) },
    { label: 'Variable Expenses', value: formatCurrency(totals.variable * multiplier), op: '+' },
    { label: 'Debt Payments', value: formatCurrency(totals.debt * multiplier), op: '+' },
    { label: 'Transfers & Investing', value: formatCurrency(totals.transfers * multiplier), op: '+' },
  ];

  const openMonthlySpendCalc = () => setCalcDrawer({
    title: 'Monthly Spend Breakdown (planned)',
    lines: [...spendLines(1), { label: 'Total planned monthly spend', value: formatCurrency(totals.expenses), op: '=' }],
  });

  const openAnnualSpendCalc = () => setCalcDrawer({
    title: 'Annual Spend Breakdown (× 12)',
    lines: [...spendLines(12), { label: 'Total Annual Spend', value: formatCurrency(totals.expenses * 12), op: '=' }],
  });

  const tiles: Omit<BudgetTileProps, 'figureClass'>[] = [
    { label: 'Monthly Income', value: formatCurrency(totals.income), sub: 'recurring', accent: 'success', icon: DollarSign, onOpen: openIncomeCalc, wide: true, className: 'col-span-2 md:col-span-3' },
    { label: 'Fixed Expenses', sub: countLabel(fixedRules), value: formatCurrency(totals.fixed), accent: 'crimson', icon: TrendingDown, onOpen: openFixedCalc, className: 'md:col-span-3' },
    { label: 'Variable', sub: countLabel(variableRules), value: formatCurrency(totals.variable), accent: 'gold', icon: TrendingDown, onOpen: openVariableCalc, className: 'md:col-span-3' },
    { label: 'Debt Payments', sub: countLabel(debtRules), value: formatCurrency(totals.debt), accent: 'crimson', icon: CreditCard, onOpen: openDebtCalc, className: 'md:col-span-3' },
    { label: 'Transfers', sub: countLabel(transferRules), value: formatCurrency(totals.transfers), accent: 'gold', icon: ArrowLeftRight, onOpen: openTransferCalc, className: 'md:col-span-4' },
    // "planned" is load-bearing (§2.4 step 10): this is the sum of the budget RULES, not of
    // anything that happened. Unlabeled it reads as an actual and gets compared to MONTHLY
    // EXPENSES further down this same page, which is a different question entirely.
    { label: 'Monthly Spend', sub: 'planned (from rules)', value: formatCurrency(totals.expenses), accent: 'crimson', icon: TrendingDown, onOpen: openMonthlySpendCalc, className: 'md:col-span-4' },
    { label: 'Annual Spend', sub: 'planned × 12', value: formatCurrency(totals.expenses * 12), accent: 'crimson', icon: TrendingDown, onOpen: openAnnualSpendCalc, className: 'md:col-span-4' },
  ];
  const figureClass = sharedFigureClass(tiles.map(t => t.value));

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        This Month's Budget
      </h3>
      {/* ONE grid, no ragged rows (Tre, 2026-10-03: "items fill their boxes more or the boxes shrink").
          Phone: income takes a full row laid out label-left, figure-right, then three rows of two.
          md+: a 12-column grid, four tiles of 3 then three tiles of 4, so both rows are full and no
          tile is double width (Tre, 2026-10-05: "the monthly income box is to big"). Every figure in the
          section shares ONE type size (chosen from the longest), so figures in a row sit on one
          baseline and nothing re-fits as a number changes. */}
      <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
        {tiles.map(t => (
          <BudgetTile key={t.label} {...t} figureClass={figureClass} />
        ))}
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
