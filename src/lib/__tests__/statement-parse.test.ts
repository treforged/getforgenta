/**
 * READING A STATEMENT WITHOUT A MODEL.
 *
 * Tre, 2026-09-12: "make a feature where users can add or upload a statement that can be auto
 * scanned for pulling statement balance, interest saving balance, any payment plans, or anything
 * like that that can be auto added into their account for them." And, the same breath: the AI in
 * the dev build is "suboptimal very much so", so this must not be built on it without measuring it.
 *
 * It does not need to be. Sam pulled these exact figures out of the real Prime Visa PDF by hand the
 * same hour — Interest Saving Balance 1451.88, Minimum Payment Due 773.05, Total Plans Payment Due
 * 198.83, an Equal Pay promo at 0.00%, and 6738.11 of flexible financing derived from the
 * statement's own relationship between the two balances. Those numbers are the fixtures below.
 *
 * ⚠️ THE CASES THAT MATTER ARE THE REFUSALS. These figures set a card's statement balance and
 * minimum payment, so a value invented from a failed match is a wrong number on a money row — the
 * app would plan a payment against a balance no statement ever stated. Every absent field must come
 * back `null` and never 0.
 */
import { describe, it, expect } from 'vitest';
import { parseStatement, statementPatch, isEmptyParse } from '../statement-parse';

/**
 * Shaped like extracted PDF text: captions and figures separated by runs of spaces.
 *
 * ⚠️ THIS IS A RECONSTRUCTION FROM THE CAPTIONS SAM NAMED, NOT A CAPTURED PDF. The figures are his
 * real ones; the exact column layout is not pinned, because that text has not been in front of me.
 * That is why both the same-line and wrapped shapes are exercised below — and why a real capture
 * should replace this the first time one is available.
 */
const PRIME_VISA = `
CHASE PRIME VISA
Account Number: ****5630

ACCOUNT SUMMARY
Previous Balance                 $7,204.66
Payment, Credits                 -$743.75
Purchases                        $728.83
New Balance                      $8,189.99
Interest Saving Balance          $1,451.88

PAYMENT INFORMATION
Minimum Payment Due              $773.05
Total Plans Payment Due          $198.83
Payment Due Date                 10/05/26

PLANS
Equal Pay Promo                  0.00%
Purchase APR                     27.24%
Cash Advance APR                 29.99%
`;

describe('the real statement, as Sam extracted it by hand', () => {
  const parsed = parseStatement(PRIME_VISA);

  it('reads the interest saving balance — the field Tre asked for by name', () => {
    expect(parsed.interestSavingBalance).toBe(1451.88);
  });

  it('reads the new balance and the minimum payment', () => {
    expect(parsed.newBalance).toBe(8189.99);
    expect(parsed.minimumPaymentDue).toBe(773.05);
  });

  it('reads the plans portion of the minimum', () => {
    expect(parsed.totalPlansPaymentDue).toBe(198.83);
  });

  it('derives the flexible financing balance from the two balances', () => {
    expect(parsed.flexibleFinancingBalance).toBe(6738.11);
  });

  it('⚠️ FINDS THE PROMO AND NOT THE ORDINARY APRs', () => {
    // A statement is full of rates. Treating the purchase APR as a plan would tell somebody they
    // have financing they do not have.
    expect(parsed.promoRates).toEqual([{ label: 'Equal Pay Promo', aprPercent: 0 }]);
  });
});

describe('what it refuses rather than guesses', () => {
  it('⚠️ RETURNS null, NEVER 0, FOR EVERY FIELD A STATEMENT DOES NOT STATE', () => {
    const parsed = parseStatement('CHASE\nAccount Number: ****5630\nThank you for your business.');
    expect(parsed.newBalance).toBeNull();
    expect(parsed.interestSavingBalance).toBeNull();
    expect(parsed.minimumPaymentDue).toBeNull();
    expect(parsed.totalPlansPaymentDue).toBeNull();
    expect(parsed.flexibleFinancingBalance).toBeNull();
    expect(parsed.promoRates).toEqual([]);
    expect(isEmptyParse(parsed)).toBe(true);
  });

  it('handles empty, null and undefined input without throwing', () => {
    for (const input of ['', null, undefined]) {
      expect(isEmptyParse(parseStatement(input))).toBe(true);
    }
  });

  it('⚠️ REFUSES A CREDIT BALANCE rather than writing a negative as a debt', () => {
    // A negative new balance is a credit position. Writing it onto a card would invert the sign of
    // somebody's debt, so it reads as "not stated" and they type it themselves.
    const parsed = parseStatement('New Balance                      -$120.00');
    expect(parsed.newBalance).toBeNull();
  });

  it('⚠️ DERIVES NOTHING FROM ONE SIDE — a missing balance is not a zero plan', () => {
    const parsed = parseStatement('New Balance   $8,189.99');
    expect(parsed.interestSavingBalance).toBeNull();
    expect(parsed.flexibleFinancingBalance).toBeNull();
  });

  it('⚠️ REPORTS NOTHING WHEN THE TWO BALANCES CONTRADICT EACH OTHER', () => {
    // An interest-saving balance ABOVE the new balance means a caption matched the wrong figure.
    // A number derived from a mismatch is worse than no number.
    const parsed = parseStatement('New Balance  $100.00\nInterest Saving Balance  $500.00');
    expect(parsed.flexibleFinancingBalance).toBeNull();
  });

  it('does not let a caption capture a figure from far down the page', () => {
    const parsed = parseStatement('Minimum Payment Due\n\n\nUNRELATED SECTION\nSome total   $999.00');
    expect(parsed.minimumPaymentDue).toBeNull();
  });

  it('reads a figure that wrapped onto the next line, which extracted PDFs do', () => {
    const parsed = parseStatement('Interest Saving Balance\n   $1,451.88');
    expect(parsed.interestSavingBalance).toBe(1451.88);
  });
});

describe('what a confirmed parse would write', () => {
  it('⚠️ SENDS THE INTEREST-SAVING BALANCE TO `statement_balance`, NOT THE NEW BALANCE', () => {
    // That column drives "pay this to stay interest-free", and with a plan running the figure that
    // achieves it is the interest-saving one. Using the new balance would have the app plan an
    // 8,189.99 payment to avoid interest that 1,451.88 avoids.
    const patch = statementPatch(parseStatement(PRIME_VISA));
    expect(patch.statement_balance).toBe(1451.88);
  });

  it('falls back to the new balance for a card with no plans, where they are the same', () => {
    const patch = statementPatch(parseStatement('New Balance  $420.00\nMinimum Payment Due  $35.00'));
    expect(patch.statement_balance).toBe(420);
  });

  it('carries the minimum and the plan figures', () => {
    const patch = statementPatch(parseStatement(PRIME_VISA));
    expect(patch.min_payment).toBe(773.05);
    expect(patch.installment_balance).toBe(6738.11);
    expect(patch.installment_monthly_payment).toBe(198.83);
  });

  it('⚠️ OMITS EVERY FIELD THE STATEMENT DID NOT STATE — an absent key, never a zero', () => {
    // A patch carrying `min_payment: 0` would erase a real minimum with a figure no statement gave.
    const patch = statementPatch(parseStatement('New Balance  $420.00'));
    expect(patch).toEqual({ statement_balance: 420 });
    expect('min_payment' in patch).toBe(false);
    expect('installment_balance' in patch).toBe(false);
  });

  it('writes nothing at all from an unreadable statement', () => {
    expect(statementPatch(parseStatement('nothing useful here'))).toEqual({});
  });
});

/**
 * ⚠️ THE SHAPE pdf.js ACTUALLY RETURNS, CAPTURED RATHER THAN IMAGINED — and it caught a real defect.
 *
 * Measured 2026-09-14: a genuine PDF carrying these captions, put through real pdf.js, comes back as
 * ONE LINE of 184 characters, space-separated, with not a newline in it. The reconstructed fixture
 * above uses caption-per-line with runs of spaces, which is how a statement LOOKS and is not how it
 * EXTRACTS.
 *
 * Every money field parsed identically from both — those match on adjacency. But `promoRates` came
 * back EMPTY from the real text while the reconstruction found the promo, because the promo regex
 * was anchored to a line start. **The hand-built fixture asserted a feature that did not work.**
 * That is exactly the limit the commit stated and this is it closing.
 *
 * Keep BOTH shapes. A statement pasted by hand really does have line breaks; one extracted from a
 * PDF really does not. Losing either loses a case the other cannot see.
 */
const REAL_PDF_EXTRACTION =
  'CHASE PRIME VISA STATEMENT New Balance $8,189.99 Interest Saving Balance $1,451.88 Minimum Payment Due $773.05 Total Plans Payment Due $198.83 Equal Pay Promo 0.00% Purchase APR 27.24%';

describe('the shape real pdf.js returns — one line, no newlines', () => {
  const parsed = parseStatement(REAL_PDF_EXTRACTION);

  it('has no newlines at all, which is the whole point of this fixture', () => {
    expect(REAL_PDF_EXTRACTION).not.toContain('\n');
  });

  it('reads every money figure from the single-line form', () => {
    expect(parsed.newBalance).toBe(8189.99);
    expect(parsed.interestSavingBalance).toBe(1451.88);
    expect(parsed.minimumPaymentDue).toBe(773.05);
    expect(parsed.totalPlansPaymentDue).toBe(198.83);
    expect(parsed.flexibleFinancingBalance).toBe(6738.11);
  });

  it('⚠️ FINDS THE PROMO — the case the reconstructed fixture said passed and did not', () => {
    expect(parsed.promoRates).toEqual([{ label: 'Equal Pay Promo', aprPercent: 0 }]);
  });

  it('⚠️ STILL DOES NOT MISTAKE THE ORDINARY APRs FOR PLANS, with no line breaks to help it', () => {
    // `Purchase APR 27.24%` sits on the same line as the promo now. Without the keyword requirement
    // a rate-hunting regex would take it, and tell somebody they have financing they do not have.
    expect(parsed.promoRates.map(p => p.aprPercent)).not.toContain(27.24);
  });

  it('produces the same patch the paste path produces', () => {
    expect(statementPatch(parsed)).toEqual(statementPatch(parseStatement(PRIME_VISA)));
  });
});
