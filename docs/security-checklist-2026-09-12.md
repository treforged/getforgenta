# Five claimed Next.js + Supabase vulnerabilities, run against Forgenta

2026-09-12. Otto relayed five checks from a creator's reel. **They arrived as one
person's claims, not as measurements**, so each was run against this tree and the
result recorded either way. Otto did not run them himself because this is not his
repo — correct, and the reason the evidence below is first-hand.

**All five pass.** That is the finding, and it is only worth anything because each is
stated with what was actually done rather than "reviewed, clean".

⚠️ **One framing correction before the results: Forgenta is Vite + React, not
Next.js.** Three of the five are framework-agnostic (keys in the bundle, RLS,
sign-out scope). Two are phrased around Next's server actions and route handlers and
were re-aimed at the equivalent surface here — Supabase Edge Functions — rather than
being marked "not applicable", which would have skipped the real risk.

---

## 1. Service-role key in the frontend bundle — PASS

**How it was checked.** A scanner over all 251 files of `dist/`. The discriminating
test is NOT "is there a credential-shaped string" — the publishable key is *supposed*
to be there. It decodes every JWT it finds and reads the `role` claim, and separately
matches new-format Supabase key VALUES.

```
scanned 251 files under dist
distinct JWTs found: 0
publishable key occurrences: 2 (expected, belongs in a client bundle)
RESULT: no non-anon credential in the bundle.   exit 0
```

⚠️ **I nearly published a critical finding that does not exist.** A plain
`grep -rIl "sb_secret_" dist/` returns **2 files**. Opening the lines shows both are
supabase-js's own prefix-detection literal and its source map:

```js
const isNewApiKey = (key) => key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
```

A prefix is not a key. The scanner therefore requires **≥ 20 key characters after the
prefix**, so the library's literal cannot trip it. *A grep that matches prose is not
evidence about data* — and here the "prose" was code.

**Proven able to fail, with both controls in one file:** a planted
`sb_secret_AbCdEfGh01234567890xyzQW` is caught (1 problem, exit 1) while the library
literal in the same file is correctly ignored, and a publishable key is counted as
expected. A scanner that has never gone red proves nothing.

**Also checked and absent:** Stripe `sk_live/sk_test`, AWS `AKIA…`, PEM private-key
blocks, `plaid_secret`. And `grep -rn "SERVICE_ROLE" src/` returns nothing.

**Limit:** this scans the `dist/` on disk, built 2026-09-11T15:15Z. It is evidence
about that artefact, not a standing guarantee about every future build.

## 2. User id taken from the REQUEST instead of the session — PASS

**How it was checked.** Every edge function searched for a user id sourced from a
request body, query or params. Exactly **one** hit:

```
supabase/functions/grant-promo-premium/index.ts:71   const userId = body.user_id;
```

That is a function which grants a free year of Premium, so if it were callable by
anyone it would be a privilege escalation worth stopping everything for. It is not.
The bearer token must equal `SUPABASE_SERVICE_ROLE_KEY` and is checked **before the
body is parsed**. Taking the id from the body is the point: an admin names the
grantee, and there is no session to read it from because the caller is the admin, not
the recipient.

**Proven live rather than read:**

```
POST /functions/v1/grant-promo-premium  Bearer <publishable key>  ->  HTTP 401 {"error":"Unauthorized"}
POST /functions/v1/grant-promo-premium  Bearer not-a-real-key     ->  HTTP 401 {"error":"Unauthorized"}
```

**Minor note, not a finding:** the comparison is a plain `!==` against a
high-entropy secret over TLS behind a rate-limited gateway. Timing analysis is not a
practical route here; recorded so the next reader does not have to re-reason it.

## 3. RLS switched off on a table — PASS

**Zero tables in `public` have RLS disabled.** Every one reads
`relrowsecurity = true`.

Fifteen tables have RLS enabled and **no policies**, which is the configuration that
looks alarming and is the safe one: no policy means no row is visible to
`anon`/`authenticated`, and the edge functions that own those tables use the service
role, which bypasses RLS by design. Fail-closed, not fail-open.

**Verified end to end as an anonymous caller** with the publishable key, rather than
inferred from the catalogue:

```
free_bank_link_grants  ->  42501 permission denied for table
oauth_states           ->  42501 permission denied for table
rate_limits            ->  42501 permission denied for table
accounts               ->  42501 permission denied for table
expenses               ->  []
profiles               ->  []
```

Four are denied at the GRANT level, before RLS is even consulted; two return an empty
set. No row leaks to an anonymous caller from any of them.

⚠️ **WHAT THIS DOES NOT PROVE, and the distinction matters.** It shows an
*anonymous* caller reads nothing. It says nothing about whether one *authenticated*
user can read another's rows — that needs two real accounts and is a different test.
"Not leaking to anon" and "correctly isolated between users" are two claims, and only
the first is measured here.

## 4. Cookie-only sign-out leaving the server session alive — PASS

Forgenta does not use cookies for auth at all; the session lives in `localStorage`.
The question that matters is whether sign-out revokes the refresh token **server
side**, and the answer turns on the default `scope`.

**Read from the vendored library rather than from memory**
(`node_modules/@supabase/auth-js/.../GoTrueClient.js`):

```js
async signOut(options = { scope: 'global' }) {
async _signOut({ scope } = { scope: 'global' }) {
```

So a bare `signOut()` is a GLOBAL revoke. The UI path
(`signOutWithBroadcast`, `AuthContext.tsx:431`) uses that default, and
`Settings.tsx:356` passes `scope: 'global'` explicitly. The single `scope: 'local'`
call is `ResumeRecovery.tsx:85`, a deliberate recovery path that must not kill a
session on other devices.

**And this repo already hardened the failure mode the reel does not mention:**
`AuthContext.tsx:412` records that Supabase can REFUSE the logout and used to do so
silently — `/logout` fails, `_signOut` returns before `_removeSession`, nothing emits
`SIGNED_OUT`. The error is now captured and acted on.

## 5. Login errors distinguishing wrong-email from wrong-password — PASS

`signInWithPassword` (`Auth.tsx:445`) throws Supabase's own error, surfaced at
`Auth.tsx:501`. Supabase returns **"Invalid login credentials"** for both a
non-existent email and a wrong password, so the password path is a single generic
message and discloses nothing.

**The one message that names an account is not an enumeration oracle.**
`Auth.tsx:376` says *"An account already exists with this email"*, and it fires only
in the OAuth catch block, only when Supabase itself returned "already registered".
Reaching it requires completing a Google or Apple sign-in **for that address** — i.e.
proving control of the mailbox. An attacker who can do that already knows the answer.

---

## Standing limits of this pass

- It is a point-in-time check of the tree and the `dist/` of 2026-09-11T15:15Z.
- It does not cover authenticated cross-user isolation (§3), which needs two accounts.
- No client trace, no penetration testing, and no review of the Stripe or Plaid
  webhooks' signature verification — those were out of the five and are not claimed.
- The bundle scanner lives in a scratchpad, not in the repo, so **it does not run on
  future builds.** Promoting it to a committed preflight stage is a separate slice; a
  check that ran once is not a gate.
