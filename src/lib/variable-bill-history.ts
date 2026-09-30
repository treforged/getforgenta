/**
 * Which past payments belong to which bill - the history `variable-bill-buffer.ts` sizes from.
 *
 * Tre, 2026-09-05: the floor should carry "an extra buffer based on historical payments", because
 * his electric bill came in near $190 against a much smaller plan (docs/dynamic-cash-floor.md s.3).
 *
 * -- THE DESIGN DECISION, SETTLED 2026-09-30, AND WHY -----------------------------------------------
 * History comes ONLY from the user's own `linked_rule` reviews ("this charge paid that rule"). Two
 * other matchers exist and both were rejected on their own documented terms:
 *   - `transaction-matching.ts` gates on AMOUNT, max($0.05, 1% of the rule). A $190 charge against a
 *     $120 plan can never match, so it is structurally blind to exactly the bills this is for.
 *   - `rule-drift.ts` attributes by merchant inside a 0.75x-2x band. Its own header says that band is
 *     safe for a QUESTION the user answers and dangerous for a number the engine acts on. The floor
 *     moves every payoff date, so it gets only evidence the user confirmed.
 * Measured on the live database that day: 101 linked_rule reviews over 21 rules and 4 users, and no
 * charge linked to more than one rule. Tre's Electricity rule has 4 linked payments.
 * Consequence stated plainly: a user who never links charges gets no buffer. That is the no-op the
 * design doc requires, not a gap.
 *
 * -- WHAT IS DELIBERATELY EXCLUDED ------------------------------------------------------------------
 *   - A charge SPLIT across several rules: no per-rule amount is stored, so crediting the whole
 *     charge to each rule would overstate every one of them. Dropped and counted.
 *   - Income rules and inactive rules. The paycheck and the "GF half of rent" rules ARE linked, and
 *     the second swings $100-$1,100. Counted in `notAnExpenseRule` so a drop is never silent.
 *   - Several charges for ONE occurrence (a bill paid in two parts) are SUMMED into one payment:
 *     by month for monthly-and-slower rules, by occurrence date for weekly and biweekly ones.
 *
 * Pure: no React, no database, no clock. `useFloorBufferedRules` is the only production caller.
 */
import {
  computeVariableBillBuffer,
  type BufferResult,
  type BillPayment,
} from './variable-bill-buffer';

/** User-defined rule snapshot. */
export interface HistoryRule {
  id: string;
  amount: number | string;
  rule_type: string;
  frequency: string;
  active: boolean;
  cost_type?: string | null;
}

/** Review linking a charge to a rule. */
export interface HistoryReview {
  status: string;
  rule_id: string | null;
  synced_transaction_id: string;
  occurrence_month: string | null;
  occurrence_date: string | null;
}

/** Charge representing a bank transaction. */
export interface HistoryCharge {
  id: string;
  amount: number | string;
  date: string;
}

/** Buffer result enriched with rule id and raw history. */
export interface RuleBufferEntry extends BufferResult {
  ruleId: string;
  history: BillPayment[];
}

/** Collection of per-rule buffers plus diagnostic drop counters. */
export interface VariableBillBuffers {
  byRuleId: Map<string, RuleBufferEntry>;
  dropped: {
    chargeNotFound: number;
    splitCharge: number;
    notAnExpenseRule: number;
  };
}

/**
 * Build buffers for a set of rules from reviews and charges.
 *
 * @param rules   All user rules (may contain inactive / income rules).
 * @param reviews All reviews; only those with status === 'linked_rule' and a
 *                non-null rule_id are considered.
 * @param charges All charges that may be referenced from reviews.
 *
 * @returns Buffers grouped by rule id and counters for dropped rows.
 */
export function buildVariableBillBuffers(
  rules: readonly HistoryRule[],
  reviews: readonly HistoryReview[],
  charges: readonly HistoryCharge[],
): VariableBillBuffers {
  const dropped = {
    chargeNotFound: 0,
    splitCharge: 0,
    notAnExpenseRule: 0,
  };

  // 1. Filter qualifying reviews.
  const qualifying = reviews.filter(
    (r) => r.status === 'linked_rule' && r.rule_id !== null,
  );

  // 2. Split guard.
  const syncCount = new Map<string, HistoryReview[]>();
  for (const rev of qualifying) {
    const arr = syncCount.get(rev.synced_transaction_id) ?? [];
    arr.push(rev);
    syncCount.set(rev.synced_transaction_id, arr);
  }
  const splitGuardIds = new Set(
    [...syncCount.entries()].filter(([, arr]) => arr.length > 1).map(([id]) => id),
  );

  // Prepare charge lookup.
  const chargeMap = new Map<string, HistoryCharge>();
  for (const c of charges) chargeMap.set(c.id, c);

  // Prepare rule lookup.
  const ruleMap = new Map<string, HistoryRule>();
  for (const r of rules) ruleMap.set(r.id, r);

  // Accumulate raw grouped payments per rule.
  type GroupKey = string;
  interface GroupAcc {
    sum: number;
    latestDate: string;
  }
  const perRuleGroups = new Map<string, Map<GroupKey, GroupAcc>>();

  for (const rev of qualifying) {
    if (splitGuardIds.has(rev.synced_transaction_id)) {
      dropped.splitCharge += 1;
      continue;
    }

    const rule = rev.rule_id ? ruleMap.get(rev.rule_id) : undefined;
    if (!rule || !rule.active || rule.rule_type === 'income') {
      dropped.notAnExpenseRule += 1;
      continue;
    }

    const charge = chargeMap.get(rev.synced_transaction_id);
    if (!charge) {
      dropped.chargeNotFound += 1;
      continue;
    }

    const amount = Number(charge.amount);
    const frequency = rule.frequency.toLowerCase();

    // Determine grouping key.
    let key: string;
    if (frequency === 'weekly' || frequency === 'biweekly') {
      key = rev.occurrence_date ?? charge.date;
    } else {
      key = rev.occurrence_month ?? charge.date.slice(0, 7);
    }

    const groups = perRuleGroups.get(rule.id) ?? new Map<GroupKey, GroupAcc>();
    const existing = groups.get(key);
    const newAcc: GroupAcc = existing
      ? {
          sum: existing.sum + amount,
          latestDate: charge.date > existing.latestDate ? charge.date : existing.latestDate,
        }
      : { sum: amount, latestDate: charge.date };
    groups.set(key, newAcc);
    perRuleGroups.set(rule.id, groups);
  }

  // Build buffers.
  const byRuleId = new Map<string, RuleBufferEntry>();
  for (const [ruleId, groups] of perRuleGroups.entries()) {
    const history: BillPayment[] = [];
    for (const acc of groups.values()) {
      const rounded = Math.round(acc.sum * 100) / 100;
      history.push({ date: acc.latestDate, amount: rounded });
    }
    // Sort ascending by date.
    const sortedHistory = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const rule = ruleMap.get(ruleId)!;
    const costTypeRaw = rule.cost_type;
    const costType =
      costTypeRaw === 'fixed' || costTypeRaw === 'variable' ? costTypeRaw : null;

    const result = computeVariableBillBuffer({
      plannedAmount: Number(rule.amount),
      history: sortedHistory,
      costType,
    });

    const entry: RuleBufferEntry = {
      ruleId,
      history: sortedHistory,
      ...result,
    };
    byRuleId.set(ruleId, entry);
  }

  return { byRuleId, dropped };
}

/**
/** 
 * Adds floor buffers to rules where applicable.
 *
 * Returns the original `rules` array reference if no rule has a positive buffer.
 * Otherwise returns a new array where each rule with a positive buffer is
 * replaced by a shallow copy that includes a `floor_buffer` field.
 *
 * The function never mutates its inputs.
 */
export function applyFloorBuffers<T extends { id: string }>(
  rules: readonly T[],
  buffers: VariableBillBuffers,
): T[] | readonly T[] {
  // Determine if any rule has a buffer > 0.
  let hasPositive = false;
  for (const entry of buffers.byRuleId.values()) {
    if (entry.buffer > 0) {
      hasPositive = true;
      break;
    }
  }

  // No positive buffers -> return original reference.
  if (!hasPositive) {
    return rules;
  }

  // Build a new array, copying only the rules that need a floor_buffer.
  const result = rules.map((rule) => {
    const entry = buffers.byRuleId.get(rule.id);
    if (entry && entry.buffer > 0) {
      // Shallow copy with added field.
      return { ...rule, floor_buffer: entry.buffer } as T;
    }
    // Return original object unchanged.
    return rule;
  });

  return result;
}
