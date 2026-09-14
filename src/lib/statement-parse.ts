// Read the figures off a credit-card statement, deterministically.
//
// Tre, 2026-09-12: "make a feature where users can add or upload a statement that can be auto
// scanned for pulling statement balance, interest saving balance, any payment plans, or anything
// like that that can be auto added into their account for them."
//
// ⚠️ NO MODEL IS INVOLVED, AND THAT IS HIS OTHER INSTRUCTION RATHER THAN A PREFERENCE. In the same
// breath he said the AI in the dev build is "suboptimal very much so", so this must not be built on
// it without measuring it first. It does not need to be: Sam extracted these exact figures from the
// real Prime Visa PDF by hand the same hour, with pypdf and the statement's own labels. A statement
// is a LABELLED DOCUMENT — the numbers sit beside fixed captions that the issuer prints every
// month. That is a parsing problem, and a parser can be wrong in ways you can test.
//
// ⚠️ WHAT IT REFUSES IS THE DESIGN. Every field is independently optional and absent means `null`,
// never 0. These values go on to set a card's statement balance and minimum payment, so a zero
// invented from a failed match is a wrong number on a money row — the app would then plan a payment
// against a balance no statement ever stated. Silence is recoverable; a confident figure is not.
//
// ⚠️ AND IT PROPOSES, IT DOES NOT WRITE. The caller shows the person what was found beside what
// they currently have, and they confirm. Nothing here touches an account.
//
// ⚠️ BUILT FROM THE LABELS, NOT FROM A CAPTURED PDF, and that limit is real. The captions below are
// the ones Sam named from the live statement ("Interest Saving Balance", "Minimum Payment Due",
// "Total Plans Payment Due", "New Balance"); the exact whitespace and column layout of the
// extracted text are NOT pinned, because I have not had that text in front of me. The matching is
// deliberately tolerant of runs of spaces and of a line break between caption and figure for that
// reason, and the tests cover both shapes. A real capture should be added to the fixtures the first
// time one is available.

/** Every figure this can find. `null` means "not stated", never zero. */
export interface StatementFigures {
  /** The full balance owed as of the statement — Chase prints it as "New Balance". */
  newBalance: number | null;
  /**
   * What must be paid to avoid interest on purchases. Chase calls it the "Interest Saving Balance";
   * it is LOWER than the new balance whenever a promotional or instalment plan is running, which is
   * exactly why reading it off by hand matters.
   */
  interestSavingBalance: number | null;
  minimumPaymentDue: number | null;
  /** The instalment-plan portion of the minimum, where the issuer breaks it out. */
  totalPlansPaymentDue: number | null;
  /**
   * The balance sitting in promotional financing, derived rather than printed.
   *
   * ⚠️ DERIVED ONLY WHEN BOTH INPUTS ARE PRESENT, from the statement's own relationship:
   * new balance − interest saving balance is the part that is NOT accruing interest this cycle,
   * i.e. what is in a plan. Sam got 6738.11 this way on the real statement. If either side is
   * missing this stays `null` rather than guessing from one.
   */
  flexibleFinancingBalance: number | null;
  /** Promotional rate rows, e.g. an Equal Pay promo at 0.00%. Empty when none are printed. */
  promoRates: readonly PromoRate[];
}

export interface PromoRate {
  /** The caption as printed, trimmed — kept verbatim so a person can recognise their own plan. */
  label: string;
  /** The annual rate as a percentage, so 0.00 means a zero-interest promo. */
  aprPercent: number;
}

/**
 * A money amount as statements print it: optional `$`, thousands separators, two decimals.
 *
 * ⚠️ A LEADING MINUS OR PARENTHESES MEANS A CREDIT, and those are NOT accepted for these fields. A
 * negative "new balance" is a credit position; writing it onto a card as a balance would invert the
 * sign of somebody's debt. If a statement ever prints one, this returns null and the person types
 * it themselves.
 */
const AMOUNT = String.raw`\$?\s*([0-9][0-9,]*\.[0-9]{2})`;

/**
 * Find the amount printed against a caption.
 *
 * The caption may be followed by spaces, dots (leader dots are common), or a single line break
 * before the figure. Matching is case-insensitive because issuers are inconsistent about it.
 */
function amountFor(text: string, caption: string): number | null {
  const escaped = caption.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  // `[^\S\n]` is "whitespace that is not a newline", so a caption and its figure may be separated
  // by spaces or leader dots, and at most ONE line break — not an arbitrary gap that would let a
  // caption near the top of a page capture a number from much further down.
  const re = new RegExp(`${escaped}[^\\S\\n]*[.:]*[^\\S\\n]*\\n?[^\\S\\n]*${AMOUNT}`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** Captions that mean the same field across issuers. First match wins. */
const CAPTIONS = {
  newBalance: ['New Balance', 'Statement Balance', 'Total Balance Due'],
  interestSavingBalance: ['Interest Saving Balance', 'Interest Saving Bal'],
  minimumPaymentDue: ['Minimum Payment Due', 'Minimum Payment'],
  totalPlansPaymentDue: ['Total Plans Payment Due', 'Plans Payment Due'],
} as const;

function firstAmount(text: string, captions: readonly string[]): number | null {
  for (const caption of captions) {
    const found = amountFor(text, caption);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Promotional rate rows.
 *
 * ⚠️ ONLY ROWS THAT CARRY BOTH A LABEL AND A PERCENTAGE. A bare percentage somewhere in the text is
 * not a plan — a statement is full of rates, including the purchase APR and the cash-advance APR,
 * and treating those as promos would tell somebody they have financing plans they do not have.
 */
const PROMO_LINE = /^[^\S\n]*([A-Za-z][A-Za-z0-9 &/'-]{2,40}?(?:promo|promotion|plan|equal pay)[A-Za-z ]{0,20})[^\S\n]*[.:]*[^\S\n]*([0-9]{1,2}\.[0-9]{2})\s*%/gim;

function promoRates(text: string): PromoRate[] {
  const out: PromoRate[] = [];
  const seen = new Set<string>();
  PROMO_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROMO_LINE.exec(text)) !== null) {
    const label = m[1].trim().replace(/\s+/g, ' ');
    const aprPercent = Number(m[2]);
    if (!Number.isFinite(aprPercent)) continue;
    // A statement repeats its plan table in the summary and again in the detail; one row per
    // (label, rate) is what the person has, not one per printing.
    const key = `${label.toLowerCase()}|${aprPercent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, aprPercent });
  }
  return out;
}

/**
 * Everything this can read from the statement text, with nothing invented.
 *
 * `text` is whatever the caller extracted — pasted by the person, or pulled out of a PDF. This
 * function neither fetches nor parses a file; it works on text so it can be tested without one.
 */
export function parseStatement(text: string | null | undefined): StatementFigures {
  const source = typeof text === 'string' ? text : '';

  const newBalance = firstAmount(source, CAPTIONS.newBalance);
  const interestSavingBalance = firstAmount(source, CAPTIONS.interestSavingBalance);

  // ⚠️ ONLY WHEN IT IS POSITIVE AND THE ORDER MAKES SENSE. An interest-saving balance ABOVE the new
  // balance is not a plan of negative size; it means one of the two captions matched the wrong
  // figure, and the honest response to a contradiction is to report nothing rather than a number
  // derived from a mismatch.
  const gap = newBalance !== null && interestSavingBalance !== null
    ? newBalance - interestSavingBalance
    : null;
  const flexibleFinancingBalance = gap !== null && gap > 0 ? Math.round(gap * 100) / 100 : null;

  return {
    newBalance,
    interestSavingBalance,
    minimumPaymentDue: firstAmount(source, CAPTIONS.minimumPaymentDue),
    totalPlansPaymentDue: firstAmount(source, CAPTIONS.totalPlansPaymentDue),
    flexibleFinancingBalance,
    promoRates: promoRates(source),
  };
}

/** True when the parse found nothing at all — the caller must say so rather than show empty fields. */
export function isEmptyParse(figures: StatementFigures): boolean {
  return figures.newBalance === null
    && figures.interestSavingBalance === null
    && figures.minimumPaymentDue === null
    && figures.totalPlansPaymentDue === null
    && figures.promoRates.length === 0;
}

/** The account columns a confirmed parse would set, omitting every field the statement did not state. */
export function statementPatch(figures: StatementFigures): {
  statement_balance?: number;
  min_payment?: number;
  installment_balance?: number;
  installment_monthly_payment?: number;
} {
  const patch: ReturnType<typeof statementPatch> = {};
  // ⚠️ THE INTEREST-SAVING BALANCE IS THE ONE THAT GOES TO `statement_balance`, NOT THE NEW BALANCE.
  // That column drives the "pay the statement balance to stay interest-free" behaviour, and the
  // figure that achieves that is the interest-saving one whenever a plan is running — which is the
  // whole reason Tre asked for this field by name. The new balance is only used when the statement
  // prints no interest-saving line, which is the case for a card with no plans, where the two are
  // the same number anyway.
  const statementBalance = figures.interestSavingBalance ?? figures.newBalance;
  if (statementBalance !== null) patch.statement_balance = statementBalance;
  if (figures.minimumPaymentDue !== null) patch.min_payment = figures.minimumPaymentDue;
  if (figures.flexibleFinancingBalance !== null) patch.installment_balance = figures.flexibleFinancingBalance;
  if (figures.totalPlansPaymentDue !== null) {
    patch.installment_monthly_payment = figures.totalPlansPaymentDue;
  }
  return patch;
}
