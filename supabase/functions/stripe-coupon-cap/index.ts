/**
 * stripe-coupon-cap — ADMIN ONLY, guarded by x-cron-secret (same guard as the cron jobs).
 *
 * WHY (ask 49d21f71, Tre 2026-10-07): the 100%-off-forever coupon 8G9evoSQ is meant for its
 * current holders. Tre: "limit the code to 20 uses. so 14 left" - the code FRIENDSFOREVER26 had 6. Stripe cannot edit a coupon's
 * or a promotion code's max_redemptions after creation, so the cap is applied by REPLACING the
 * customer-facing promotion code: the old one is deactivated and a new one with the SAME code
 * string, on the SAME coupon, is created with max_redemptions = total - that code's redemptions.
 * Existing subscriptions keep their discount, because a discount references the COUPON, never
 * the promotion code - no subscription is read for writing, let alone changed.
 *
 *   { "action": "read" }                       -> coupon, its promotion codes, subscription counts
 *   { "action": "cap", "total": 20 }           -> PLAN only (what it would do), writes nothing
 *   { "action": "cap", "total": 20, "confirm": true } -> does it, then reads everything back
 *
 * Refuses any coupon but 8G9evoSQ. Returns ids, counts and statuses only - no customer names or
 * emails. Undo: reactivate the old promotion code and deactivate the new one (both ids returned).
 */
import Stripe from "https://esm.sh/stripe@22.1.1";
import { cronSecretMatches } from "../_shared/plaid-webhook-register.ts";

const COUPON_ID = "8G9evoSQ";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json" } });

async function snapshot(stripe: Stripe) {
  const coupon = await stripe.coupons.retrieve(COUPON_ID);
  const promos = await stripe.promotionCodes.list({ limit: 100 });
  const ours = promos.data.filter((p) => {
    const c = (p as unknown as { coupon?: string | { id: string }; promotion?: { coupon?: string | { id: string } } });
    const ref = c.coupon ?? c.promotion?.coupon;
    return (typeof ref === "string" ? ref : ref?.id) === COUPON_ID;
  });
  // Subscriptions carrying the coupon, by status. Counted only; nothing about the customer is returned.
  const byStatus: Record<string, number> = {};
  const subIds: string[] = [];
  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.discounts"] })) {
    const ds = (sub as unknown as { discounts?: Array<string | { coupon?: { id: string }; source?: { coupon?: string | { id: string } } }> }).discounts ?? [];
    const hit = ds.some((d) => {
      if (typeof d === "string") return false;
      const ref = d.coupon?.id ?? (typeof d.source?.coupon === "string" ? d.source.coupon : d.source?.coupon?.id);
      return ref === COUPON_ID;
    });
    if (hit) { byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1; subIds.push(sub.id); }
  }
  return {
    coupon: {
      id: coupon.id, percent_off: coupon.percent_off, duration: coupon.duration, valid: coupon.valid,
      max_redemptions: coupon.max_redemptions, times_redeemed: coupon.times_redeemed,
    },
    promotion_codes: ours.map((p) => ({
      id: p.id, code: p.code, active: p.active, max_redemptions: p.max_redemptions, times_redeemed: p.times_redeemed,
    })),
    subscriptions_with_coupon: { by_status: byStatus, ids: subIds },
  };
}

Deno.serve(async (req) => {
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return json(403, { error: "Forbidden" });
  }
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return json(500, { error: "STRIPE_SECRET_KEY not configured" });
  // Same pinned API version as grant-promo-premium, the live Stripe caller this mirrors.
  const stripe = new Stripe(key, { apiVersion: "2026-02-25.clover" as unknown as "2026-04-22.dahlia" });

  let body: { action?: string; total?: number; confirm?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body = read */ }
  const action = body.action ?? "read";

  try {
    const before = await snapshot(stripe);
    if (action === "read") return json(200, before);
    if (action !== "cap") return json(400, { error: "action must be read or cap" });

    const total = body.total;
    if (!Number.isInteger(total) || (total as number) < 1 || (total as number) > 1000) {
      return json(400, { error: "total must be an integer 1..1000" });
    }
    const active = before.promotion_codes.filter((p) => p.active);
    if (active.length !== 1) {
      return json(409, { error: `expected exactly 1 active promotion code on ${COUPON_ID}, found ${active.length}; refusing to guess`, before });
    }
    const old = active[0];
    // Counted per CODE, in Tre's own arithmetic: "limit the code to 20 uses. so 14 left" = 20 - the code's 6.
    const remaining = (total as number) - old.times_redeemed;
    if (remaining < 1) return json(409, { error: `${old.code} already redeemed ${old.times_redeemed} times; nothing left under ${total}`, before });
    const plan = { deactivate: old.id, create: { code: old.code, coupon: COUPON_ID, max_redemptions: remaining } };
    if (body.confirm !== true) return json(200, { dry_run: true, plan, before });

    await stripe.promotionCodes.update(old.id, { active: false });
    let created: Stripe.PromotionCode;
    try {
      created = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: COUPON_ID },
        code: old.code,
        max_redemptions: remaining,
      } as unknown as Stripe.PromotionCodeCreateParams);
    } catch (e) {
      // Put the old code back so the customer-facing code never silently stops working.
      await stripe.promotionCodes.update(old.id, { active: true });
      return json(502, { error: `create failed, old code reactivated: ${(e as Error).message}`, plan });
    }
    const after = await snapshot(stripe);
    return json(200, { dry_run: false, plan, new_promotion_code: created.id, undo: { reactivate: old.id, deactivate: created.id }, before, after });
  } catch (e) {
    console.error("[stripe-coupon-cap]", e);
    return json(500, { error: (e as Error).message });
  }
});
