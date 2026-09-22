/**
 * IS THE AKOYA / FIDELITY FALLBACK OFFERED TO USERS?
 *
 * Tre, 2026-09-17: *"remove Connect Fidelity via Akoya btw since i never bought it. i cant even
 * do it sense its an expensive pay up front"*. This is that removal, done the reversible way.
 *
 * ── DISABLED, NOT DELETED, AND THE REASON IS NOT TIMIDITY ────────────────────────────────────
 * Deleting would touch 21 files, two deployed edge functions, a route every in-flight OAuth
 * redirect lands on, and two LEGAL sentences in `DeleteDataContent.tsx`. Turning the offer off
 * is one constant, it is undone by editing one word, and it achieves exactly what he asked for:
 * nobody is shown a Fidelity-via-Akoya option any more.
 *
 * ── WHAT WAS MEASURED FIRST, because the ask said not to skip to the fix ─────────────────────
 * The blocking question was what an Akoya route actually DOES for a user, and it is now
 * answered by probing the deployed function as a signed-in user (2026-09-22):
 *
 *     akoya-auth-url        HTTP 402  {"error":"Your free connected bank is already in use..."}
 *     akoya-exchange-token  HTTP 400  {"error":"code and state are required"}
 *     ai-advisor  (control) HTTP 403  premium_required   <- a real function answering
 *     zzz-no-such (control) HTTP 404  NOT_FOUND          <- the probe can tell absent from present
 *
 * 🚨 THE 402 IS THE FINDING, AND IT IS NOT THE ONE ANYONE EXPECTED. `akoya-auth-url` returns
 * **503 "Akoya not configured"** at line 73 — BEFORE the auth check and BEFORE the entitlement
 * gate — whenever `akoyaCredentials()` throws for a missing secret. The probe got past that to a
 * 402, so **the Akoya credentials ARE set in production**. "The route is dead because nothing is
 * configured" is ruled out, exactly as "nothing is deployed" was ruled out before it.
 *
 * ⚠️ AND WHAT IS STILL NOT MEASURED, stated rather than glossed: whether Akoya ACCEPTS those
 * credentials. This function only builds a URL locally and never calls Akoya, so the first real
 * test happens on Akoya's own page — which would mean driving a third-party OAuth flow, and that
 * was deliberately not done. Configured is not the same as working.
 *
 * ── THE DEAD-SCREEN RISK THE ASK NAMED IS RULED OUT BY MEASUREMENT ───────────────────────────
 * `AkoyaFallbackPrompt` renders only when Plaid reports an institution it cannot reach
 * (`institution` is null otherwise), and `BankConnectStep`'s primary control is `PlaidLinkButton`
 * either way. So switching this off leaves the onboarding bank step with its main action intact
 * rather than empty — which is the failure this repo has already paid for elsewhere.
 *
 * ── THE LEGAL TEXT IS DELIBERATELY LEFT ALONE ────────────────────────────────────────────────
 * `DeleteDataContent.tsx` says Akoya connections are revoked on deletion. That stays TRUE with
 * the offer switched off: any connection made before today is still revoked, and a promise to
 * revoke something that no longer exists costs the reader nothing. Narrowing a privacy promise
 * because a feature was disabled is the change that needs care, not this one.
 *
 * ── TO TURN IT BACK ON ───────────────────────────────────────────────────────────────────────
 * Set this to `true`. Nothing else was removed, so that is the whole undo.
 */
export const AKOYA_ENABLED = false;
