// §1B Stage 7A — MERCHANT MEMORY. Learn a merchant's category once, apply it forever. Pure, no I/O.
//
// THE COST THIS REMOVES. Amazon appears 89 times in 8 months of Tre's synced rows, 7-Eleven 26,
// Publix 21, Costco 20, CFX 12, Chewy 10. Every one of those is a category the user picks by hand,
// every time, and the answer is the same every time. The app already stores the answer — it just
// stores it against ONE CHARGE instead of against the merchant.
//
// ⚠️ THERE IS NO `merchant_rules` TABLE, AND THAT IS DELIBERATE RATHER THAN A SHORTCUT.
// `AGENT.md` forbids an unattended session from writing or applying a migration at all (free tier,
// no PITR, unrecoverable), so a new table was not available. But the better reading is that one was
// never needed: A MERCHANT RULE IS NOT NEW INFORMATION. It is the `category_override` the user
// already recorded, read back keyed on the merchant instead of on the charge. Deriving it means
//
//   - it is already cross-device and already backed up, because it lives in the same rows as the
//     decision itself;
//   - it cannot drift out of step with the charges that formed it — there is no second copy;
//   - "forget this merchant" is expressible (clear the overrides that formed it) rather than being
//     a second, contradicting record.
//
// The cost is that a rule cannot exist without at least one categorized charge, which is exactly
// what "learn a merchant ONCE" means anyway.
//
// ⚠️ THIS IS NOT THE MERCHANT-NAME HEURISTIC `plaid-category-map.ts` FORBIDS, and the difference is
// the whole reason this file is allowed to exist. That file's warning ("DO NOT improve this with
// merchant-name heuristics") is about GUESSING a category from a name — fuzzy scoring, token
// similarity, a lookup table of what "CHEWY" probably is. Nothing here guesses. The key is exact
// string equality after a documented normalization, and the category is one the user typed. A wrong
// answer here is the user's own previous answer, which is the one thing they can actually correct.
// §1A rejected fuzzy scoring for the same reason (`transaction-matching.ts:26-28`); this obeys it.

import { isValidCategory } from './plaid-category-map';
import type { Category } from './types';

/** The fields of a `synced_transactions` row merchant memory reads. */
export interface MerchantCharge {
  id: string;
  merchant_name?: string | null;
  name?: string | null;
}

/** The fields of a review row merchant memory reads. */
export interface MerchantReview {
  status: string;
  category_override?: string | null;
  /** ISO timestamp. Decides which of a merchant's conflicting decisions is the current one. */
  updated_at?: string | null;
}

/**
 * A trailing provider reference: `PPD ID: 4521893632`, `WEB ID: 2510020270`, `ID 88213`.
 *
 * ACH descriptors carry the originator's trace id in the name, and it is per-batch rather than
 * per-merchant, so `LOCKHEED MARTIN PAYROLL PPD ID: 4521893632` and the same payroll next month are
 * one merchant wearing two names. Anchored to the END so an id-shaped run in the middle of a real
 * name cannot eat it.
 */
const TRAILING_REFERENCE = /\s*\b(?:PPD|WEB|CCD|ARC|IAT|TEL|POS)?\s*ID:?\s*[0-9]+\s*$/i;

/**
 * A trailing bare reference token: `8557466304`, `0237`, `XXXX1234`, `#4821`, `*7781`.
 *
 * ⚠️ THREE OR MORE CHARACTERS, AND ONLY AS A WHOLE TRAILING TOKEN. Both bounds are load-bearing on
 * real rows: `7-Eleven` must survive (its digit is not a trailing token), and a two-character tail
 * is far more likely to be part of a name (`CIRCLE K 2`, `PHILLIPS 66`) than a reference number.
 */
const TRAILING_TOKEN = /\s+[#*xX]{0,4}[0-9][0-9#*xX-]{2,}\s*$/;

/**
 * The key a merchant's decision is remembered against.
 *
 * Returns null only when the row names no merchant at all — never an empty string, which would
 * collapse every unnamed charge onto one rule.
 *
 * ⚠️ NEVER RETURNS AN EMPTY KEY EVEN WHEN STRIPPING WOULD PRODUCE ONE. A merchant genuinely called
 * `76` or `7-11` would otherwise normalize away to nothing and then match every other nameless row.
 * Stripping is undone rather than allowed to empty the key.
 */
export function normalizeMerchant(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase().replace(/\s+/g, ' ');

  let key = upper;
  // Loop: `DISCOVER E-PAYMENT 0237 WEB ID: 2510020270` carries BOTH shapes, the ACH trace and the
  // card's last four, and one pass would leave the other behind.
  for (let i = 0; i < 4; i++) {
    const next = key.replace(TRAILING_REFERENCE, '').replace(TRAILING_TOKEN, '').trim();
    if (next === key) break;
    // A strip that empties the key is a strip that ate the name. Keep what we had.
    if (!next) break;
    key = next;
  }
  // Trailing separators left behind by a strip (`OPENPHONE -`) are not part of a name.
  key = key.replace(/[\s\-–—·,.:;#*]+$/, '').trim();
  return key || upper;
}

/** What a charge's merchant is called on screen. The raw name, not the key — keys are internal. */
export function merchantLabel(charge: MerchantCharge): string {
  return (charge.merchant_name || charge.name || '').trim();
}

/** One remembered decision: this merchant means this category. */
export interface MerchantRule {
  /** The normalized key. Exact equality is the whole matching rule. */
  key: string;
  /** The most recent raw name seen for this key, for display. */
  label: string;
  category: Category;
  /** ISO timestamp of the decision this rule reflects. */
  decidedAt: string | null;
  /** How many charges carry an explicit override for this merchant. */
  decidedCount: number;
  /**
   * How many of those disagree with `category`.
   *
   * Surfaced rather than hidden: a merchant the user has labeled two different ways is a merchant
   * where "learn once" is the wrong model (a Costco run can be Groceries or Shopping), and the
   * Settings list says so instead of quietly picking.
   */
  conflictingCount: number;
}

/** A decision on one charge, in the order the deriver consumes them. */
interface Decision {
  key: string;
  label: string;
  category: Category;
  at: string;
}

/**
 * The category the user recorded for a charge, or null.
 *
 * Read off the EXCLUSIVE row only — the same rule as everywhere else (Tre, 2026-08-09): a category
 * describes the CHARGE, and a link row may not carry one. Reading link rows here would let a stale
 * pre-2026-08-09 override on a link teach the wrong answer to every future charge of that merchant.
 */
function recordedCategory(reviews: readonly MerchantReview[]): { category: Category; at: string } | null {
  for (const r of reviews) {
    if (r.status === 'linked_rule' || r.status === 'linked_plan' || r.status === 'linked_car') continue;
    const value = r.category_override;
    if (value && isValidCategory(value)) return { category: value, at: r.updated_at ?? '' };
  }
  return null;
}

/**
 * Every merchant rule the user's own decisions imply.
 *
 * ⚠️ THE MOST RECENT DECISION WINS, not the most frequent, and that is what "learn a merchant once"
 * has to mean. A user who has called Costco `Groceries` five times and then deliberately changes one
 * to `Shopping` has just told the app something; letting the old majority outvote it would make the
 * correction look like it did not take, which is the exact failure this feature exists to remove.
 * The disagreement is not thrown away — `conflictingCount` carries it to Settings.
 *
 * Rows with no `updated_at` sort oldest, so a decision that carries a timestamp always beats one
 * that does not rather than depending on iteration order.
 */
export function deriveMerchantRules(
  charges: readonly MerchantCharge[],
  reviewsByCharge: Readonly<Record<string, readonly MerchantReview[]>>,
): Record<string, MerchantRule> {
  const decisions: Record<string, Decision[]> = {};
  for (const charge of charges) {
    const key = normalizeMerchant(merchantLabel(charge));
    if (!key) continue;
    const recorded = recordedCategory(reviewsByCharge[charge.id] ?? []);
    if (!recorded) continue;
    (decisions[key] ??= []).push({
      key,
      label: merchantLabel(charge),
      category: recorded.category,
      at: recorded.at,
    });
  }

  const rules: Record<string, MerchantRule> = {};
  for (const [key, list] of Object.entries(decisions)) {
    const sorted = list.slice().sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1));
    const latest = sorted[0];
    rules[key] = {
      key,
      label: latest.label || key,
      category: latest.category,
      decidedAt: latest.at || null,
      decidedCount: list.length,
      conflictingCount: list.filter(d => d.category !== latest.category).length,
    };
  }
  return rules;
}

/**
 * The rule that speaks for a charge, or null.
 *
 * `suppressed` is the user's "stop remembering this merchant" set. It is checked HERE rather than at
 * derivation so that Settings can still list a suppressed rule and offer to switch it back on — a
 * rule you cannot see is a rule you cannot undo.
 */
export function merchantRuleFor(
  charge: MerchantCharge,
  rules: Readonly<Record<string, MerchantRule>>,
  suppressed: Readonly<Record<string, true>> = {},
): MerchantRule | null {
  const key = normalizeMerchant(merchantLabel(charge));
  if (!key || suppressed[key]) return null;
  return rules[key] ?? null;
}

/** One charge the retroactive pass would label, and everything needed to put it back. */
export interface RetroWrite {
  chargeId: string;
  key: string;
  label: string;
  category: Category;
  /**
   * What the charge's category was before — always null today, because the pass only ever touches
   * charges that carry none. Recorded anyway so the undo restores state rather than assuming it.
   */
  previousCategory: string | null;
}

/** A whole retroactive pass: what it would write, and what it is about to tell the user. */
export interface RetroPass {
  writes: RetroWrite[];
  /** Merchants the pass touches, most charges first — the list the confirm step shows. */
  byMerchant: { key: string; label: string; category: Category; count: number }[];
}

/**
 * What applying every merchant rule to the un-categorized backlog would do.
 *
 * ⚠️ IT NEVER OVERWRITES A CATEGORY THE USER ALREADY SET, on any charge, for any reason. That is the
 * one rule that makes a bulk write over eight months of history safe to offer at all: every charge
 * it touches had no answer, so the worst case is a wrong label where there was previously none, and
 * the undo puts it back to none. A pass that could overwrite would be a pass that could destroy a
 * hand-made correction, and no single undo makes that acceptable.
 *
 * It also writes NOTHING to `public.transactions`. Like every other control on Bank Activity except
 * "Add to my ledger", this is an annotation: no projected number moves.
 *
 * DECIDED (Tre did not specify; recorded so it is not silently re-decided): the pass runs over the
 * WHOLE backlog rather than the current month. Leaving eight months uncategorized to avoid one bulk
 * action is the wrong trade — the backlog is the reason the feature exists — and the single undo is
 * what pays for it.
 */
export function planRetroactivePass(
  charges: readonly MerchantCharge[],
  reviewsByCharge: Readonly<Record<string, readonly MerchantReview[]>>,
  rules: Readonly<Record<string, MerchantRule>>,
  suppressed: Readonly<Record<string, true>> = {},
): RetroPass {
  const writes: RetroWrite[] = [];
  const counts = new Map<string, { key: string; label: string; category: Category; count: number }>();

  for (const charge of charges) {
    // Already answered — by hand or by an earlier pass. Never touched. See the header.
    if (recordedCategory(reviewsByCharge[charge.id] ?? [])) continue;
    const rule = merchantRuleFor(charge, rules, suppressed);
    if (!rule) continue;
    writes.push({
      chargeId: charge.id,
      key: rule.key,
      label: rule.label,
      category: rule.category,
      previousCategory: null,
    });
    const seen = counts.get(rule.key);
    if (seen) seen.count++;
    else counts.set(rule.key, { key: rule.key, label: rule.label, category: rule.category, count: 1 });
  }

  const byMerchant = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { writes, byMerchant };
}

/** One charge a rule edit in Settings would re-label, and what it said before. */
export interface MerchantRelabel {
  chargeId: string;
  previousCategory: Category;
}

/**
 * What changing a merchant's category in Settings would rewrite.
 *
 * ⚠️ ONLY CHARGES THAT ALREADY CARRY A CATEGORY, and that is the whole point of this function
 * existing rather than the caller looping. Editing a rule means "I labeled this merchant wrong";
 * it must not become a SECOND, unannounced bulk write over the un-categorized backlog, which has its
 * own panel, its own confirm and its own undo (`planRetroactivePass`). The guard that used to live
 * in the component tested the RULE rather than the CHARGE, so it was true on every iteration and
 * skipped nothing — the exact bulk write the split was written to prevent. Keeping the decision here
 * means a test can hold it.
 *
 * Charges already labeled with the target category are left out: a write that changes nothing is
 * still a write, and it inflates the count the user is shown.
 */
export function planMerchantRelabel(
  charges: readonly MerchantCharge[],
  reviewsByCharge: Readonly<Record<string, readonly MerchantReview[]>>,
  key: string,
  category: Category,
): MerchantRelabel[] {
  const out: MerchantRelabel[] = [];
  for (const charge of charges) {
    if (normalizeMerchant(merchantLabel(charge)) !== key) continue;
    const recorded = recordedCategory(reviewsByCharge[charge.id] ?? []);
    if (!recorded) continue;
    if (recorded.category === category) continue;
    out.push({ chargeId: charge.id, previousCategory: recorded.category });
  }
  return out;
}

/**
 * The writes that undo a pass, in the order they should be made.
 *
 * Reversed, so a partially-applied undo unwinds the most recent write first and the two halves of a
 * stopped batch never interleave. Each entry restores the charge's category to what it was —
 * `null` clears it, which is what `setCategory` does with a null category.
 */
export function planRetroactiveUndo(pass: RetroPass): { chargeId: string; category: string | null }[] {
  return pass.writes
    .slice()
    .reverse()
    .map(w => ({ chargeId: w.chargeId, category: w.previousCategory }));
}
