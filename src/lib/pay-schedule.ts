// ─── Unified Pay Schedule Engine ─────────────────────────
// Single source of truth for income calculations across all tabs

import { getActiveCarLoanPayments, getLoanPrincipal, monthsBetween } from './vehicle-loan-engine';
import type { AccountRow, RuleRow, TransactionRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';
import type { CarFund } from './types';

/**
 * A transaction as consumed/produced by this module's merge pipeline — either a real DB row
 * (TransactionRow) or one synthesized from a recurring rule/debt recommendation, plus the
 * computed flags downstream UI uses to badge/filter entries (isGenerated, isDebtPayment, etc.).
 * Only id/date/type/amount/category are guaranteed — synthesized entries don't have a user_id,
 * account, or created_at.
 */
export type EnrichedTransaction = {
  id: string;
  date: string;
  type: string;
  amount: number;
  category: string;
  note?: string | null;
  account?: string | null;
  payment_source?: string | null;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
  car_build_item_id?: string | null;
  isGenerated?: boolean;
  isDebtPayment?: boolean;
  isCarLoanPayment?: boolean;
  isPlanPayment?: boolean;
  isReconciliation?: boolean;
  reconciliationDelta?: number;
  ruleId?: string;
};

export type PayFrequency = 'weekly' | 'biweekly' | 'monthly';

export type PayScheduleConfig = {
  weeklyGross: number;
  taxRate: number;
  paycheckDay: number; // 0=Sun..6=Sat for weekly/biweekly, 1-31 for monthly
  frequency: PayFrequency;
  paycheckStartDate?: string; // 'YYYY-MM-DD' — biweekly phase anchor (any known paycheck date)
  /** Flat pre-tax deductions per paycheck. Applied before income tax: (gross - preTax) * (1 - taxRate%). */
  preTaxDeductions?: number;
  /** Flat post-tax deductions per paycheck. Subtracted after income tax. */
  postTaxDeductions?: number;
};

export type PaycheckInfo = {
  date: Date;
  gross: number;
  net: number;
};

/** Get net (post-tax, post-deduction) amount per paycheck */
export function getPaycheckNet(config: PayScheduleConfig): number {
  const gross = getPaycheckGross(config);
  const pretax = config.preTaxDeductions ?? 0;
  const posttax = config.postTaxDeductions ?? 0;
  return (gross - pretax) * (1 - config.taxRate / 100) - posttax;
}

/** Get gross amount per paycheck based on frequency */
export function getPaycheckGross(config: PayScheduleConfig): number {
  if (config.frequency === 'weekly') return config.weeklyGross;
  if (config.frequency === 'biweekly') return config.weeklyGross * 2;
  // monthly: weeklyGross * 52 / 12
  return config.weeklyGross * 52 / 12;
}

/** Get all paycheck dates within a given month */
export function getPaychecksInMonth(config: PayScheduleConfig, year: number, month: number): PaycheckInfo[] {
  const paychecks: PaycheckInfo[] = [];
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const gross = getPaycheckGross(config);
  const pretax = config.preTaxDeductions ?? 0;
  const posttax = config.postTaxDeductions ?? 0;
  const net = (gross - pretax) * (1 - config.taxRate / 100) - posttax;

  if (config.frequency === 'monthly') {
    const day = Math.min(config.paycheckDay || 1, monthEnd.getDate());
    const d = new Date(year, month, day);
    paychecks.push({ date: d, gross, net });
  } else if (config.frequency === 'biweekly' && config.paycheckStartDate) {
    // Phase-anchored biweekly: find all dates D in the month where (D - anchor) % 14 === 0
    const anchorMs = new Date(config.paycheckStartDate + 'T00:00:00').getTime();
    const DAY_MS = 86400000;
    const startMs = monthStart.getTime();
    const endMs = monthEnd.getTime();
    // Find the first biweekly date on or after monthStart
    const diffDays = Math.floor((startMs - anchorMs) / DAY_MS);
    const remainder = ((diffDays % 14) + 14) % 14;
    const firstOffset = remainder === 0 ? 0 : 14 - remainder;
    let ms = startMs + firstOffset * DAY_MS;
    while (ms <= endMs) {
      paychecks.push({ date: new Date(ms), gross, net });
      ms += 14 * DAY_MS;
    }
  } else {
    // weekly or biweekly (no anchor) — find occurrences of paycheckDay (day of week) in the month
    const dayOfWeek = config.paycheckDay;
    const d = new Date(monthStart);
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    const step = config.frequency === 'biweekly' ? 14 : 7;
    while (d <= monthEnd) {
      paychecks.push({ date: new Date(d), gross, net });
      d.setDate(d.getDate() + step);
    }
  }

  return paychecks;
}

/** Get remaining paychecks in the current month (from today onward) */
export function getRemainingPaychecksThisMonth(config: PayScheduleConfig): PaycheckInfo[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const all = getPaychecksInMonth(config, now.getFullYear(), now.getMonth());
  return all.filter(p => p.date >= today);
}

/** Get total remaining net income for the current month */
export function getRemainingIncomeThisMonth(config: PayScheduleConfig): number {
  return getRemainingPaychecksThisMonth(config).reduce((s, p) => s + p.net, 0);
}

/** Get total net income for a full month */
export function getMonthlyNetIncome(config: PayScheduleConfig): number {
  const now = new Date();
  const paychecks = getPaychecksInMonth(config, now.getFullYear(), now.getMonth());
  return paychecks.reduce((s, p) => s + p.net, 0);
}

/** Get total net income for a specific future month */
export function getMonthNetIncome(config: PayScheduleConfig, year: number, month: number): number {
  return getPaychecksInMonth(config, year, month).reduce((s, p) => s + p.net, 0);
}

/** Normalized monthly net income — averages 52/26/12 paychecks across 12 months to eliminate 4-vs-5 paycheck variance in forecast display */
export function getNormalizedMonthNetIncome(config: PayScheduleConfig): number {
  const net = getPaycheckNet(config);
  const paychecksPerYear = config.frequency === 'biweekly' ? 26 : config.frequency === 'monthly' ? 12 : 52;
  return net * (paychecksPerYear / 12);
}

/** Resolve a deduction value to a flat dollar amount per paycheck */
function resolveDeductionAmt(value: number, mode: string, gross: number): number {
  return mode === 'pct' ? gross * (value / 100) : value;
}

/** Build config from profile data */
export function buildPayConfig(profile: Partial<Tables<'profiles'>> | null | undefined): PayScheduleConfig {
  const wg = Number(profile?.weekly_gross_income) || 1875;
  const pf = (profile?.paycheck_frequency as PayFrequency) || 'weekly';
  const paycheckGross = pf === 'biweekly' ? wg * 2 : pf === 'monthly' ? wg * 52 / 12 : wg;

  let preTaxDeductions: number;
  let postTaxDeductions: number;

  // Use new JSONB deductions array if present; fall back to legacy columns
  const jsonDeds = profile?.paycheck_deductions as { value: number; mode: string; preTax: boolean; label?: string }[] | null;
  if (jsonDeds && jsonDeds.length > 0) {
    preTaxDeductions  = jsonDeds.filter(d => d.preTax).reduce((s, d) => s + resolveDeductionAmt(d.value, d.mode, paycheckGross), 0);
    postTaxDeductions = jsonDeds.filter(d => !d.preTax).reduce((s, d) => s + resolveDeductionAmt(d.value, d.mode, paycheckGross), 0);
  } else {
    // Legacy columns fallback
    const val401k    = Number(profile?.deduction_401k_value) || 0;
    const valHsa     = Number(profile?.deduction_hsa) || 0;
    const valFsa     = Number(profile?.deduction_fsa) || 0;
    const valMedical = Number(profile?.deduction_medical) || 0;
    const amt401k    = resolveDeductionAmt(val401k,    profile?.deduction_401k_mode    || 'pct',  paycheckGross);
    const amtHsa     = resolveDeductionAmt(valHsa,     profile?.deduction_hsa_mode     || 'flat', paycheckGross);
    const amtFsa     = resolveDeductionAmt(valFsa,     profile?.deduction_fsa_mode     || 'flat', paycheckGross);
    const amtMedical = resolveDeductionAmt(valMedical, profile?.deduction_medical_mode || 'flat', paycheckGross);
    const pre401k    = profile?.deduction_401k_pretax    !== false;
    const preHsa     = profile?.deduction_hsa_pretax     !== false;
    const preFsa     = profile?.deduction_fsa_pretax     !== false;
    const preMedical = profile?.deduction_medical_pretax !== false;
    preTaxDeductions  = (pre401k ? amt401k : 0) + (preHsa ? amtHsa : 0) + (preFsa ? amtFsa : 0) + (preMedical ? amtMedical : 0);
    postTaxDeductions = (!pre401k ? amt401k : 0) + (!preHsa ? amtHsa : 0) + (!preFsa ? amtFsa : 0) + (!preMedical ? amtMedical : 0);
  }

  // When withholding/FICA/OASDI are itemized as deductions, they already represent
  // the full tax burden — applying taxRate on top would double-count.
  const taxDedActive = jsonDeds != null && jsonDeds.length > 0
    ? jsonDeds.some(d => d.label != null && /withholding|fica|oasdi/i.test(d.label) && d.value > 0)
    : false;

  return {
    weeklyGross: wg,
    taxRate: taxDedActive ? 0 : (profile?.tax_rate != null ? Number(profile.tax_rate) : 22),
    paycheckDay: Number(profile?.paycheck_day) || 5,
    frequency: pf,
    paycheckStartDate: profile?.paycheck_start_date || undefined,
    preTaxDeductions,
    postTaxDeductions,
  };
}

/** Get next paycheck date from today */
export function getNextPaycheckDate(config: PayScheduleConfig): Date {
  const remaining = getRemainingPaychecksThisMonth(config);
  if (remaining.length > 0) return remaining[0].date;
  // First paycheck of next month
  const now = new Date();
  const nextMonth = getPaychecksInMonth(config, now.getFullYear(), now.getMonth() + 1);
  return nextMonth[0]?.date || new Date();
}

/** Get remaining paycheck income from today through a specific day in the current month */
export function getRemainingIncomeByDay(config: PayScheduleConfig, dueDay: number = 31): number {
  const now = new Date();
  const today = now.getDate();
  const paychecks = getPaychecksInMonth(config, now.getFullYear(), now.getMonth());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const effectiveDueDay = Math.min(dueDay, monthEnd);
  return paychecks
    .filter(p => p.date.getDate() >= today && p.date.getDate() <= effectiveDueDay)
    .reduce((s, p) => s + p.net, 0);
}

/**
 * Get remaining NON-PAYCHECK income from recurring rules before a specific day.
 * This captures: side jobs, recurring transfers IN, freelance income, etc.
 */
export function getRemainingNonPaycheckIncomeByDay(
  rules: RuleRow[], dueDay: number, fundingAccountId: string | null
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type !== 'income') continue;
    // Skip the primary paycheck income rule (handled by getRemainingIncomeByDay)
    // We include ALL income rules here — the paycheck config handles gross->net differently
    // but these are additional income sources
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    // If funding account specified, only count income deposited to that account
    if (fundingAccountId && r.deposit_account) {
      const dep = r.deposit_account.replace(/^account:/, '');
      if (dep && dep !== fundingAccountId) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getMonth() === month) {
        if (d.getDate() >= today && d.getDate() <= effectiveDueDay) total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd >= today && rd <= effectiveDueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd >= today && rd <= effectiveDueDay) total += amt;
      }
    }
  }
  return total;
}

/**
 * Get remaining one-time income transactions before a specific day in the current month.
 */
export function getRemainingOneTimeIncomeByDay(
  transactions: EnrichedTransaction[], dueDay: number = 31
): number {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  const monthEndStr = monthEnd.toISOString().split('T')[0];

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if (t.isGenerated) continue;
    if (!t.date || t.date < todayStr || t.date > monthEndStr) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= now.getDate() && txDay <= effectiveDueDay) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get remaining one-time expense transactions before a specific day in the current month.
 */
export function getRemainingOneTimeExpensesByDay(
  transactions: EnrichedTransaction[], dueDay: number = 31
): number {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  const monthEndStr = monthEnd.toISOString().split('T')[0];

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (t.isGenerated) continue;
    if (!t.date || t.date < todayStr || t.date > monthEndStr) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay >= now.getDate() && txDay <= effectiveDueDay) {
      total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get ALL remaining income from Transactions (both generated and manual) in the due-date window.
 * This is the SINGLE SOURCE OF TRUTH for income in debt-payoff calculations.
 * Includes: paychecks, non-paycheck income, one-time income, gifts, reimbursements.
 * Does NOT double-count with Budget Control rules.
 */
export function getRemainingTransactionIncomeByDay(
  transactions: EnrichedTransaction[], dueDay: number = 31, cutoffDate?: string
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  // When due date already passed this month, the real deadline is dueDay of next month.
  // Capture rest of current month AND early next-month income up to dueDay.
  const dueAlreadyPassed = dueDay < today;
  const effectiveDueDay = dueAlreadyPassed ? monthEnd.getDate() : Math.min(dueDay, monthEnd.getDate());
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  const nextMonthStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if (t.category === 'Balance Adjustment') continue;
    if (!t.date) continue;
    if (t.date.startsWith(monthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      const afterCutoff = cutoffDate ? t.date > cutoffDate : txDay >= today;
      if (afterCutoff && txDay <= effectiveDueDay) total += Number(t.amount);
    } else if (dueAlreadyPassed && t.date.startsWith(nextMonthStr)) {
      // Include next-month income through the actual upcoming due day
      const txDay = parseInt(t.date.split('-')[2]);
      if (txDay >= 1 && txDay <= dueDay) total += Number(t.amount);
    }
  }
  return total;
}

/**
 * Get ALL remaining expenses from Transactions (both generated and manual) in the due-date window.
 * Single source of truth — avoids double-counting with Budget Control rules.
 * Can optionally exclude debt payment transactions (since those are what we're computing).
 */
export function getRemainingTransactionExpensesByDay(
  transactions: EnrichedTransaction[],
  dueDay: number = 31,
  excludeDebtPayments = false,
  fundingAccountSources: Set<string> = new Set(),
  excludeCategories: Set<string> = new Set(),
  cutoffDate?: string,
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  // Mirror income function: when due date already passed, real deadline is next month's dueDay.
  const dueAlreadyPassed = dueDay < today;
  const effectiveDueDay = dueAlreadyPassed ? monthEnd.getDate() : Math.min(dueDay, monthEnd.getDate());
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  const nextMonthStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (excludeDebtPayments && t.category === 'Debt Payments') continue;
    if (t.category === 'Balance Adjustment') continue;
    // Only count expenses from the funding account. If a source is set and it
    // isn't the funding account (CC, other checking, savings, etc.), skip it.
    if (fundingAccountSources.size > 0 && t.payment_source && !fundingAccountSources.has(t.payment_source)) continue;
    // When no explicit source, skip CC-default categories (likely charged to a card).
    if (excludeCategories.size > 0 && !t.payment_source && excludeCategories.has(t.category)) continue;
    if (!t.date) continue;
    if (t.date.startsWith(monthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      const afterCutoff = cutoffDate ? t.date > cutoffDate : txDay >= today;
      if (afterCutoff && txDay <= effectiveDueDay) total += Number(t.amount);
    } else if (dueAlreadyPassed && t.date.startsWith(nextMonthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      if (txDay >= 1 && txDay <= dueDay) total += Number(t.amount);
    }
  }
  return total;
}

export interface TransactionLineItem {
  date: string;
  note: string;
  amount: number;
  isGenerated: boolean;
}

/** Returns each income transaction in the due-date window as a line item (same filter as getRemainingTransactionIncomeByDay). */
export function getRemainingTransactionIncomeItemsByDay(
  transactions: EnrichedTransaction[], dueDay: number = 31, cutoffDate?: string
): TransactionLineItem[] {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const dueAlreadyPassed = dueDay < today;
  const effectiveDueDay = dueAlreadyPassed ? monthEnd.getDate() : Math.min(dueDay, monthEnd.getDate());
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  const nextMonthStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;

  const items: TransactionLineItem[] = [];
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if (t.category === 'Balance Adjustment') continue;
    if (!t.date) continue;
    if (t.date.startsWith(monthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      const afterCutoff = cutoffDate ? t.date > cutoffDate : txDay >= today;
      if (afterCutoff && txDay <= effectiveDueDay) {
        items.push({ date: t.date, note: t.note || t.category || 'Income', amount: Number(t.amount), isGenerated: !!t.isGenerated });
      }
    } else if (dueAlreadyPassed && t.date.startsWith(nextMonthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      if (txDay >= 1 && txDay <= dueDay) {
        items.push({ date: t.date, note: t.note || t.category || 'Income', amount: Number(t.amount), isGenerated: !!t.isGenerated });
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Returns each expense transaction in the due-date window as a line item (same filter as getRemainingTransactionExpensesByDay). */
export function getRemainingTransactionExpenseItemsByDay(
  transactions: EnrichedTransaction[],
  dueDay: number = 31,
  excludeDebtPayments = false,
  fundingAccountSources: Set<string> = new Set(),
  excludeCategories: Set<string> = new Set(),
  cutoffDate?: string,
): TransactionLineItem[] {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const dueAlreadyPassed = dueDay < today;
  const effectiveDueDay = dueAlreadyPassed ? monthEnd.getDate() : Math.min(dueDay, monthEnd.getDate());
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  const nextMonthStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;

  const items: TransactionLineItem[] = [];
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (excludeDebtPayments && t.category === 'Debt Payments') continue;
    if (t.category === 'Balance Adjustment') continue;
    if (fundingAccountSources.size > 0 && t.payment_source && !fundingAccountSources.has(t.payment_source)) continue;
    if (excludeCategories.size > 0 && !t.payment_source && excludeCategories.has(t.category)) continue;
    if (!t.date) continue;
    if (t.date.startsWith(monthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      const afterCutoff = cutoffDate ? t.date > cutoffDate : txDay >= today;
      if (afterCutoff && txDay <= effectiveDueDay) {
        items.push({ date: t.date, note: t.note || t.category || 'Expense', amount: Number(t.amount), isGenerated: !!t.isGenerated });
      }
    } else if (dueAlreadyPassed && t.date.startsWith(nextMonthStr)) {
      const txDay = parseInt(t.date.split('-')[2]);
      if (txDay >= 1 && txDay <= dueDay) {
        items.push({ date: t.date, note: t.note || t.category || 'Expense', amount: Number(t.amount), isGenerated: !!t.isGenerated });
      }
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get ALL remaining income from Transactions for the rest of the current month.
 * Single source of truth for Budget Control Remaining Cash On Hand.
 */
export function getRemainingTransactionIncomeThisMonth(transactions: EnrichedTransaction[], cutoffDate?: string): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'income') continue;
    if (t.category === 'Balance Adjustment') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const included = cutoffDate ? t.date > cutoffDate : parseInt(t.date.split('-')[2]) >= today;
    if (included) total += Number(t.amount);
  }
  return total;
}

/**
 * Get remaining expenses from Transactions for the rest of the current month.
 * When fundingAccountSources is provided, only expenses from those accounts are counted
 * (CC purchases excluded). When excludeCategories is provided, expenses with no explicit
 * payment_source that fall into those categories are also excluded.
 */
export function getRemainingTransactionExpensesThisMonth(
  transactions: EnrichedTransaction[],
  excludeDebtPayments = false,
  cutoffDate?: string,
  fundingAccountSources: Set<string> = new Set(),
  excludeCategories: Set<string> = new Set(),
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (excludeDebtPayments && t.category === 'Debt Payments') continue;
    if (t.category === 'Balance Adjustment') continue;
    if (fundingAccountSources.size > 0 && t.payment_source && !fundingAccountSources.has(t.payment_source)) continue;
    if (excludeCategories.size > 0 && !t.payment_source && excludeCategories.has(t.category)) continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const included = cutoffDate ? t.date > cutoffDate : parseInt(t.date.split('-')[2]) >= today;
    if (included) total += Number(t.amount);
  }
  return total;
}

/**
 * Get remaining debt payment transactions for the rest of the current month.
 */
export function getRemainingTransactionDebtPaymentsThisMonth(transactions: EnrichedTransaction[], cutoffDate?: string): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  let total = 0;
  for (const t of transactions) {
    if (t.type !== 'expense' || t.category !== 'Debt Payments') continue;
    if (!t.date || !t.date.startsWith(monthStr)) continue;
    const included = cutoffDate ? t.date > cutoffDate : parseInt(t.date.split('-')[2]) >= today;
    if (included) total += Number(t.amount);
  }
  return total;
}

/** Get remaining expenses from today through a specific day in the current month */
export function getRemainingExpensesByDay(
  rules: RuleRow[], dueDay: number, fundingAccountId: string | null
): number {
  const now = new Date();
  const today = now.getDate();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthEnd = new Date(year, month + 1, 0);
  const effectiveDueDay = Math.min(dueDay, monthEnd.getDate());
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    if (fundingAccountId) {
      const src = (r.payment_source || '').replace(/^account:/, '');
      if (src && src !== fundingAccountId) continue;
    }
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getMonth() === month) {
        if (d.getDate() >= today && d.getDate() <= effectiveDueDay) total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd >= today && rd <= effectiveDueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd >= today && rd <= effectiveDueDay) total += amt;
      }
    }
  }
  return total;
}

/** Get first paycheck date in a specific month */
export function getFirstPaycheckInMonth(config: PayScheduleConfig, year: number, month: number): Date | null {
  const paychecks = getPaychecksInMonth(config, year, month);
  return paychecks.length > 0 ? paychecks[0].date : null;
}

/**
 * Get bills from a specific funding account that are due between the start of next month
 * and the first paycheck of that next month.
 * These must be reserved from the current month's ending cash.
 */
/**
 * The next-month window every floor calculation shares: only obligations falling in
 * [nextMonthStart, effectiveCutoff) must be reserved from THIS month's ending cash — anything
 * due on or after the cutoff is covered by next month's first paycheck.
 *
 * Extracted so getAugmentedMinSafeCash's car-loan / insurance / credit-card-minimum loops apply
 * the same cutoff getPrePaycheckNextMonthBills applies to budget rules. They previously reserved
 * by due day unconditionally, which over-reserved every post-paycheck obligation and inflated the
 * floor for every month and every user.
 */
export function getNextMonthPrePaycheckCutoff(
  config: PayScheduleConfig,
  now: Date,
): { nextMonthStart: Date; nextMonthEnd: Date; effectiveCutoff: Date } {
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const fullMonthCutoff = new Date(nextMonthEnd.getTime() + 86400000);

  // Use first paycheck of next month as the cutoff — only bills due before that paycheck
  // arrives need to be reserved from current cash. Falls back to full-month if no paychecks.
  const firstPaycheck = getFirstPaycheckInMonth(config, nextMonthStart.getFullYear(), nextMonthStart.getMonth());
  // Include bills due ON the first paycheck day (paycheck arrives same day those bills are due).
  const effectiveCutoff = firstPaycheck
    ? new Date(firstPaycheck.getFullYear(), firstPaycheck.getMonth(), firstPaycheck.getDate() + 1)
    : fullMonthCutoff;

  return { nextMonthStart, nextMonthEnd, effectiveCutoff };
}

export function getPrePaycheckNextMonthBills(
  rules: RuleRow[],
  config: PayScheduleConfig,
  fundingAccountId: string | null,
  now = new Date(),
): { total: number; items: { name: string; amount: number; dueDay: number }[] } {
  const { nextMonthStart, nextMonthEnd, effectiveCutoff } = getNextMonthPrePaycheckCutoff(config, now);

  let total = 0;
  const items: { name: string; amount: number; dueDay: number }[] = [];

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;

    // If a funding account is specified, only count bills from that account
    if (fundingAccountId) {
      const ruleSource = r.payment_source || '';
      const normalizedSource = ruleSource.startsWith('account:') ? ruleSource.slice(8) : ruleSource;
      // Include bills with no source (default to funding account) or matching funding account
      if (normalizedSource && normalizedSource !== fundingAccountId) continue;
    }

    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > nextMonthEnd) continue;
    }
    if (r.end_date) {
      const ed = new Date(r.end_date + 'T12:00:00');
      if (ed < nextMonthStart) continue;
    }

    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(nextMonthStart);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d < effectiveCutoff) {
        total += amt;
        items.push({ name: r.name, amount: amt, dueDay: d.getDate() });
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const dueDay = Math.min(r.due_day || 1, nextMonthEnd.getDate());
      const d = new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), dueDay);
      if (d >= nextMonthStart && d < effectiveCutoff) {
        total += amt;
        items.push({ name: r.name, amount: amt, dueDay });
      }
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === nextMonthStart.getMonth()) {
        const dueDay = Math.min(r.due_day || 1, nextMonthEnd.getDate());
        const d = new Date(nextMonthStart.getFullYear(), dueMonth, dueDay);
        if (d < effectiveCutoff) {
          total += amt;
          items.push({ name: r.name, amount: amt, dueDay });
        }
      }
    }
  }

  return { total, items };
}

/**
 * Calculate the minimum safe cash that must remain at month-end.
 * = max(cashFloor, prePaycheckNextMonthBills)
 */
export function getMinSafeCash(
  rules: RuleRow[],
  config: PayScheduleConfig,
  cashFloor: number,
  fundingAccountId: string | null,
  now = new Date(),
): number {
  const { total: prePaycheckBills } = getPrePaycheckNextMonthBills(rules, config, fundingAccountId, now);
  return Math.max(cashFloor, prePaycheckBills);
}

/** The subset of credit-card-engine.ts's CardData that getAugmentedMinSafeCash's floor
 * calculation actually reads — kept narrow (rather than importing the full CardData type)
 * so callers/tests only need to provide these fields, not the entire simulated-card shape. */
export type MinSafeCashCard = {
  id: string; name: string; dueDay: number | null; minPayment: number;
  paymentPreference: string | null; autopayFullBalance: boolean; startDate?: string;
};

/**
 * Cash floor augmented with active car-loan payments and credit-card minimums due, on top of
 * the bare pre-paycheck-bills floor from getMinSafeCash(). This is the single source of truth
 * for the floor shown to the user (Forecast, Dashboard) — call it from anywhere that needs to
 * cap "available cash" so the cap always matches what's displayed as "Cash Floor".
 */
export function getAugmentedMinSafeCash(
  rules: RuleRow[],
  config: PayScheduleConfig,
  cashFloor: number,
  fundingAccountId: string | null,
  now: Date,
  carFunds: CarFund[],
  cc: {
    simCards: MinSafeCashCard[]; monthlyRevolvingBalances: Map<string, number[]>; perCardMinPayments: Map<string, number[]>;
    /** Optional — a cycling card's accumulated backlog (credit-card-engine.ts's cyclingBacklog).
     * When provided, a backlog-carrying cycling card's minimum (already folded into
     * prePaycheckBillsTotal below, same as any cycling card) is ALSO counted in
     * ccRevolvingMinIncluded — needed because simulateVariablePayoff's reservedForRevolving now
     * also reserves backlog cards' minimums (so their guarantee in Step 5's avalanche cascade
     * isn't starved by the mandatory pool), and that reservation must not double-count dollars
     * this floor already covers. Omit (or omit this map entirely) for callers that don't carry
     * a CardProjectionResult with backlog data — behavior is identical to before backlog existed. */
    monthlyCyclingBacklog?: Map<string, number[]>;
  } | null,
  monthIdx: number,
  syncCutoffDate?: string,
): { monthMinSafe: number; floorItems: { name: string; amount: number; dueDay: number }[]; prePaycheckBillsTotal: number; ccRevolvingMinIncluded: number } {
  const { total: baseTotal, items: baseItems } = getPrePaycheckNextMonthBills(rules, config, fundingAccountId, now);
  let prePaycheckBillsTotal = baseTotal;
  const floorItems: { name: string; amount: number; dueDay: number }[] = [...baseItems];

  // For month 0: a due date already past syncCutoffDate means Plaid already captured that
  // payment — the live balance reflects it, so reserving it in the floor double-counts it.
  const m0MonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dueSynced = (dueDay: number) =>
    monthIdx === 0 && !!syncCutoffDate &&
    `${m0MonthStr}-${String(dueDay).padStart(2, '0')}` <= syncCutoffDate;

  // Same next-month cutoff getPrePaycheckNextMonthBills applied to baseItems above. An obligation
  // due on or after next month's first paycheck is funded by that paycheck, so reserving it from
  // this month's ending cash over-states the floor. Compared as DATES rather than raw day numbers
  // so a paycheck on the last day of the month, and the no-paycheck full-month fallback, both fall
  // out correctly instead of needing special cases. dueDay is clamped to the length of next month
  // so a day-31 obligation lands on the 30th in a 30-day month rather than rolling into the month
  // after (which would read as post-cutoff and silently drop it).
  const { nextMonthStart, nextMonthEnd, effectiveCutoff } = getNextMonthPrePaycheckCutoff(config, now);
  const duePostPaycheck = (dueDay: number) => {
    const d = new Date(
      nextMonthStart.getFullYear(), nextMonthStart.getMonth(),
      Math.min(dueDay, nextMonthEnd.getDate()),
    );
    return d >= effectiveCutoff;
  };

  for (const cf of carFunds ?? []) {
    if (!cf.payment_start_date) continue;
    const loanDueDay = new Date(cf.payment_start_date + 'T00:00:00').getDate();
    if (dueSynced(loanDueDay)) continue;
    if (duePostPaycheck(loanDueDay)) continue;
    // A saving-phase car's PROJECTED loan participates in the floor exactly like the real loan
    // it becomes at activation — synthesized with the same frozen-equal substitutions activation
    // itself performs (loan_amount ← getLoanPrincipal estimate, loan_start_date ← planned
    // purchase, interest from payment start, scheduled payment) so the floor is a no-op at phase
    // flip. The expense side (useCardProjection's vehicleForecastByMonth) already models the
    // projected payment this way; the floor omitting it made saving- and loan-phase floors
    // diverge, which floor-aware payment caps then propagate into different month-0 payments.
    const effective: CarFund = cf.phase === 'loan' ? cf : {
      ...cf, phase: 'loan', loan_amount: getLoanPrincipal(cf),
      loan_start_date: cf.planned_purchase_date ?? cf.payment_start_date,
      interest_start_date: cf.payment_start_date, actual_monthly_payment: 0,
    };
    const carPayments = getActiveCarLoanPayments([effective], now);
    for (const cp of carPayments) {
      prePaycheckBillsTotal += cp.payment;
      floorItems.push({ name: cf.vehicle_name + ' loan', amount: cp.payment, dueDay: loanDueDay });
    }
  }

  // Insurance, unlike the loan payment above, is owed in BOTH phases — a saving-phase car
  // already needs insurance from the day it's owned, not just once a loan exists. No independent
  // due-day field exists for insurance, so reuse payment_start_date's (or planned_purchase_date's,
  // before payment_start_date is set) day-of-month, matching the loan item's pattern above.
  for (const cf of carFunds ?? []) {
    const insurance = Number(cf.monthly_insurance || 0);
    if (insurance <= 0) continue;
    const anchorDate = cf.phase === 'loan' ? cf.loan_start_date : (cf.loan_start_date ?? cf.planned_purchase_date);
    if (!anchorDate) continue;
    if (monthsBetween(anchorDate, now.toISOString().split('T')[0]) < 0) continue; // not owned yet
    const dueDayBasis = cf.payment_start_date ?? cf.planned_purchase_date;
    if (!dueDayBasis) continue;
    const insuranceDueDay = new Date(dueDayBasis + 'T00:00:00').getDate();
    if (dueSynced(insuranceDueDay)) continue;
    if (duePostPaycheck(insuranceDueDay)) continue;
    prePaycheckBillsTotal += insurance;
    floorItems.push({ name: cf.vehicle_name + ' insurance', amount: insurance, dueDay: insuranceDueDay });
  }

  // Tracks the revolving branch below, PLUS the cycling/"else" branch ONLY when that card
  // carries backlog (cc.monthlyCyclingBacklog) — a pure cycling card's "<name> min" floor item is
  // for an unrelated reason (protecting its own minimum, not a revolving reservation) and is
  // never double-reserved elsewhere, so it's excluded here. Lets callers that separately reserve
  // revolving (and backlog) minimums elsewhere (simulateVariablePayoff's reservedForRevolving)
  // know how much of that reservation this floor has already covered, so they don't double-reserve it.
  let ccRevolvingMinIncluded = 0;
  if (cc) {
    for (const card of cc.simCards) {
      const revBal = cc.monthlyRevolvingBalances?.get(card.id)?.[monthIdx] ?? 1;
      if (revBal > 0) {
        const minPay = cc.perCardMinPayments?.get(card.id)?.[monthIdx] ?? 0;
        if (minPay > 0 && card.dueDay) {
          if (dueSynced(card.dueDay)) continue;
          if (duePostPaycheck(card.dueDay)) continue;
          prePaycheckBillsTotal += minPay;
          ccRevolvingMinIncluded += minPay;
          floorItems.push({ name: card.name + ' min', amount: minPay, dueDay: card.dueDay });
        }
      } else {
        // Paid off / cycling — floor for statement or full-balance preference cards only.
        if (card.paymentPreference !== 'statement' && card.paymentPreference !== 'full' && !card.autopayFullBalance) continue;
        // Use the card's configured minimum payment, not the full monthly purchases — the floor
        // represents the minimum cash that must remain; the full cycling payment is a planned
        // outflow on top of the floor, not part of it.
        if (!card.dueDay || card.minPayment <= 0) continue;
        // A card with a future card_start_date has a $0 simulated balance for an unrelated reason
        // (simulateVariablePayoff hasn't activated it yet, see cardStartMonths) — without this
        // check it looked identical to a genuinely paid-off cycling card and reserved its minimum
        // in the floor every month from today, even though the card won't have its first real
        // payment due until that start month.
        if (card.startDate && monthsBetween(card.startDate, now.toISOString().split('T')[0]) < 0) continue;
        if (dueSynced(card.dueDay)) continue;
        if (duePostPaycheck(card.dueDay)) continue;
        prePaycheckBillsTotal += card.minPayment;
        floorItems.push({ name: card.name + ' min', amount: card.minPayment, dueDay: card.dueDay });
        // A backlog-carrying cycling card's minimum is ALSO reserved by simulateVariablePayoff's
        // reservedForRevolving (see its own comment) — count it here so that reservation doesn't
        // double-charge dollars this floor just covered. A cycling card with NO backlog is
        // unaffected (reservedForRevolving never reserves for it in the first place).
        const backlog = cc.monthlyCyclingBacklog?.get(card.id)?.[monthIdx] ?? 0;
        if (backlog > 0) ccRevolvingMinIncluded += card.minPayment;
      }
    }
  }

  const monthMinSafe = Math.max(cashFloor, prePaycheckBillsTotal);
  return { monthMinSafe, floorItems, prePaycheckBillsTotal, ccRevolvingMinIncluded };
}

/** Get remaining scheduled expenses this month from today onward */
export function getRemainingExpensesThisMonth(rules: RuleRow[], accounts: AccountRow[], now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(today);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) { total += amt; d.setDate(d.getDate() + 7); }
    } else if (r.frequency === 'monthly') {
      const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
      const d = new Date(now.getFullYear(), now.getMonth(), dueDay);
      if (d >= today && d <= monthEnd) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === now.getMonth()) {
        const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
        const d = new Date(now.getFullYear(), dueMonth, dueDay);
        if (d >= today) total += amt;
      }
    }
  }
  return total;
}

/**
 * Get income received into a funding account before a specific day of month.
 * For weekly/biweekly, counts paychecks with date <= dueDay.
 * For monthly, paycheck on paycheckDay <= dueDay means it's available.
 */
export function getIncomeBeforeDay(config: PayScheduleConfig, year: number, month: number, dueDay: number): number {
  const paychecks = getPaychecksInMonth(config, year, month);
  return paychecks.filter(p => p.date.getDate() <= dueDay).reduce((s, p) => s + p.net, 0);
}

/**
 * Get expenses due from a funding account before a specific day of month (inclusive).
 */
export function getExpensesBeforeDay(rules: RuleRow[], year: number, month: number, dueDay: number, fundingAccountId: string | null): number {
  const monthEnd = new Date(year, month + 1, 0);
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type === 'income') continue;
    if (fundingAccountId) {
      const src = (r.payment_source || '').replace(/^account:/, '');
      if (src && src !== fundingAccountId) continue;
    }
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getDate() <= dueDay && d.getMonth() === month) {
        total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd <= dueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd <= dueDay) total += amt;
      }
    }
  }
  return total;
}

/**
 * Get non-paycheck income from rules before a specific day in a specific month (for future months).
 */
export function getNonPaycheckIncomeBeforeDay(
  rules: RuleRow[], year: number, month: number, dueDay: number, fundingAccountId: string | null
): number {
  const monthEnd = new Date(year, month + 1, 0);
  let total = 0;

  for (const r of rules) {
    if (!r.active || r.rule_type !== 'income') continue;
    if (r.start_date) {
      const sd = new Date(r.start_date + 'T12:00:00');
      if (sd > monthEnd) continue;
    }
    if (fundingAccountId && r.deposit_account) {
      const dep = r.deposit_account.replace(/^account:/, '');
      if (dep && dep !== fundingAccountId) continue;
    }
    const amt = Number(r.amount);

    if (r.frequency === 'weekly') {
      const dayOfWeek = r.due_day ?? 5;
      const d = new Date(year, month, 1);
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d.getDate() <= dueDay && d.getMonth() === month) {
        total += amt;
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'monthly') {
      const rd = Math.min(r.due_day || 1, monthEnd.getDate());
      if (rd <= dueDay) total += amt;
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const rd = Math.min(r.due_day || 1, monthEnd.getDate());
        if (rd <= dueDay) total += amt;
      }
    }
  }
  return total;
}

/**
 * Calculate safe-to-pay for a card by its due date.
 * = funding balance + income before due date - expenses before due date - cash floor - other card mins due before this date
 */
export function getSafeToPayByDueDate(
  config: PayScheduleConfig,
  rules: RuleRow[],
  fundingBalance: number,
  cashFloor: number,
  fundingAccountId: string | null,
  dueDay: number,
  year: number,
  month: number,
): number {
  const incBefore = getIncomeBeforeDay(config, year, month, dueDay);
  const expBefore = getExpensesBeforeDay(rules, year, month, dueDay, fundingAccountId);
  return Math.max(0, fundingBalance + incBefore - expBefore - cashFloor);
}

/**
 * Generate current-month transactions from recurring rules.
 * This is the shared utility so all pages (Dashboard, Debt Payoff, Budget Control)
 * produce the same generated transaction set before merging with real DB transactions.
 */
export function generateMonthTransactionsFromRules(
  rules: RuleRow[],
  accounts: AccountRow[],
  year: number,
  month: number, // 0-indexed
): EnrichedTransaction[] {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const generated: EnrichedTransaction[] = [];

  const accountMap: Record<string, AccountRow> = {};
  accounts.forEach(a => { accountMap[a.id] = a; accountMap[`account:${a.id}`] = a; });

  const normalizeSource = (src: string | null | undefined) => {
    if (!src) return '';
    if (src.startsWith('account:')) return src;
    if (accountMap[src]) return `account:${src}`;
    return src;
  };

  rules.filter(r => r.active).forEach(r => {
    const rawSource = r.rule_type === 'income'
      ? (r.deposit_account || r.payment_source)
      : (r.payment_source || r.deposit_account);
    const source = normalizeSource(rawSource);

    if (r.start_date) {
      const startDate = new Date(r.start_date + 'T12:00:00');
      if (startDate > monthEnd) return;
    }

    const txType = r.rule_type === 'income' ? 'income' : 'expense';
    const txCategory = r.rule_type === 'income' ? 'Income' : r.category;

    if (r.frequency === 'weekly') {
      const d = new Date(monthStart);
      const dayOfWeek = r.due_day ?? 5;
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) {
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
        d.setDate(d.getDate() + 7);
      }
    } else if (r.frequency === 'biweekly') {
      const d = new Date(monthStart);
      const dayOfWeek = r.due_day ?? 5;
      while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
      while (d <= monthEnd) {
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
        d.setDate(d.getDate() + 14);
      }
    } else if (r.frequency === 'monthly') {
      const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
      const d = new Date(year, month, dueDay);
      if (d >= monthStart && d <= monthEnd) {
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
      }
    } else if (r.frequency === 'yearly') {
      const dueMonth = (r.due_month ?? 1) - 1;
      if (dueMonth === month) {
        const dueDay = Math.min(r.due_day || 1, monthEnd.getDate());
        const d = new Date(year, dueMonth, dueDay);
        const dateStr = d.toISOString().split('T')[0];
        generated.push({
          id: `gen:${r.id}:${dateStr}`, date: dateStr, type: txType,
          amount: Number(r.amount), category: txCategory, note: r.name,
          payment_source: source, isGenerated: true,
        });
      }
    }
  });

  return generated;
}

export function generateCurrentMonthTransactionsFromRules(
  rules: RuleRow[],
  accounts: AccountRow[],
): EnrichedTransaction[] {
  const now = new Date();
  return generateMonthTransactionsFromRules(rules, accounts, now.getFullYear(), now.getMonth());
}

/**
 * Merge real DB transactions with generated recurring transactions for the current month.
 * Deduplicates by matching date + note + amount to avoid double-counting.
 */
export function mergeWithGeneratedTransactions(
  realTransactions: EnrichedTransaction[],
  rules: RuleRow[],
  accounts: AccountRow[],
): EnrichedTransaction[] {
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthReal = realTransactions.filter(t => t.date?.startsWith(monthStr));
  const generated = generateCurrentMonthTransactionsFromRules(rules, accounts);

  // Deduplicate: if a real transaction matches a generated one (same date + note + amount), skip generated
  const realSet = new Set(currentMonthReal.map(t => `${t.date}:${t.note}:${t.amount}`));
  const uniqueGenerated = generated.filter(g => !realSet.has(`${g.date}:${g.note}:${g.amount}`));

  // Include non-current-month real transactions + current month real + unique generated
  const nonCurrentMonth = realTransactions.filter(t => !t.date?.startsWith(monthStr));
  return [...nonCurrentMonth, ...currentMonthReal, ...uniqueGenerated];
}

/**
 * Create virtual debt payment transaction entries from recommendation results.
 * These are injected into the transaction stream so all current-month helpers see them.
 */
export function createDebtPaymentTransactions(
  recommendations: { cardId: string; cardName: string; payment: number; dueDay?: number | null }[],
  fundingAccountId: string | null,
): EnrichedTransaction[] {
  const now = new Date();
  const results: EnrichedTransaction[] = [];
  for (const rec of recommendations) {
    if (rec.payment <= 0) continue;
    const dueDay = rec.dueDay || 31;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const effectiveDay = Math.min(dueDay, monthEnd);
    const d = new Date(now.getFullYear(), now.getMonth(), effectiveDay);
    const dateStr = d.toISOString().split('T')[0];
    results.push({
      id: `debtpay:${rec.cardId}:${dateStr}`,
      date: dateStr,
      type: 'expense',
      amount: Math.round(rec.payment * 100) / 100,
      category: 'Debt Payments',
      note: `${rec.cardName} Payment`,
      payment_source: fundingAccountId ? `account:${fundingAccountId}` : 'bank_account',
      isGenerated: true,
      isDebtPayment: true,
    });
  }
  return results;
}

/**
 * Merge debt payment transactions into the base transaction stream.
 * Removes any previously injected debt payments, then adds new ones.
 * Real (user-entered) debt payment transactions are preserved.
 */
export function mergeDebtPaymentsIntoStream(
  baseTxns: EnrichedTransaction[],
  debtPaymentTxns: EnrichedTransaction[],
): EnrichedTransaction[] {
  const withoutInjected = baseTxns.filter(t => !t.isDebtPayment);
  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const realDebtNotes = new Set(
    withoutInjected
      .filter(t => t.category === 'Debt Payments' && t.date?.startsWith(monthStr) && !t.isGenerated)
      .map(t => (t.note || '').toLowerCase())
  );
  const uniqueGenerated = debtPaymentTxns.filter(g => !realDebtNotes.has((g.note || '').toLowerCase()));
  return [...withoutInjected, ...uniqueGenerated];
}

/**
 * Get available cash for a linked account after remaining-month obligations.
 * Used by Savings Goals / Car Fund for linked-account "available after bills" display.
 * Formula: accountBalance + remainingIncome - remainingExpenses (including debt payments)
 * No cash floor subtracted — shows true available amount after all obligations.
 */
export function getAccountRemainingCashThisMonth(
  accountId: string,
  accountType: string,
  allTransactions: EnrichedTransaction[],
  accountBalance: number,
  _cashFloor?: number,
): number {
  const now = new Date();
  const today = now.getDate();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const acctKey = `account:${accountId}`;
  const isDefault = ['checking', 'business_checking', 'cash'].includes(accountType);
  let income = 0, expenses = 0;
  for (const t of allTransactions) {
    if (!t.date?.startsWith(monthStr)) continue;
    const txDay = parseInt(t.date.split('-')[2]);
    if (txDay < today) continue;
    const src = t.payment_source || '';
    const matchesAccount = src === accountId || src === acctKey;
    const isUnattributed = !src || src === 'bank_account';
    const isForThisAccount = matchesAccount || (isDefault && isUnattributed);
    if (!isForThisAccount) continue;
    if (t.type === 'income') income += Number(t.amount);
    else if (t.type === 'expense') expenses += Number(t.amount);
  }
  return accountBalance + income - expenses;
}
