# Forgenta Security Review — 2026-05-23

**Reviewer:** Automated bi-daily security scan  
**Date:** 2026-05-23  
**Scope:** commits from 2026-05-22 to 2026-05-23 (27 commits)  
**Stack:** React/TypeScript, Supabase (project: mdtosrbfkextcaezuclh), Vercel, Capacitor (iOS/Android)

---

## Commits Reviewed

| Hash | Message |
|------|---------|
| `222e9b08` | [feat]: per-goal planned contributions panel |
| `fd206cba` | [feat]: lump sum transfers |
| `15f5f9b3` | [feat]: lump sum forecast integration + edit support |
| `ffbe8149` | [feat]: lump sum date preview + forecast integration |
| `b331f672` | [fix]: FormModal date inputs — colorScheme dark |
| `afb98b55` | [fix]: lump sum date picker — colorScheme dark |
| `36d6acff` | [feat]: budget control fixed/variable toggle + lump sum date picker fix |
| `c0e74f92` | [feat]: vehicle lump sum payments |
| `936aea90` | [feat]: forecast popup — show cash floor row per month |
| `afef1f70` | [fix]: CC engine — reserve revolving minimums |
| `1e7524c0` | [fix]: show end balance in purchase month for autopay cards |
| `c2006398` | [fix]: defer autopay CC payments by one billing cycle |
| `8442755a` | [feat]: remove Net Worth tab |
| `1892c84a` | [fix]: hide future CC from trajectory chart |
| `f97601f7` | [feat]: add Business Contributions category |
| `621cb6ae` | [feat]: forecast popup — per-rule investment/retirement transfer breakdown |
| `0188849e` | [fix]: forecast popup bottom section |
| `64419b7a` | [fix]: delay cover lift until Dashboard renders |
| `966fe9c3` | [fix]: disable idle session timeout on native |
| `360d7503` | [fix]: widen onStop() to public |
| `85c85f61` | [fix]: move hooks before early returns in BlackScreenDebug |
| `1a797148` | [fix]: apply bgReload lock-skip fix to Android |
| `131ffde6` | [feat]: gate debug panel to dev account with settings toggle |
| `e655d770` | [fix]: skip app lock on background/foreground cycles |
| `b2ceb99f` | [fix]: align Forecast debt sim with CC Engine |
| `0550988d` | [fix]: replace static monthly multipliers with real per-month occurrence counts |
| `699cb9e4` | [fix]: re-add launch cover; poll dashboard_ready on fresh start |

---

## Findings Table

| # | File | Line(s) | Severity | Category | Confidence |
|---|------|---------|----------|----------|-----------|
| 1 | `src/pages/Settings.tsx` | 386, 391–395 | **HIGH** | Credential Exposure / Broken Cleanup | 95% |
| 1 | `src/pages/Auth.tsx` | 148–149 | (same finding) | | |

---

## Detailed Findings

---

### FINDING-1 · HIGH · Credential Exposure

**Title:** Supabase refresh token written to localStorage under a key that cleanup never removes (prefix mismatch)

**Files:**
- `src/pages/Settings.tsx:386,391` (writes tokens)
- `src/pages/Auth.tsx:148-149` (attempts cleanup — wrong key)

**Description:**

When a user registers a sign-in passkey in Settings, the code stores the current Supabase `access_token` **and** `refresh_token` in `localStorage`:

```typescript
// Settings.tsx:388–395
const { data: sess } = await supabase.auth.getSession();
if (sess.session) {
  localStorage.setItem('forged:signin_passkey_tokens', JSON.stringify({
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
  }));
}
```

Auth.tsx contains a cleanup effect labelled "Clean up legacy auth localStorage keys":

```typescript
// Auth.tsx:147–150
useEffect(() => {
  localStorage.removeItem('forgenta:signin_passkey');       // ← "forgenta:"
  localStorage.removeItem('forgenta:signin_passkey_tokens'); // ← "forgenta:"
}, []);
```

The write uses key prefix **`forged:`** (7 chars).  
The cleanup targets prefix **`forgenta:`** (9 chars).

These are two distinct `localStorage` keys. The cleanup effect **never removes the written tokens**. The refresh token therefore persists in `localStorage` indefinitely — across browser restarts, tab closes, and session expirations — until the user manually clears site data.

There is no other code in the codebase that reads `forged:signin_passkey_tokens`. The stored value is never consumed: the passkey feature was simplified or the consumption path was removed, but the write was left behind. The tokens are orphaned live credentials with no expiry mechanism.

**Exploit Scenario:**

1. User visits Settings and taps "Register sign-in passkey."
2. Live Supabase `access_token` + `refresh_token` are written to `localStorage['forged:signin_passkey_tokens']`.
3. User navigates to `/auth` (e.g. on sign-out). Auth.tsx cleanup runs but targets `forgenta:signin_passkey_tokens` — **no match**, tokens remain.
4. The tokens sit in `localStorage` indefinitely.
5. **Attack vector A (browser extension):** Any installed browser extension with host permissions can call `localStorage.getItem('forged:signin_passkey_tokens')` and exfiltrate the refresh token.
6. **Attack vector B (shared/compromised device):** Anyone with DevTools access on the same browser profile can read the token.
7. Attacker calls `supabase.auth.setSession({ access_token, refresh_token })` with the stolen tokens and gains full authenticated access to the victim's account, including all financial data.

The refresh token is a long-lived rotating credential that survives the access token's 1-hour expiry. Possession of a valid refresh token is equivalent to account takeover until the user rotates their password or the token is revoked server-side.

**Fix Recommendation:**

**Immediate (fix the key mismatch):** Align the cleanup key with the write key in Auth.tsx:

```typescript
// Auth.tsx — fix the prefix to match what Settings.tsx writes
localStorage.removeItem('forged:signin_passkey');
localStorage.removeItem('forged:signin_passkey_tokens');
```

**Recommended (remove the storage entirely):** Since no code reads `forged:signin_passkey_tokens`, the entire block storing the session tokens should be deleted from `Settings.tsx:388–395`. The WebAuthn credential ID (`forged:signin_passkey`) is the only value needed client-side; session tokens must not be cached outside of the Supabase auth library's own managed storage.

```typescript
// Settings.tsx — REMOVE these lines (388–395):
// const { data: sess } = await supabase.auth.getSession();
// if (sess.session) {
//   localStorage.setItem('forged:signin_passkey_tokens', JSON.stringify({
//     access_token: sess.session.access_token,
//     refresh_token: sess.session.refresh_token,
//   }));
// }
```

**Cleanup for existing affected users:** Any user who has registered a passkey has these tokens sitting in their browser. The cleanup in Auth.tsx will not reach them. Consider running a one-time migration: on next page load, proactively remove both `forged:signin_passkey_tokens` and `forgenta:signin_passkey_tokens` from a root-level effect in `App.tsx`.

---

## What Was Reviewed and Found Clean

| Area | Files Checked | Result |
|------|--------------|--------|
| SQL injection | All Supabase queries in `useSupabaseData.ts` | Clean — parameterized via Supabase client, `sanitizePayload()` wrapper used on all mutations |
| Unauthenticated edge functions | `ai-advisor`, `plaid-sync`, `delete-account`, `stripe-webhook`, `reddit-scout` | Clean — JWT verification before data access; `reddit-scout` gated by shared `REDDIT_SCOUT_SECRET`; `stripe-webhook` gated by Stripe signature |
| XSS | All modified `.tsx` files | Clean — no `dangerouslySetInnerHTML` anywhere in codebase |
| Hardcoded secrets | All modified files | Clean — secrets consumed via `Deno.env` / `import.meta.env` only |
| Auth bypass | `AuthContext.tsx`, `Auth.tsx` | Clean — MFA challenge enforced server-side; idle timeout disabled on native (correct — PIN/biometric handles it) |
| Prompt injection (`ai-advisor`) | `supabase/functions/ai-advisor/index.ts` | Low risk — user question is their own data, length-capped at 500 chars, affect is limited to quality of advice returned to the same user |
| Prompt injection (`reddit-scout`) | `supabase/functions/reddit-scout/index.ts` | Low risk — draft replies are emailed to developer for manual review before any posting; no automated action taken on injected content |
| Stripe webhook CORS | `supabase/functions/stripe-webhook/index.ts` | Non-issue — wildcard CORS is moot for server-to-server Stripe webhooks; signature verification is the actual guard |
| PII in logs | All edge functions | Clean — user IDs logged only via `hashId()` tracer; no plaintext user data or tokens in log statements |
| iOS AppDelegate | `ios/App/App/AppDelegate.swift` | Clean — cover/lock logic; no credential handling |
| Android MainActivity | `android/app/src/main/java/com/treforged/forged/MainActivity.java` | Clean — lifecycle bridge only |
| Debug panel gating | `BlackScreenDebug.tsx`, `Settings.tsx` | Clean — gated to `tre@treforged.com` + native platform; `localStorage` flag is display-only, no privilege escalation |
| RLS in migrations | Recent car_funds / accounts migrations | Not in git diff (pre-existing); RLS audit deferred to dedicated migration review |

---

## Summary

**Status: ACTION REQUIRED**

One exploitable finding above the 80% confidence threshold:

| Priority | Action |
|----------|--------|
| P1 — Fix immediately | **Remove the session token write in `Settings.tsx:388-395`** (dead code — tokens are never consumed) |
| P1 — Fix immediately | **Fix the key mismatch in `Auth.tsx:148-149`** (`forgenta:` → `forged:`) so existing cleanup logic works |
| P1 — One-time migration | **Add a root-level `localStorage.removeItem('forged:signin_passkey_tokens')`** in `App.tsx` to purge tokens already written to existing users' browsers |

The rest of the changed surface area — financial calculations, forecast engine, CC engine fixes, native cover/lock lifecycle, debug gating — is free of exploitable security issues. Auth architecture (MFA, trusted devices, idle timeout, Stripe webhook verification, Plaid JWT auth) is sound.
