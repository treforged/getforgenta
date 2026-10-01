// Read the INSTALMENT-PLAN rows off a credit-card statement, deterministically (ask baee397e).
//
// Tre, 2026-10-01: "i dont think we made the uploader in the app yet to assist with automatic plan
// creation/ updates". `statement-parse.ts` reads the summary figures and promo RATES; this reads the
// two plan tables Chase prints, so the importer can propose each plan as a card balance tranche.
//
// ⚠️ THE ROW SHAPE COMES FROM A REAL pdf.js EXTRACTION of a Chase statement, not from how the PDF
// looks; the test fixture keeps that layout with invented merchants and amounts. Columns arrive separated by runs of spaces, and a page can arrive as ONE line (measured
// 2026-09-14 in statement-parse.ts), so nothing here is anchored to a line start.
//
// ⚠️ A ROW IS ALL OR NOTHING. Every column must parse, or the row is skipped. These figures become a
// tranche's balance and its contractual instalment, so a zero invented from a failed match would plan
// payments against a balance no statement stated. Silence is recoverable; a confident figure is not.

export interface StatementPlan {
  kind: 'pay_over_time' | 'equal_pay';
  /** Trimmed, internal whitespace collapsed. Kept verbatim so a person recognises their own plan. */
  description: string;
  /** Original principal (Pay Over Time) or total qualified amount (Equal Pay). */
  originalAmount: number;
  remainingBalance: number;
  /** Plan payment due (Pay Over Time) or promo minimum pay (Equal Pay). */
  monthlyPayment: number;
  /** Pay Over Time's flat monthly fee; null for Equal Pay, which charges none. */
  monthlyFee: number | null;
  /** `YYYY-MM-DD`; Pay Over Time only. */
  startDate: string | null;
  /** `YYYY-MM-DD` expiration; Equal Pay only. */
  endDate: string | null;
  totalPayments: number | null;
  remainingPayments: number | null;
}

const SEP = String.raw`[^\S\n]+`;
const MONEY = String.raw`\$([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})`;
const DATE = String.raw`([0-9]{2})/([0-9]{2})/([0-9]{4})`;
const COUNT = String.raw`([0-9]{1,3})`;

// The description must start with a letter and may not contain `$` or `/`, so it cannot reach back
// across a preceding row's amount or date. Bounded, so there is no catastrophic backtracking.
// ⚠️ LIMIT: when a page arrives as ONE line, the FIRST row's description can absorb up to five words
// of a heading before it (e.g. "AND REDEMPTIONS ACME STORE"). Rows after the first are fenced by the
// previous row's `$` figure. The amounts are unaffected; only the label is longer.
const PAY_OVER_TIME = new RegExp(
  String.raw`([A-Za-z][A-Za-z0-9#&'.-]*(?:[^\S\n][A-Za-z0-9#&'.-]+){0,4})` +
    `${SEP}${DATE}${SEP}${MONEY}${SEP}${COUNT}${SEP}${COUNT}${SEP}${MONEY}${SEP}${MONEY}${SEP}${MONEY}`,
  'g',
);

const EQUAL_PAY = new RegExp(
  String.raw`(Equal[^\S\n]+Pay(?:[^\S\n]+[A-Za-z]+){0,3}?)` +
    `${SEP}${MONEY}${SEP}${MONEY}${SEP}${DATE}${SEP}-{2,}${SEP}-{2,}${SEP}-{2,}${SEP}${MONEY}`,
  'gi',
);

function money(s: string): number {
  return Number(s.replace(/,/g, ''));
}

function isoDate(mm: string, dd: string, yyyy: string): string | null {
  const m = Number(mm);
  const d = Number(dd);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function clean(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function payOverTimeRows(text: string): StatementPlan[] {
  const out: StatementPlan[] = [];
  PAY_OVER_TIME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PAY_OVER_TIME.exec(text)) !== null) {
    const [, desc, mm, dd, yyyy, orig, total, remaining, remPrincipal, fee, payment] = m;
    const startDate = isoDate(mm, dd, yyyy);
    const totalPayments = Number(total);
    const remainingPayments = Number(remaining);
    const originalAmount = money(orig);
    const remainingBalance = money(remPrincipal);
    if (startDate === null) continue;
    if (remainingPayments > totalPayments || remainingBalance > originalAmount) continue;
    out.push({
      kind: 'pay_over_time',
      description: clean(desc),
      originalAmount,
      remainingBalance,
      monthlyPayment: money(payment),
      monthlyFee: money(fee),
      startDate,
      endDate: null,
      totalPayments,
      remainingPayments,
    });
  }
  return out;
}

function equalPayRows(text: string): StatementPlan[] {
  const out: StatementPlan[] = [];
  EQUAL_PAY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EQUAL_PAY.exec(text)) !== null) {
    const [, desc, qualified, remaining, mm, dd, yyyy, minPay] = m;
    const endDate = isoDate(mm, dd, yyyy);
    const originalAmount = money(qualified);
    const remainingBalance = money(remaining);
    if (endDate === null || remainingBalance > originalAmount) continue;
    out.push({
      kind: 'equal_pay',
      description: clean(desc),
      originalAmount,
      remainingBalance,
      monthlyPayment: money(minPay),
      monthlyFee: null,
      startDate: null,
      endDate,
      totalPayments: null,
      remainingPayments: null,
    });
  }
  return out;
}

/**
 * Every plan row the statement prints, each once. A statement can repeat a table, so identical rows
 * collapse; two DIFFERENT plans sharing a description (five "Equal Pay Promo" rows) are all kept.
 */
export function parseStatementPlans(text: string | null | undefined): StatementPlan[] {
  const source = typeof text === 'string' ? text : '';
  const seen = new Set<string>();
  return [...payOverTimeRows(source), ...equalPayRows(source)].filter(p => {
    const key = [p.kind, p.description.toLowerCase(), p.originalAmount, p.remainingBalance, p.startDate, p.endDate].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
