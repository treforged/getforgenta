/**
 * Pointing existing Plaid items at plaid-webhook: the rules, kept pure so every branch is tested.
 *
 * WHY. A webhook URL is set on an item when it is created (link token `webhook`). Items linked
 * before plaid-webhook existed have none, so Plaid never tells us about their new transactions.
 * /item/webhook/update fixes that per item. It touches real users' Plaid items, so:
 *
 * - DRY RUN IS THE DEFAULT. Only `apply: true` (the boolean, not the string) writes anything.
 * - APPLY NEEDS AN EXPLICIT SCOPE: `item_ids` or `all: true`. An apply with neither is refused,
 *   never widened to "all". Widening would turn a one-item test into a change for every user.
 * - A MISSING SECRET NEVER AUTHORISES. An unset CRON_SECRET compares false to everything,
 *   including the empty string.
 *
 * Pure module - no imports - so vitest can load it. The edge function does the I/O.
 */

export const PLAID_WEBHOOK_PATH = "/functions/v1/plaid-webhook";

export function plaidWebhookUrl(supabaseUrl: string): string {
  if (!supabaseUrl.startsWith("https://")) throw new Error("supabaseUrl must be https");
  return supabaseUrl.replace(/\/+$/, "") + PLAID_WEBHOOK_PATH;
}

export function cronSecretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  if (given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export type RegisterRequest = { apply: boolean; itemIds: string[] | "all" };

export function parseRegisterRequest(
  body: unknown,
): { ok: true; req: RegisterRequest } | { ok: false; error: string } {
  const b = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const apply = b.apply === true;
  const all = b.all === true;

  let itemIds: string[] | null = null;
  if (b.item_ids !== undefined) {
    const raw = b.item_ids;
    if (!Array.isArray(raw) || raw.length === 0 || raw.some((id) => typeof id !== "string" || id === "")) {
      return { ok: false, error: "item_ids must be a non-empty array of strings" };
    }
    itemIds = [...new Set(raw as string[])];
  }

  if (itemIds && all) return { ok: false, error: "give item_ids or all, not both" };
  if (apply && !itemIds && !all) return { ok: false, error: "apply needs item_ids or all:true" };
  return { ok: true, req: { apply, itemIds: itemIds ?? "all" } };
}

export type Candidate = { connection_id: string; user_id: string; item_id: string; connection_status: string };

export function selectTargets(
  candidates: readonly Candidate[],
  req: RegisterRequest,
): { targets: Candidate[]; missing: string[] } {
  if (req.itemIds === "all") return { targets: [...candidates], missing: [] };
  const byItem = new Map(candidates.map((c) => [c.item_id, c]));
  const targets: Candidate[] = [];
  const missing: string[] = [];
  for (const id of req.itemIds) {
    const hit = byItem.get(id);
    if (hit) targets.push(hit);
    else missing.push(id);
  }
  return { targets, missing };
}

export type ItemOutcome = {
  item_id: string;
  before: string | null;
  after: string | null;
  changed: boolean;
  error: string | null;
};

export function needsUpdate(before: string | null, target: string): boolean {
  return before !== target;
}
