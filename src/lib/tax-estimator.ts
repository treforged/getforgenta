export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

export interface TaxEstimateInput {
  annualGrossIncome: number;
  federalWithheld: number;
  filingStatus: FilingStatus;
  dependentsUnder17: number;
  stateCode: string;
  stateWithheld: number;
}

export interface TaxEstimateResult {
  federalTaxOwed: number;
  federalRefund: number;
  stateTaxOwed: number;
  stateRefund: number;
  totalRefund: number;
}

type Bracket = { rate: number; min: number; max: number };

// 2025 IRS federal income tax brackets
const BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.10, min: 0, max: 11925 },
    { rate: 0.12, min: 11925, max: 48475 },
    { rate: 0.22, min: 48475, max: 103350 },
    { rate: 0.24, min: 103350, max: 197300 },
    { rate: 0.32, min: 197300, max: 243725 },
    { rate: 0.35, min: 243725, max: 609350 },
    { rate: 0.37, min: 609350, max: Infinity },
  ],
  mfj: [
    { rate: 0.10, min: 0, max: 23850 },
    { rate: 0.12, min: 23850, max: 96950 },
    { rate: 0.22, min: 96950, max: 206700 },
    { rate: 0.24, min: 206700, max: 394600 },
    { rate: 0.32, min: 394600, max: 487450 },
    { rate: 0.35, min: 487450, max: 731200 },
    { rate: 0.37, min: 731200, max: Infinity },
  ],
  mfs: [
    { rate: 0.10, min: 0, max: 11925 },
    { rate: 0.12, min: 11925, max: 48475 },
    { rate: 0.22, min: 48475, max: 103350 },
    { rate: 0.24, min: 103350, max: 197300 },
    { rate: 0.32, min: 197300, max: 243725 },
    { rate: 0.35, min: 243725, max: 365600 },
    { rate: 0.37, min: 365600, max: Infinity },
  ],
  hoh: [
    { rate: 0.10, min: 0, max: 17000 },
    { rate: 0.12, min: 17000, max: 64850 },
    { rate: 0.22, min: 64850, max: 103350 },
    { rate: 0.24, min: 103350, max: 197300 },
    { rate: 0.32, min: 197300, max: 243700 },
    { rate: 0.35, min: 243700, max: 609350 },
    { rate: 0.37, min: 609350, max: Infinity },
  ],
};

const STANDARD_DEDUCTIONS: Record<FilingStatus, number> = {
  single: 15000,
  mfj: 30000,
  mfs: 15000,
  hoh: 22500,
};

const CHILD_TAX_CREDIT = 2000;
const CTC_PHASEOUT: Record<FilingStatus, number> = {
  single: 200000, mfj: 400000, mfs: 200000, hoh: 200000,
};

// Simplified state effective income tax rates for middle income (~$75k AGI)
export const STATE_TAX_RATES: Record<string, number> = {
  AL: 0.040, AK: 0.000, AZ: 0.025, AR: 0.044, CA: 0.060,
  CO: 0.044, CT: 0.050, DE: 0.055, FL: 0.000, GA: 0.0549,
  HI: 0.070, ID: 0.058, IL: 0.0495, IN: 0.0305, IA: 0.044,
  KS: 0.052, KY: 0.040, LA: 0.042, ME: 0.060, MD: 0.0575,
  MA: 0.050, MI: 0.0425, MN: 0.0685, MS: 0.047, MO: 0.048,
  MT: 0.059, NE: 0.050, NV: 0.000, NH: 0.000, NJ: 0.050,
  NM: 0.049, NY: 0.065, NC: 0.0499, ND: 0.014, OH: 0.035,
  OK: 0.0475, OR: 0.080, PA: 0.0307, RI: 0.0475, SC: 0.060,
  SD: 0.000, TN: 0.000, TX: 0.000, UT: 0.0465, VT: 0.050,
  VA: 0.0575, WA: 0.000, WV: 0.050, WI: 0.053, WY: 0.000,
  DC: 0.070,
};

/**
 * Typical combined effective withholding rates (federal + state) for a standard W-4 single
 * filer at middle income (~$65-80k). Federal component ≈ 14% across all states; state
 * component mirrors STATE_TAX_RATES. Used to produce a realistic default refund estimate
 * when the user hasn't entered their actual withholding amount.
 */
export const STATE_TOTAL_WITHHOLDING_RATES: Record<string, number> = {
  AL: 0.180, AK: 0.140, AZ: 0.165, AR: 0.184, CA: 0.200,
  CO: 0.184, CT: 0.190, DE: 0.195, FL: 0.140, GA: 0.195,
  HI: 0.210, ID: 0.198, IL: 0.190, IN: 0.171, IA: 0.184,
  KS: 0.192, KY: 0.180, LA: 0.182, ME: 0.200, MD: 0.198,
  MA: 0.190, MI: 0.183, MN: 0.208, MS: 0.187, MO: 0.188,
  MT: 0.199, NE: 0.190, NV: 0.140, NH: 0.140, NJ: 0.190,
  NM: 0.189, NY: 0.205, NC: 0.190, ND: 0.154, OH: 0.175,
  OK: 0.188, OR: 0.220, PA: 0.171, RI: 0.188, SC: 0.200,
  SD: 0.140, TN: 0.140, TX: 0.140, UT: 0.187, VT: 0.190,
  VA: 0.198, WA: 0.140, WV: 0.190, WI: 0.193, WY: 0.140,
  DC: 0.210,
};

/**
 * Returns a realistic default federal withholding for use when the user hasn't entered their
 * actual withholding. Derives the federal portion from the state's combined withholding rate
 * minus the state's income tax rate, giving a typical W-4 standard single-filer refund.
 */
export function getDefaultFederalWithheld(annualGrossIncome: number, stateCode: string): number {
  const totalRate = STATE_TOTAL_WITHHOLDING_RATES[stateCode] ?? 0.14;
  const stateRate = STATE_TAX_RATES[stateCode] ?? 0;
  const federalRate = Math.max(0, totalRate - stateRate);
  return Math.round(annualGrossIncome * federalRate);
}

function calcBracketTax(taxableIncome: number, brackets: Bracket[]): number {
  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const slice = Math.min(taxableIncome, b.max) - b.min;
    tax += slice * b.rate;
  }
  return Math.max(0, tax);
}

export function estimateTaxReturn(input: TaxEstimateInput): TaxEstimateResult {
  const { annualGrossIncome, federalWithheld, filingStatus, dependentsUnder17, stateCode, stateWithheld } = input;

  const stdDed = STANDARD_DEDUCTIONS[filingStatus];
  const federalTaxable = Math.max(0, annualGrossIncome - stdDed);
  let federalOwed = calcBracketTax(federalTaxable, BRACKETS[filingStatus]);

  if (dependentsUnder17 > 0) {
    const phaseout = CTC_PHASEOUT[filingStatus];
    const reduction = Math.ceil(Math.max(0, annualGrossIncome - phaseout) / 1000) * 50;
    const ctc = Math.max(0, dependentsUnder17 * CHILD_TAX_CREDIT - reduction);
    federalOwed = Math.max(0, federalOwed - ctc);
  }

  // Approximate state taxable using ~80% of federal standard deduction as state equivalent
  const stateRate = STATE_TAX_RATES[stateCode] ?? 0;
  const stateTaxable = Math.max(0, annualGrossIncome - stdDed * 0.8);
  const stateOwed = Math.round(stateTaxable * stateRate);

  return {
    federalTaxOwed: Math.round(federalOwed),
    federalRefund: Math.round(federalWithheld - federalOwed),
    stateTaxOwed: stateOwed,
    stateRefund: Math.round(stateWithheld - stateOwed),
    totalRefund: Math.round((federalWithheld - federalOwed) + (stateWithheld - stateOwed)),
  };
}
