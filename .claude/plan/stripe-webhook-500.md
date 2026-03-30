# Investigation: stripe-webhook returning 500 on every POST

## Findings

### CRITICAL — stripe-webhook: 5/5 POST requests return 500

**Evidence from logs:**
- All 5 Stripe delivery attempts to `stripe-webhook` v2 returned HTTP 500
- No successful deliveries have ever occurred at this version
- Execution times: 145ms, 255ms, 468ms, 561ms, 577ms
- `verify_jwt: false` is already set correctly (deployed with `--no-verify-jwt`)

**Root cause — one of two possibilities (cannot distinguish without dashboard access):**

#### Possibility A: STRIPE_WEBHOOK_SECRET not set in Supabase secrets (most likely for 145ms failure)
```
// Line 19-20 in stripe-webhook/index.ts
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET not configured");
```
Early throw → 500. The 145ms request is consistent with this (no crypto ops needed).

#### Possibility B: STRIPE_WEBHOOK_SECRET set but wrong value
```
// Line 27 in stripe-webhook/index.ts
const event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
```
If the value doesn't match the Stripe Dashboard signing secret for this endpoint,
`constructEvent` throws a `StripeSignatureVerificationError` → caught → 500.
The 468ms–577ms requests are consistent with this (HMAC verification happens first).

---

### INFO — Code logic is correct

The `checkout.session.completed` handler (lines 49-69) correctly:
- Extracts `metadata.supabase_user_id` from the session
- Retrieves the subscription via Stripe SDK
- Upserts `plan='premium'`, `subscription_status`, `stripe_subscription_id`,
  `stripe_customer_id` to `user_subscriptions` with SERVICE_ROLE_KEY client

No code changes are needed if the secret is correct.

### INFO — Webhook URL is registered and reachable

Stripe IS delivering to the function — requests are arriving and getting 500 responses.
The URL `https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/stripe-webhook` is registered.

### INFO — Function already deployed with verify_jwt: false

`stripe-webhook` is already at `verify_jwt: false`. No re-deploy needed for that flag alone.

---

## Required Manual Action (cannot be automated)

You must verify the `STRIPE_WEBHOOK_SECRET` in Supabase:

1. Go to **Stripe Dashboard → Developers → Webhooks**
2. Click the webhook endpoint for `https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/stripe-webhook`
3. Click **Reveal** next to "Signing secret" — copy the value (starts with `whsec_`)
4. Go to **Supabase Dashboard → Edge Functions → stripe-webhook → Secrets**
   (or Project Settings → Edge Functions → Secrets)
5. Check if `STRIPE_WEBHOOK_SECRET` exists and matches the value from step 3
6. If missing or wrong: set/update it to the correct `whsec_...` value

---

## Fix Plan (after secret is confirmed)

If secret was missing or wrong → redeploy is NOT strictly required (secrets take effect
immediately on next invocation). But redeploy is recommended to get a fresh cold start:

```bash
npx supabase functions deploy stripe-webhook \
  --project-ref mdtosrbfkextcaezuclh \
  --no-verify-jwt
```

No code changes needed.

---

## Severity Summary

| Finding | Severity | Action |
|---------|----------|--------|
| stripe-webhook 500 on all requests | CRITICAL | Fix STRIPE_WEBHOOK_SECRET secret |
| Premium never activates after checkout | CRITICAL | Consequence of above |
| Code logic for checkout.session.completed | OK | No changes needed |
| verify_jwt: false already set | OK | No changes needed |

---

## SESSION_ID
- CODEX_SESSION: N/A (direct investigation, no model calls needed)
- GEMINI_SESSION: N/A
