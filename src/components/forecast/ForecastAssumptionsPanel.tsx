import { useMemo } from 'react';
import { X, Plus } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';
import { type PayScheduleConfig } from '@/lib/pay-schedule';
import { estimateTaxReturn, estimateFederalWithheld, STATE_TAX_RATES, type FilingStatus } from '@/lib/tax-estimator';
import ForecastYearlySummary from '@/components/forecast/ForecastYearlySummary';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

/**
 * The forecast assumptions form, lifted out of `Forecast.tsx` unchanged.
 *
 * It moved for two reasons: it is ~300 lines of settings that were sitting between the
 * reader and the story (the Forecast now leads with its next milestone, and this collapses
 * below it), and the page was long past the file-size the house rules ask for. The derived
 * values it is the only consumer of — the live refund preview here, the 5-year projection in
 * `ForecastYearlySummary` — moved with it, so nothing recomputes them for a closed panel.
 *
 * Behaviour is deliberately identical to the version that lived in the page: same inputs,
 * same writes through `setAssumptions`, same copy.
 */
type Props = {
  assumptions: AssumptionsType;
  setAssumptions: (val: AssumptionsType | ((prev: AssumptionsType) => AssumptionsType)) => void;
  payConfig: PayScheduleConfig;
  /** Withholding detected from the budget; 0 when nothing was found, which falls back to the estimate. */
  annualFederalWithheldFromBudget: number;
  onClose: () => void;
};

export default function ForecastAssumptionsPanel({
  assumptions,
  setAssumptions,
  payConfig,
  annualFederalWithheldFromBudget,
  onClose,
}: Props) {
  // Live tax refund preview for the assumptions panel UI — always computed so it shows even when disabled
  const taxRefundPreview = useMemo(() => {
    try {
      if (assumptions.taxReturnAmountOverride > 0) {
        return { federalRefund: assumptions.taxReturnAmountOverride, stateRefund: 0, totalRefund: assumptions.taxReturnAmountOverride, federalTaxOwed: 0, stateTaxOwed: 0 };
      }
      const annualGross = payConfig.weeklyGross * 52;
      if (!annualGross || annualGross <= 0) return null;
      const federalWithheld = assumptions.taxReturnFederalWithheld || annualFederalWithheldFromBudget || estimateFederalWithheld(annualGross, assumptions.taxReturnFilingStatus, assumptions.taxReturnDependents);
      const stateRate = STATE_TAX_RATES[assumptions.taxReturnState] ?? 0;
      const stateWithheld = Math.round(annualGross * stateRate);
      return estimateTaxReturn({
        annualGrossIncome: annualGross,
        federalWithheld,
        filingStatus: assumptions.taxReturnFilingStatus,
        dependentsUnder17: assumptions.taxReturnDependents,
        stateCode: assumptions.taxReturnState,
        stateWithheld,
      });
    } catch { return null; }
  }, [assumptions, payConfig, annualFederalWithheldFromBudget]);

  return (
    <div className="card-forged p-3 sm:p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Forecast Assumptions</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-3 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"><X size={14} /></button>
      </div>

      {/* Growth & Returns */}
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Growth & Returns</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              { key: 'investmentGrowth', label: 'Investment %' },
              { key: 'savingsInterest', label: 'Savings Interest %' },
            ] as { key: 'investmentGrowth' | 'savingsInterest'; label: string }[]
          ).map(({ key, label }) => (
            <div key={key}>
              <label className="text-[9px] text-muted-foreground uppercase">{label}</label>
              <input type="number" value={assumptions[key]}
                onChange={e => setAssumptions(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="0.1" />
            </div>
          ))}
        </div>
      </div>

      {/* Promotions */}
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Promotions</p>
        <div className="space-y-2">
          {assumptions.promotions.map(promo => (
            <div key={promo.id} className="card-forged p-2">
              <div className="flex items-start justify-between gap-1 mb-1.5">
                <span className="text-xs font-semibold text-foreground">Promotion</span>
                <button
                  onClick={() => setAssumptions(prev => ({ ...prev, promotions: prev.promotions.filter(p => p.id !== promo.id) }))}
                  className="text-muted-foreground hover:text-destructive shrink-0 p-1.5 -mr-1.5" title="Remove promotion">
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">Effective Date</label>
                  <input type="date" value={promo.effectiveDate}
                    onChange={e => setAssumptions(prev => ({ ...prev, promotions: prev.promotions.map(p => p.id === promo.id ? { ...p, effectiveDate: e.target.value } : p) }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} />
                </div>
                <div>
                  <label className="text-[9px] text-muted-foreground uppercase">New Annual Salary</label>
                  <input type="number" value={promo.newAnnualSalary || ''}
                    onChange={e => setAssumptions(prev => ({ ...prev, promotions: prev.promotions.map(p => p.id === promo.id ? { ...p, newAnnualSalary: parseFloat(e.target.value) || 0 } : p) }))}
                    className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="1000" placeholder="$" />
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={() => setAssumptions(prev => ({ ...prev, promotions: [...prev.promotions, { id: crypto.randomUUID(), effectiveDate: '', newAnnualSalary: 0 }] }))}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
            <Plus size={13} /> Add Promotion
          </button>
          {assumptions.promotions.length > 0 && (
            <p className="text-[10px] text-muted-foreground">Snaps your projected salary to the new amount starting that month — raises and % bonuses continue applying to the new value afterward.</p>
          )}
        </div>
      </div>

      {/* Income Growth / Annual Raise */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setAssumptions(prev => ({ ...prev, incomeGrowthEnabled: !prev.incomeGrowthEnabled }))}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${assumptions.incomeGrowthEnabled ? 'bg-primary' : 'bg-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${assumptions.incomeGrowthEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Annual Raise</p>
        </div>
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${assumptions.incomeGrowthEnabled ? 'opacity-100' : 'opacity-50'}`}>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase">Mode</label>
            <div className="flex mt-1 border border-border overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
              {(['pct', 'flat'] as const).map(m => (
                <button key={m}
                  onClick={() => setAssumptions(prev => ({ ...prev, raiseMode: m }))}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${assumptions.raiseMode === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>
                  {m === 'pct' ? '%' : '$'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase">{assumptions.raiseMode === 'flat' ? 'Raise $/yr' : 'Raise %'}</label>
            <input type="number" value={assumptions.incomeGrowth}
              onChange={e => setAssumptions(prev => ({ ...prev, incomeGrowth: parseFloat(e.target.value) || 0 }))}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step={assumptions.raiseMode === 'flat' ? '500' : '0.1'} />
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase">Effective Month</label>
            <select value={assumptions.raiseMonth}
              onChange={e => setAssumptions(prev => ({ ...prev, raiseMonth: parseInt(e.target.value) }))}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, idx) => (
                <option key={m} value={idx + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-1">
            <p className="text-[10px] text-muted-foreground">Applied once per year in the selected month.</p>
          </div>
        </div>
      </div>

      {/* Bonus */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setAssumptions(prev => ({ ...prev, bonusEnabled: !prev.bonusEnabled }))}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${assumptions.bonusEnabled ? 'bg-primary' : 'bg-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${assumptions.bonusEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Expected Bonus</p>
        </div>
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 transition-opacity ${assumptions.bonusEnabled ? 'opacity-100' : 'opacity-50'}`}>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase">Mode</label>
            <select value={assumptions.bonusMode}
              onChange={e => setAssumptions(prev => ({ ...prev, bonusMode: e.target.value as 'flat' | 'pct' }))}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
              <option value="flat">Flat $</option>
              <option value="pct">% of Income</option>
            </select>
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase">{assumptions.bonusMode === 'pct' ? 'Bonus %' : 'Bonus $'}</label>
            <input type="number" value={assumptions.bonusAmount}
              onChange={e => setAssumptions(prev => ({ ...prev, bonusAmount: parseFloat(e.target.value) || 0 }))}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step={assumptions.bonusMode === 'pct' ? '0.1' : '100'} />
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground uppercase">Paid In</label>
            <select value={assumptions.bonusMonth}
              onChange={e => setAssumptions(prev => ({ ...prev, bonusMonth: parseInt(e.target.value) }))}
              className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, idx) => (
                <option key={m} value={idx + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-1">
            <label className="text-[9px] text-muted-foreground uppercase">Recurring</label>
            <button
              onClick={() => setAssumptions(prev => ({ ...prev, bonusRecurring: !prev.bonusRecurring }))}
              className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1.5 border transition-colors ${assumptions.bonusRecurring ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground'}`}
              style={{ borderRadius: 'var(--radius)' }}>
              {assumptions.bonusRecurring ? 'Every year' : 'One time'}
            </button>
          </div>
        </div>
      </div>

      {/* Tax Return Estimator */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAssumptions(prev => ({ ...prev, taxReturnEnabled: !prev.taxReturnEnabled }))}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${assumptions.taxReturnEnabled ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform ${assumptions.taxReturnEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tax Return Estimator</p>
          </div>
        </div>
        <div className={`space-y-3 transition-opacity ${assumptions.taxReturnEnabled ? 'opacity-100' : 'opacity-50'}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[9px] text-muted-foreground uppercase">Filing Status</label>
              <select value={assumptions.taxReturnFilingStatus}
                onChange={e => setAssumptions(prev => ({ ...prev, taxReturnFilingStatus: e.target.value as FilingStatus }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                <option value="single">Single</option>
                <option value="mfj">Married Filing Jointly</option>
                <option value="mfs">Married Filing Sep.</option>
                <option value="hoh">Head of Household</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase">Dependents (&lt;17)</label>
              <input type="number" min={0} max={10} value={assumptions.taxReturnDependents}
                onChange={e => setAssumptions(prev => ({ ...prev, taxReturnDependents: parseInt(e.target.value) || 0 }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="1" />
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase">State</label>
              <select value={assumptions.taxReturnState}
                onChange={e => setAssumptions(prev => ({ ...prev, taxReturnState: e.target.value }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                {[['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],['DC','Washington DC']].map(([code, name]) => {
                  const rate = STATE_TAX_RATES[code] ?? 0;
                  const rateLabel = rate === 0 ? '0%' : `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`;
                  return <option key={code} value={code}>{name} ({rateLabel})</option>;
                })}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase">Refund Month</label>
              <select value={assumptions.taxReturnMonth}
                onChange={e => setAssumptions(prev => ({ ...prev, taxReturnMonth: parseInt(e.target.value) }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }}>
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, idx) => (
                  <option key={m} value={idx + 1}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[9px] text-muted-foreground uppercase">Fed. Withheld/yr (0 = auto-detect)</label>
              <input type="number" value={assumptions.taxReturnFederalWithheld}
                onChange={e => setAssumptions(prev => ({ ...prev, taxReturnFederalWithheld: parseFloat(e.target.value) || 0 }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="100" />
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground uppercase">Override Refund $ (0 = estimate)</label>
              <input type="number" value={assumptions.taxReturnAmountOverride}
                onChange={e => setAssumptions(prev => ({ ...prev, taxReturnAmountOverride: parseFloat(e.target.value) || 0 }))}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground font-display font-bold" style={{ borderRadius: 'var(--radius)' }} step="100" />
            </div>
            {taxRefundPreview && (
              <div className="flex flex-col justify-end">
                <p className="text-[9px] text-muted-foreground uppercase mb-1">Tax Estimate</p>
                <div className={`px-2 py-1.5 text-xs border ${taxRefundPreview.totalRefund >= 0 ? 'bg-primary/5 border-primary/20' : 'bg-destructive/5 border-destructive/20'}`} style={{ borderRadius: 'var(--radius)' }}>
                  <span className="text-muted-foreground">Fed </span>
                  <span className="font-display font-bold text-foreground">{formatCurrency(Math.abs(taxRefundPreview.federalRefund), false)}</span>
                  {taxRefundPreview.stateRefund !== 0 && (
                    <><span className="text-muted-foreground ml-2">State </span>
                    <span className="font-display font-bold text-foreground">{formatCurrency(Math.abs(taxRefundPreview.stateRefund), false)}</span></>
                  )}
                  <div className={`mt-0.5 font-display font-bold ${taxRefundPreview.totalRefund >= 0 ? 'text-primary' : 'text-destructive'}`}>
                    {taxRefundPreview.totalRefund >= 0 ? 'Est. Refund ' : 'Est. Owed '}
                    {formatCurrency(Math.abs(taxRefundPreview.totalRefund), false)}
                  </div>
                </div>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">Estimate uses 2025 federal brackets, standard deduction, and child tax credit. State uses a simplified flat rate. Injected as income in the selected month every year.</p>
        </div>
      </div>

      {/* Plan Impact Note */}
      <div className="border-t border-border/50 pt-3 space-y-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Impact on Your Financial Plan</p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Income growth applies to both this Forecast and the Debt Payoff tab's future-month payment schedule. A higher raise accelerates your payoff timeline. Bonus and tax return amounts are injected as one-time income and also shift how quickly balances drop.
        </p>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Investment return and savings interest rates only affect net worth and account growth projections here — they do not change what flows to debt payoff.
        </p>
      </div>

      <ForecastYearlySummary
        assumptions={assumptions}
        payConfig={payConfig}
        annualFederalWithheldFromBudget={annualFederalWithheldFromBudget}
      />
    </div>
  );
}
