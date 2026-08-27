import { formatCurrency } from '@/lib/calculations';
import { getCalendarYearMonthRange } from '@/lib/scheduling';
import { getPaychecksInMonth, type PayScheduleConfig } from '@/lib/pay-schedule';
import { adjustedDisplayBalance } from '@/lib/step3-display';
import { autoExtraFlowLabel } from '@/lib/forecast-export';
import { GENERATOR_LABEL, type DuplicateCollision } from '@/lib/duplicate-transaction-detection';
import type { CalcDrawerLine } from '@/components/shared/CalcDrawer';
import type { ForecastMonthRow } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import type { CarFund } from '@/lib/types';
import { buildOtherAccountLines } from '@/lib/other-account-lines';

/**
 * The Forecast's month-by-month receipts.
 *
 * Lifted out of `Forecast.tsx` unchanged — every column, both drawers, and the row `onClick`
 * behave exactly as they did; only the file they live in moved, so the page could lead with
 * its milestone instead of with a 60-row table. The table itself is now behind a disclosure
 * (`ReceiptsDisclosure`), which is the only reason it is not rendered on arrival.
 *
 * The duplicate-transaction warning that used to sit at the top of this card now renders
 * OUTSIDE the disclosure, on the page: a "this month is counted twice" banner hidden behind
 * a tap is a silent failure. The per-row "counted twice" chips stay here.
 */
type Props = {
  displayData: ForecastMonthRow[];
  filterYear: 'all' | '1' | '2' | '3' | '4' | '5';
  duplicatesByMonth: Map<string, DuplicateCollision[]>;
  payConfig: PayScheduleConfig;
  syncCutoffDate: string;
  cardProjectionData: CardProjectionResult | null;
  /** Cumulative PASS-3 surplus per card, so per-card balances match Debt Payoff and the export. */
  step3CumSurplus: Map<string, number[]>;
  carFunds: CarFund[];
  onOpenCalcDrawer: (drawer: { title: string; lines: CalcDrawerLine[] }) => void;
  onOpenFloorDrawer: (drawer: { title: string; lines: CalcDrawerLine[] }) => void;
};

export default function MonthlyBreakdownTable({
  displayData,
  filterYear,
  duplicatesByMonth,
  payConfig,
  syncCutoffDate,
  cardProjectionData,
  step3CumSurplus,
  carFunds,
  onOpenCalcDrawer,
  onOpenFloorDrawer,
}: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3 sm:mb-4">
        <span className="text-[9px] text-muted-foreground">1× = one-time purchase or income</span>
        <span className="text-[9px] text-muted-foreground">Tap any row for full breakdown</span>
      </div>
      {/* Column headers */}
      <div className="grid grid-cols-[5rem_1fr_1fr_1fr] border-b border-border pb-1.5 mb-0.5 text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
        <div className="px-1">Month</div>
        <div className="px-1 text-right">+Income</div>
        <div className="px-1 text-right">−Out</div>
        <div className="px-1 text-right">End Cash</div>
      </div>
      {/* Rows */}
      {displayData.map((row, i) => {
        // `row.month` is a display label ("Sep 2026"), so the key is rebuilt from the absolute
        // offset instead of parsed back out of it — the same arithmetic the drawer uses below.
        const rowAbsoluteI = filterYear === 'all' ? i : getCalendarYearMonthRange(parseInt(filterYear, 10))[0] + i;
        const rowMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() + rowAbsoluteI, 1);
        const rowMonthKey = `${rowMonthDate.getFullYear()}-${String(rowMonthDate.getMonth() + 1).padStart(2, '0')}`;
        const rowDuplicates = duplicatesByMonth.get(rowMonthKey) ?? [];
        const openDrawer = () => {
          const isCurrentMonth = i === 0 && (filterYear === 'all' || filterYear === '1');
          const paychecksPerYear = payConfig?.frequency === 'biweekly' ? 26 : payConfig?.frequency === 'monthly' ? 12 : 52;
          // Use actual paycheck count for this month — dividing by normalized 52/12 gives wrong
          // per-check (e.g. 4-Friday month ÷ 4.33 shows raise as lower than pre-raise amount).
          const absoluteI = filterYear === 'all' ? i : getCalendarYearMonthRange(parseInt(filterYear, 10))[0] + i;
          const _rowDate = new Date(new Date().getFullYear(), new Date().getMonth() + absoluteI, 1);
          const paycheckCount = getPaychecksInMonth(payConfig, _rowDate.getFullYear(), _rowDate.getMonth()).length;
          const perPaycheck = paycheckCount > 0
            ? (row.paycheckIncome ?? row.takeHome) / paycheckCount
            : (row.paycheckIncome ?? row.takeHome) / (paychecksPerYear / 12);
          const freqLabel = payConfig?.frequency === 'biweekly' ? 'biweekly' : payConfig?.frequency === 'monthly' ? 'monthly' : 'weekly';
          onOpenCalcDrawer({
            title: `${row.month} Breakdown`,
            lines: [
              // First, because every figure under it is wrong by this amount. No delete
              // button here on purpose: the drawer is a list of numbers, and a one-tap
              // irreversible delete does not belong inside one — the panel above the table
              // owns the fix.
              ...rowDuplicates.flatMap(c => [
                { label: `⚠ Counted twice: "${c.manual.note || c.manual.category || 'your manual row'}" (${c.manual.date}) also comes from the ${GENERATOR_LABEL[c.generated.kind]}`, value: formatCurrency(c.amount, true) },
                { label: '  Every figure below is short by that amount. Fix it in the banner above the Monthly Breakdown table.', value: '' },
              ]),
              ...(isCurrentMonth ? [{ label: '⏱ Reflects remaining of month — settled transactions excluded', value: '' }] : []),
              ...(row.isRaiseMonth ? [{ label: `⬆ Raise applied — new ${freqLabel} paycheck: ${formatCurrency(perPaycheck, true)}`, value: '' }] : []),
              ...((row.promotionNewSalary ?? 0) > 0 ? [{ label: `💼 Promotion applied — new annual salary: ${formatCurrency(row.promotionNewSalary, true)}`, value: '' }] : []),
              { label: isCurrentMonth ? 'Current Cash' : 'Starting Cash', value: formatCurrency(row.startingCash, true) },
              { label: 'Paycheck', value: formatCurrency(row.paycheckIncome ?? row.takeHome, true), op: '+' },
              ...((row.otherIncome ?? 0) > 0 ? [{ label: 'Other Income', value: formatCurrency(row.otherIncome, true), op: '+' }] : []),
              ...((row.bonusIncome ?? 0) > 0 ? [{ label: 'Bonus', value: formatCurrency(row.bonusIncome, true), op: '+' }] : []),
              ...((row.taxReturnIncome ?? 0) !== 0 ? [(row.taxReturnIncome ?? 0) > 0
                ? { label: 'Tax Return', value: formatCurrency(row.taxReturnIncome, true), op: '+' }
                : { label: 'Tax Owed', value: formatCurrency(Math.abs(row.taxReturnIncome), true), op: '−' }] : []),
              { label: '  Bills & Expenses', value: formatCurrency(row.baseExpenses ?? 0, true), op: '−' },
              // Per-card breakdown: month 0 uses engine recommendations (same source as
              // Dashboard widget and Debt Payoff summary list). Months 1+ use simulation.
              ...((() => {
                const fallback = [{ label: '  Debt Payments', value: formatCurrency(row.displayDebtPayment ?? row.debtPayment, true), op: '−' as const }];
                // Month 0: use pass-3 per-card amounts (same source as Debt Payoff tab)
                if (absoluteI === 0 && cardProjectionData?.month0?.perCardAdjusted) {
                  const engineRecs = cardProjectionData.month0.perCardAdjusted.filter(r => r.payment > 0);
                  if (engineRecs.length > 0) {
                    return engineRecs.map(r => ({ label: `  ${r.name}`, value: formatCurrency(r.payment, true), op: '−' as const }));
                  }
                  return fallback;
                }
                // Months 1+: use simulation amounts
                const perCard = cardProjectionData?.perCardPaymentsScaled ?? cardProjectionData?.perCardPayments;
                if (!perCard) return fallback;
                const rawAmounts = perCard
                  .map(c => ({ name: c.name, amt: c.payments[absoluteI] ?? 0 }))
                  .filter(c => c.amt > 0);
                if (rawAmounts.length === 0) return fallback;
                // perCardPaymentsScaled never reflects this page's own save-up cap (a future
                // month's larger obligation can shrink row.debtPayment well below the engine's
                // natural per-card recommendation) — scale each line proportionally so the
                // breakdown always sums to what was actually paid that month, not a bigger
                // number than the cash math (row.endingCash etc.) ever used.
                const rawSum = rawAmounts.reduce((s, c) => s + c.amt, 0);
                const scale = rawSum > 0 ? (row.debtPayment ?? rawSum) / rawSum : 1;
                const lines = rawAmounts
                  .map(c => ({ label: `  ${c.name}`, value: formatCurrency(c.amt * scale, true), op: '−' as const, scaledAmt: c.amt * scale }))
                  .filter(c => c.scaledAmt > 0.005)
                  .map(({ scaledAmt, ...c }) => c);
                return lines.length > 0 ? lines : fallback;
              })()),
              { label: '  Adjusted to keep cash safely above your floor through upcoming bills. May be lower than the Debt Payoff tab\'s recommendation for the same month.', value: '' },
              ...((row.savingsGoalItems?.length > 0)
                ? (row.savingsGoalItems as { name: string; amount: number }[]).map(g => ({ label: `  ${g.name}`, value: formatCurrency(g.amount, true), op: '−' as const }))
                : (row.savingsContrib ?? 0) > 0 ? [{ label: '  Savings Goals', value: formatCurrency(row.savingsContrib, true), op: '−' as const }] : []
              ),
              // Still-saving months: informational only — this cash hasn't left any account
              // yet (see cumulativeCarReserveHeld adding it back into Ending Cash). The
              // purchase month itself is a real outflow — show it as a normal subtracted
              // line since the cumulative add-back nets to zero that month.
              ...((row.carContribItems as { name: string; amount: number; isPurchaseMonth: boolean }[] | undefined)?.length
                ? (row.carContribItems as { name: string; amount: number; isPurchaseMonth: boolean }[]).map(v => v.isPurchaseMonth
                    ? { label: `  ${v.name} (down payment)`, value: formatCurrency(v.amount, true), op: '−' as const }
                    : { label: `  Reserving for ${v.name} (still your cash)`, value: formatCurrency(v.amount, true) })
                : (row.carContrib ?? 0) > 0 ? [{ label: '  Reserving for car fund (still your cash)', value: formatCurrency(row.carContrib, true) }] : []
              ),
              ...((row.otherDebtPayment ?? 0) > 0 ? [{ label: '  Other Loan Payments', value: formatCurrency(row.otherDebtPayment, true), op: '−' }] : []),
              ...((row.carLoanPayment ?? 0) > 0 ? [{ label: '  Car Loan Payments', value: formatCurrency(row.carLoanPayment, true), op: '−' }] : []),
              ...((row.vehicleDownPayment ?? 0) > 0 ? [{ label: '  Vehicle Down Payment (cash)', value: formatCurrency(row.vehicleDownPayment, true), op: '−' }] : []),
              ...((row.vehicleInsurance ?? 0) > 0 ? [{ label: '  Vehicle Insurance (est.)', value: formatCurrency(row.vehicleInsurance, true), op: '−' }] : []),
              ...((row.projectedCarLoan ?? 0) > 0 ? [{ label: '  Est. Car Loan (projected)', value: formatCurrency(row.projectedCarLoan, true), op: '−' }] : []),
              ...((row.carLumpItems as { name: string; amount: number }[] | undefined)?.length
                ? (row.carLumpItems as { name: string; amount: number }[]).map(v => ({ label: `  ${v.name} — Extra Payment`, value: formatCurrency(v.amount, true), op: '−' as const }))
                : (row.carLoanExtraPayment ?? 0) > 0 ? [{ label: '  Car Loan Extra Payment', value: formatCurrency(row.carLoanExtraPayment, true), op: '−' as const }] : []
              ),
              // RANKED AUTOMATIC EXTRA PAYMENTS. Straight off the engine's own per-month reserve
              // (`autoExtraItems` — the named twin of `autoExtraByTarget`), never re-derived here:
              // the same dollars it subtracted from this month's cash, named. Until these lines
              // existed the walk below could not reach its own Ending Cash — on the ranked-liability
              // fixture it printed $22,600 where the engine had $10,780, with $11,820 of extra
              // payment nowhere on screen.
              ...((row.autoExtraItems ?? [])
                .filter(x => x.amount > 0)
                .map(x => ({ label: `  ${autoExtraFlowLabel(x)}`, value: formatCurrency(x.amount, true), op: '−' as const }))),
              ...((row.lumpSumSavings ?? 0) > 0 ? [{ label: '  Lump Sum → Savings', value: formatCurrency(row.lumpSumSavings, true), op: '−' }] : []),
              ...((row.lumpSumBrokerage ?? 0) > 0 ? [{ label: '  Lump Sum → Brokerage', value: formatCurrency(row.lumpSumBrokerage, true), op: '−' }] : []),
              ...((row.lumpSumRothIra ?? 0) > 0 ? [{ label: '  Lump Sum → Roth IRA', value: formatCurrency(row.lumpSumRothIra, true), op: '−' }] : []),
              ...((row.transferBreakdown ?? [])
                .filter((t: { name: string; amount: number }) => t.amount > 0)
                .map((t: { name: string; amount: number }) => ({ label: `  ${t.name}`, value: formatCurrency(t.amount, true), op: '−' as const }))),
              ...((row.businessContrib ?? 0) > 0
                ? [{ label: '  Business Contributions', value: formatCurrency(row.businessContrib, true), op: '−' }]
                : []),
              { label: 'One-Time Net (Cash)', value: formatCurrency(Math.abs(row.oneTimeNet || 0), true), op: (row.oneTimeNet || 0) >= 0 ? '+' : '−' },
              // rawEndingCash, not endingCash: the latter is the whole-dollar DISPLAY field
              // the month table renders. Printing it with two decimals would only ever show
              // ".00" — false precision — and it would not equal the terms above it.
              { label: 'Ending Cash', value: formatCurrency(row.rawEndingCash ?? row.endingCash, true), op: '=' },
              ...((row.carReserveHeld ?? 0) > 0
                ? [{ label: `  includes ${formatCurrency(row.carReserveHeld, true)} reserved for an upcoming vehicle purchase`, value: '' }]
                : []),
              {
                label: 'Cash Floor',
                value: formatCurrency(row.rawMonthMinSafe ?? row.monthMinSafe, true),
                onClick: () => {
                  const items: { name: string; amount: number; dueDay?: number }[] = row.floorItems ?? [];
                  const preTotal = row.prePaycheckBillsTotal ?? 0;
                  const settingsFloor = row.settingsCashFloor ?? 0;
                  const savingCarFunds = (carFunds ?? []).filter((cf) => cf.phase === 'saving');
                  onOpenFloorDrawer({
                    title: `${row.month} — Cash Floor`,
                    lines: [
                      { label: 'Settings floor', value: formatCurrency(settingsFloor, true) },
                      { label: '', value: '' },
                      ...(items.length > 0
                        ? [
                            { label: 'Fixed monthly obligations (next mo.):', value: '' },
                            ...items.map((it) => ({
                              label: `  ${it.name}${it.dueDay ? ` (day ${it.dueDay})` : ''}`,
                              value: formatCurrency(it.amount, true),
                              op: '+' as const,
                            })),
                            { label: 'Obligations total', value: formatCurrency(preTotal, true), op: '=' },
                          ]
                        : [{ label: 'No fixed obligations this month', value: '' }]),
                      { label: '', value: '' },
                      { label: 'Cash Floor (higher of above)', value: formatCurrency(row.rawMonthMinSafe ?? row.monthMinSafe, true), op: '=' },
                      ...(savingCarFunds.length > 0
                        ? [
                            { label: '', value: '' },
                            { label: 'Saving toward vehicle purchase:', value: '' },
                            ...savingCarFunds.map((cf) => ({
                              label: `  ${cf.vehicle_name ?? 'Vehicle'}${cf.planned_purchase_date ? ` — target ${new Date(cf.planned_purchase_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}`,
                              value: '',
                            })),
                          ]
                        : []),
                    ],
                  });
                },
              },
              { label: '', value: '' },
              // ── OTHER ACCOUNTS ────────────────────────────────────────────────
              //
              // Tre, 2026-08-27: *"that top section is a reflection of only the checking account
              // (the debt payment account) ... make a new section that shows the change in other
              // accounts when there is one."* Everything above this point is one account's cash.
              // Money that moved a DIFFERENT account of his — a bill or a one-time paid out of
              // savings, a transfer between two non-cash accounts — belongs here instead, grouped
              // by the account it actually moved, with that account's net change for the month.
              // The two lists this replaces said "no cash impact", which was true of checking and
              // silent about where the money did come from.
              ...buildOtherAccountLines(row as Parameters<typeof buildOtherAccountLines>[0], formatCurrency),
              ...((row.assetBreakdown ?? []) as { bucket: string; id: string; name: string; balance: number }[])
                .filter(a => a.bucket === 'retirement')
                .map(a => ({ label: `  ${a.name}`, value: formatCurrency(a.balance, true) })),
              ...((row.assetBreakdown ?? []) as { bucket: string; id: string; name: string; balance: number }[])
                .filter(a => a.bucket === 'investment')
                .map(a => ({ label: `  ${a.name}`, value: formatCurrency(a.balance, true) })),
              ...((row.assetBreakdown ?? []) as { bucket: string; id: string; name: string; balance: number }[])
                .filter(a => a.bucket === 'savings')
                .map(a => ({ label: `  ${a.name}`, value: formatCurrency(a.balance, true) })),
              { label: 'Total Assets', value: formatCurrency(row.rawTotalAssets ?? row.totalAssets, true) },
              { label: '', value: '' },
              { label: 'CC Purchases', value: (row.totalCCPurchases ?? 0) > 0 ? formatCurrency(row.rawTotalCCPurchases ?? row.totalCCPurchases, true) : '—' },
              ...((cardProjectionData?.simCards ?? []) as { id: string; name: string }[]).map(card => ({
                label: `  ${card.name}`,
                value: (() => {
                  // Detect revolving vs cycling via monthlyRevolvingBalances (> 0 = revolving).
                  // Revolving cards show the shared step3-display adjusted balance (sim balance
                  // minus cumulative PASS-3 surplus routed to this card) so this popup matches
                  // the Debt Payoff accordion/chart and the CSV export. Cycling cards fall back
                  // to data[i][name], the cycling statement balance — matches accordion display.
                  const revBal = cardProjectionData?.monthlyRevolvingBalances?.get(card.id)?.[absoluteI] ?? 0;
                  const simBal = cardProjectionData?.monthlyBalances?.get(card.id)?.[absoluteI] ?? 0;
                  const cyclingBal = Number(cardProjectionData?.data[absoluteI]?.[card.name] ?? 0);
                  const cum = step3CumSurplus.get(card.id)?.[absoluteI] ?? 0;
                  const bal = revBal > 0 ? adjustedDisplayBalance(simBal, cum) : cyclingBal;
                  return bal > 0 ? formatCurrency(bal, true) : '—';
                })(),
              })),
              { label: 'Total CC Balance', value: (row.ccDisplayBalance ?? row.ccDebtBalance ?? 0) > 0 ? formatCurrency(row.rawCcDisplayBalance ?? row.ccDisplayBalance ?? row.ccDebtBalance, true) : '—' },
              ...((row.nonCCLiabBreakdown ?? []) as { id: string; name: string; balance: number }[])
                .map(la => ({ label: `  ${la.name}`, value: la.balance > 0 ? formatCurrency(la.balance, true) : '—' })),
              ...((row.carLoanBreakdown ?? []) as { name: string; balance: number }[])
                .map(cl => ({ label: `  ${cl.name}`, value: formatCurrency(cl.balance, true) })),
              { label: 'Total Liabilities', value: formatCurrency(row.rawTotalLiabilities ?? row.totalLiabilities, true) },
              // ⚠️ SAY WHICH MOMENT THESE BALANCES ARE (Tre, 2026-08-27: "yes label it"). Since
              // `160803bc` every liability line here is the balance at the END of the month, so the
              // total agrees with the rows above it and Net Worth below it does not subtract a
              // payment from cash while still carrying the balance that payment cleared. The knock-on
              // is that THIS MONTH's row reads one payment's principal below the "$X remaining" the
              // Garage card and /accounts show, because those answer "what do you owe today". Two
              // correct answers to two different questions is only confusing while it is unlabelled.
              { label: '  after this month’s payments', value: '' },
              { label: '', value: '' },
              { label: 'Net Worth', value: formatCurrency(row.rawNetWorth ?? row.netWorth, true) },
            ],
          });
        };
        const hasCC = (row.totalCCPurchases ?? 0) > 0;
        const hasOneTime = (row.oneTimeNet ?? 0) !== 0;
        const hasCarLump = (row.carLoanExtraPayment ?? 0) > 0;
        // A month whose surplus was diverted by the ranked waterfall reads, in these four columns,
        // exactly like a month that simply earned less — the extra is in −Out and in End Cash and
        // named nowhere. The chip is the row's own answer to "where did it go", and it sums the
        // engine's items rather than re-deriving a total.
        const autoExtraTotal = (row.autoExtraItems ?? []).reduce((s, x) => s + (x.amount > 0 ? x.amount : 0), 0);
        // Current-month +Income is the paychecks REMAINING after the last sync — paychecks
        // already received this month are folded into Current Cash, not shown here. Without a
        // hint the reduced income reads like a missing paycheck (Tre, 2026-07-21). Count the
        // received ones (date on/before syncCutoffDate — the same cutoff the income filter uses)
        // and label the row so the split is self-explanatory.
        const isCurrentMonthRow = rowAbsoluteI === 0;
        const receivedThisMonth = isCurrentMonthRow && syncCutoffDate
          ? getPaychecksInMonth(payConfig, new Date().getFullYear(), new Date().getMonth()).filter(p => {
              const ps = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}-${String(p.date.getDate()).padStart(2, '0')}`;
              return ps <= syncCutoffDate;
            }).length
          : 0;
        const showRemainingHint = isCurrentMonthRow && receivedThisMonth > 0;
        return (
          <div key={i} className="border-b border-border/30 hover:bg-secondary/30 cursor-pointer" onClick={openDrawer}>
            <div className="grid grid-cols-[5rem_1fr_1fr_1fr] py-2">
              <div className="px-1 text-xs font-medium">{row.month}</div>
              <div className="px-1 text-right text-success font-display font-bold text-xs">{formatCurrency(row.takeHome, false)}</div>
              <div className="px-1 text-right text-destructive font-display font-bold text-xs">{formatCurrency(row.totalExpenses, false)}</div>
              {/* Red comes from the engine's own belowSafeMinimum flag, never from re-comparing the
                  rounded cells. Re-deriving it here is what let the summary milestone and these rows
                  disagree about the same month; the gold "within $50" band below is a display hint,
                  not a breach claim, so it stays on the rounded figures. */}
              <div className={`px-1 text-right font-display font-bold text-xs ${row.belowSafeMinimum ? 'text-destructive' : row.endingCash <= row.monthMinSafe + 50 ? 'text-gold' : 'text-success'}`}>
                {formatCurrency(row.endingCash, false)}
                {row.endingCash < 0 && <span className="ml-0.5 text-[8px]">⚠️</span>}
                {row.floorBreachedByOneTime && <div className="text-[8px] text-gold leading-tight font-normal">one-time</div>}
              </div>
            </div>
            {(hasCC || hasOneTime || hasCarLump || autoExtraTotal > 0 || showRemainingHint || rowDuplicates.length > 0) && (
              <div className="px-1 pb-1.5 flex flex-wrap gap-1">
                {rowDuplicates.length > 0 && (
                  <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-gold/10 text-gold border border-gold/30 whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }} title="A transaction you entered by hand duplicates a payment this app already generates, so this month is counted twice.">
                    ⚠ counted twice {formatCurrency(rowDuplicates.reduce((s, c) => s + c.amount, 0), false)}
                  </span>
                )}
                {showRemainingHint && (
                  <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-secondary text-muted-foreground border border-border whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }} title="Paychecks already received this month are included in Current Cash, not in +Income. Tap the row for the full breakdown.">
                    ⏱ rest of month · {receivedThisMonth} paycheck{receivedThisMonth > 1 ? 's' : ''} received
                  </span>
                )}
                {hasCC && (
                  <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }}>
                    CC {formatCurrency(row.totalCCPurchases, false)}
                  </span>
                )}
                {hasOneTime && (
                  <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 border whitespace-nowrap ${(row.oneTimeNet || 0) >= 0 ? 'bg-success/10 text-success border-success/20' : 'bg-gold/10 text-gold border-gold/20'}`} style={{ borderRadius: 'var(--radius)' }}>
                    1× {(row.oneTimeNet || 0) >= 0 ? '+' : ''}{formatCurrency(row.oneTimeNet, false)}
                  </span>
                )}
                {hasCarLump && (
                  <span className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 whitespace-nowrap" style={{ borderRadius: 'var(--radius)' }}>
                    +pmt {formatCurrency(row.carLoanExtraPayment, false)}
                  </span>
                )}
                {autoExtraTotal > 0 && (
                  <span
                    className="text-[10px] sm:text-xs px-1.5 py-0.5 bg-primary/10 text-primary border border-primary/20 whitespace-nowrap"
                    style={{ borderRadius: 'var(--radius)' }}
                    title={(row.autoExtraItems ?? []).filter(x => x.amount > 0).map(x => `${autoExtraFlowLabel(x)}: ${formatCurrency(x.amount, true)}`).join(' · ')}
                  >
                    +extra {formatCurrency(autoExtraTotal, false)}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
