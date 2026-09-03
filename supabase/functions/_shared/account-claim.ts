/**
 * Should a first sync ADOPT an account the user typed in by hand?
 *
 * THE DEFECT THIS EXISTS FOR. `persistAccount` matches an incoming provider
 * account on `plaid_account_id` alone. A card the user created by hand has none,
 * so the first sync after they link that bank INSERTS A SECOND ROW for a card
 * they already have. The debt is then counted twice, the hand-typed credit limit
 * becomes a phantom limit on a duplicate, and the manual fields and surplus rank
 * stay stranded on the original. Confirmed on Tre's own Robinhood card, ~$5,250
 * of phantom limit, and it hits any user who types a card in and later links it.
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION. Adopting the wrong row is worse than the
 * duplicate it prevents: it welds a provider account onto somebody's unrelated
 * record and there is no obvious way back. So the decision is made here, where
 * every branch is testable without a database, and `persistAccount` only obeys
 * the answer.
 *
 * THE RULE IS DELIBERATELY TIMID. It claims only when there is exactly ONE
 * unambiguous candidate. Anything else falls through to today's behaviour — a new
 * row — because a duplicate is visible and correctable by the user, while a wrong
 * adoption is silent.
 */

/** The shape the caller must select. Nothing here is provider data. */
export interface ClaimableAccount {
  id: string;
  account_type: string;
  institution: string | null;
  plaid_account_id: string | null;
  /** A card the user has not opened yet — a plan, not a holding. */
  card_start_date: string | null;
}

export type ClaimVerdict =
  | { claim: true; id: string; reason: string }
  | { claim: false; reason: string };

/** Institution names arrive punctuated and cased differently per provider. */
function sameInstitution(a: string | null, b: string | null): boolean {
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = norm(a), y = norm(b);
  return x.length > 0 && x === y;
}

/**
 * @param candidates every account the user already has, linked or not
 * @param incomingType the provider account's type
 * @param incomingInstitution the connection's institution name
 * @param today local `YYYY-MM-DD`, for the not-yet-open test
 */
export function chooseClaimCandidate(
  candidates: readonly ClaimableAccount[],
  incomingType: string,
  incomingInstitution: string | null,
  today: string,
): ClaimVerdict {
  // NEVER touch a row that already belongs to a provider account. Adopting one
  // would silently move a linked account onto a different provider identity.
  const unlinked = candidates.filter(c => c.plaid_account_id == null);
  if (unlinked.length === 0) return { claim: false, reason: 'no unlinked account to claim' };

  const matches = unlinked.filter(c =>
    c.account_type === incomingType && sameInstitution(c.institution, incomingInstitution));
  if (matches.length === 0) {
    return { claim: false, reason: 'no unlinked account of that type at that institution' };
  }

  // A card dated in the future is a PLAN — Tre's Venture X and Apple Card are
  // exactly this. Linking a bank must never weld a real account onto one.
  const open = matches.filter(c => !(c.card_start_date && c.card_start_date > today));
  if (open.length === 0) {
    return { claim: false, reason: 'the only match is a card that has not opened yet' };
  }

  if (open.length > 1) {
    // Two hand-made cards at one bank. Guessing here is how somebody's Freedom
    // becomes their Sapphire, so guess nothing.
    return { claim: false, reason: `${open.length} equally good matches, so no unambiguous claim` };
  }

  return {
    claim: true,
    id: open[0].id,
    reason: `exactly one unlinked ${incomingType} at that institution, not yet provider-linked`,
  };
}
