# Implementation Plan: stripe-promo-codes

## Audit Report — All Findings

### Finding 1 — MEDIUM | Custom coupon UI in `Premium.tsx`
**Location:** `src/pages/Premium.tsx` — lines 14–15, 25, 30–34, 38–39, 121–135

The Premium upgrade page renders a freeform text input for coupon codes. The
`handleCheckout` function reads the `couponCode` state and sends it as `coupon_code`
to the `create-checkout` Edge Function. If the function returns `{ granted: true }`,
the client immediately redirects to `/premium/success?coupon=1`, bypassing Stripe
entirely.

**Proposed fix:** Remove `couponCode`/`couponError` state variables, remove the
`coupon_code` field from the `create-checkout` body, remove the `data?.granted`
branch and the coupon error branch in `handleCheckout`, and delete the coupon input
+ error paragraph from the JSX.

---

### Finding 2 — HIGH | `create-checkout` grants premium without a Stripe subscription
**Location:** `supabase/functions/create-checkout/index.ts` — lines 48–95

When `coupon_code` is present and valid, the function skips Stripe completely and
writes `plan='premium', subscription_status='active'` directly to `user_subscriptions`.
The user gets no `stripe_subscription_id`, so:
- The billing portal has nothing to manage for them.
- There is no subscription lifecycle: no renewal, no expiry, no cancellation webhook.
- Subscription stays permanently `active` with no Stripe backing.

**Proposed fix:** Delete the entire `if (coupon_code) { ... }` block (lines 48–95).
Add `allow_promotion_codes: "true"` to the Stripe Checkout session params so users
can enter Stripe-native promotion codes inside the hosted Checkout UI. These always
produce a real `stripe_subscription_id`, so the webhook flow handles them identically
to a full-price purchase.

---

### Finding 3 — LOW | `VALID_COUPON_CODES` env var becomes obsolete
**Location:** `supabase/functions/create-checkout/index.ts` — line 49

After removing Finding 2's block, `Deno.env.get("VALID_COUPON_CODES")` is no longer
referenced. The env var itself still lives in Supabase Edge Function secrets.

**Proposed fix (code):** None — the reference is deleted as part of Finding 2's fix.
**Manual step:** Remove `VALID_COUPON_CODES` from Supabase Edge Function secrets
(Dashboard → Edge Functions → create-checkout → Secrets) to avoid confusion.

---

### Finding 4 — LOW | Dead `isCoupon` path in `PremiumSuccess.tsx`
**Location:** `src/pages/PremiumSuccess.tsx` — lines 13, 17–20

`const isCoupon = searchParams.get('coupon') === '1'` and the early-return block
that handles it (`if (isCoupon) { refetch().then(...) }`) exist only to support the
`/premium/success?coupon=1` redirect that Finding 1 removes. After that redirect is
gone, this code is unreachable.

**Proposed fix:** Remove the `isCoupon` const and the `if (isCoupon)` block. All
success flows — paid and discounted — land via Stripe's `success_url` with
`?session_id={CHECKOUT_SESSION_ID}`, and the existing polling loop handles them
correctly.

---

### Finding 5 — INFO | `return_url` in checkout body (no action required)
**Location:** `src/pages/Premium.tsx:25` / `supabase/functions/create-checkout/index.ts:44–45`

The client sends `return_url: window.location.origin` in the POST body, and the
function uses it to build Stripe's `success_url` and `cancel_url`. This is not a
security problem for checkout (the portal open-redirect was already fixed separately).
No change needed.

---

### Old custom coupon path after fixes
**None remaining.** Findings 1, 2, and 4 together remove every trace of the custom
path: the UI input, the Edge Function validation + direct grant, and the
`?coupon=1` success handler.

---

## Task Type
- [x] Fullstack — frontend (Premium.tsx, PremiumSuccess.tsx) + backend (create-checkout)

---

## Technical Solution

1. Add `allow_promotion_codes: "true"` to the Stripe Checkout session creation in
   `create-checkout`. This renders a "Promotion code" field natively inside the
   hosted Checkout UI — no app-side input required.

2. Remove the `if (coupon_code)` block from `create-checkout` entirely. The
   `coupon_code` field also disappears from the body destructure.

3. Strip the coupon input + state from `Premium.tsx`. The checkout handler becomes a
   simple "get session → invoke create-checkout → redirect to Stripe URL" flow.

4. Clean up `PremiumSuccess.tsx` by removing the unreachable `isCoupon` branch.

No database schema changes. No webhook changes. No `useSubscription` changes.
No `PremiumGate` changes. Demo mode is untouched.

---

## Implementation Steps

### Step 1 — Backup originals
Create `./backups/YYYY-MM-DD_HHMMSS/` copies of:
- `src/pages/Premium.tsx`
- `src/pages/PremiumSuccess.tsx`
- `supabase/functions/create-checkout/index.ts`

### Step 2 — `create-checkout/index.ts`
1. Change body destructure: `const { return_url } = await req.json();` (drop `coupon_code`).
2. Delete the entire `if (coupon_code) { ... }` block (Finding 2).
3. Add `allow_promotion_codes: "true"` to the `URLSearchParams` body of the
   Checkout session creation fetch call, alongside the existing fields.

Pseudo-code after change:
```ts
const { return_url } = await req.json();
// ... (customer lookup/create unchanged) ...
body: new URLSearchParams({
  customer: customerId,
  "line_items[0][price]": "price_1TCZWP2cDVgFonAbtUAJHskT",
  "line_items[0][quantity]": "1",
  mode: "subscription",
  allow_promotion_codes: "true",          // ← new
  success_url: `${origin}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin}/premium/cancel`,
  "metadata[supabase_user_id]": userId,
})
```

### Step 3 — `Premium.tsx`
1. Remove state: `couponCode`, `couponError` and their `useState` calls.
2. In `handleCheckout`: remove `setCouponError('')`, remove `coupon_code` from body,
   remove `if (data?.granted)` block, remove `if (couponCode && ...)` error branch.
3. Remove JSX: the `<div className="space-y-1">` block containing the coupon `<input>`
   and the `{couponError && ...}` paragraph.

### Step 4 — `PremiumSuccess.tsx`
1. Remove `const isCoupon = searchParams.get('coupon') === '1';`
2. Remove the `if (isCoupon) { ... return; }` block.
3. The `useSearchParams` import remains (still used for `sessionId`).

### Step 5 — Deploy & manual cleanup
- Redeploy `create-checkout` Edge Function via Supabase dashboard.
- Remove `VALID_COUPON_CODES` from Edge Function secrets.
- Create Stripe promotion codes in Stripe Dashboard (Promotions → Coupons →
  Promotion codes) so discount codes can be redeemed inside Checkout.

### Step 6 — Commit locally
```
[feat]: replace custom coupon flow with Stripe-native promotion codes

- create-checkout: remove custom VALID_COUPON_CODES validation block; add
  allow_promotion_codes to Stripe Checkout session so promo codes are
  entered inside the hosted Checkout UI
- Premium.tsx: remove coupon input, couponCode/couponError state, and
  granted-response handler
- PremiumSuccess.tsx: remove dead isCoupon branch (?coupon=1 redirect is gone)
```

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `src/pages/Premium.tsx` | Modify | Remove coupon input, state, granted handler |
| `src/pages/PremiumSuccess.tsx` | Modify | Remove isCoupon dead-code branch |
| `supabase/functions/create-checkout/index.ts` | Modify | Remove coupon block; add allow_promotion_codes |

---

## Subscription Flow Verification (Task 2 checklist)

| Invariant | Status after change |
|-----------|---------------------|
| Webhook is sole writer of subscription state | ✅ Unchanged |
| PremiumSuccess polls until Stripe-verified | ✅ Unchanged (isCoupon dead branch removed, main poll intact) |
| Billing portal via Stripe | ✅ Unchanged |
| Real non-subscribed users hit paywall | ✅ `useSubscription` + `PremiumGate` unchanged |
| No client-writable premium state | ✅ Direct-grant coupon path removed |
| Demo mode unchanged | ✅ `isDemo` logic untouched |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| Existing coupon-granted users (no stripe_subscription_id) lose access | These users have `subscription_status='active'` and `plan='premium'` set directly — they remain premium until an admin manually resets their row or they cancel. No change in their experience from this PR. |
| Stripe promotion code not created before deployment | Deploy code first; create promo codes in Stripe dashboard before sharing discount codes with users. Stripe Checkout shows the promo field but simply ignores bad codes gracefully. |
| `VALID_COUPON_CODES` not yet removed from secrets | Harmless — the code that reads it is gone. Remove at convenience. |

---

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A (plan derived from direct codebase analysis)
- GEMINI_SESSION: N/A
