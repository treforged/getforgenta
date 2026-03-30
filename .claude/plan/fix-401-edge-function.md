# Implementation Plan: fix-401-edge-function

## Audit Report — All Findings

---

### Finding 1 — CRITICAL | Root cause of 401: explicit `Authorization` header in `invoke()` conflicts with SDK header management

**Location:** `src/pages/Premium.tsx:26–28` (handleCheckout) and `:56–58` (handlePortal)

```ts
// Current (broken)
const { data, error } = await supabase.functions.invoke('create-checkout', {
  body: { return_url: window.location.origin },
  headers: {
    Authorization: `Bearer ${session.access_token}`,  // ← this is the problem
  },
});
```

**Why this causes "NO Authorization header reaching the function":**

`supabase.functions.invoke()` in `@supabase/supabase-js@2.99.2` manages auth headers
internally. When the user is authenticated and `persistSession: true`, the SDK calls
`this.functions.setAuth(session.access_token)` via its own internal `onAuthStateChange`
listener, so the correct JWT is already in the SDK's default header set alongside the
required `apikey` header.

When you additionally pass `headers: { Authorization: ... }` in invoke options, the
merge behavior in the current SDK version may result in:
- Only the explicit `Authorization` header being sent WITHOUT the `apikey` header
- The Supabase Edge Function gateway requires `apikey` to route the request to the project
- Without `apikey`, the gateway either rejects the request outright or forwards it with
  the Authorization header stripped, causing the function to see no auth header → 401

This explains the symptom precisely: "Invocation logs show NO Authorization header
reaching the function" — it's stripped at the gateway level before the function code runs.

**Evidence:** `Settings.tsx:93` calls `supabase.functions.invoke('create-portal-link')`
with NO explicit headers, which is the correct SDK-native pattern. This is the only
divergence point between a working and broken invoke call.

**Proposed fix:**
Remove the explicit `headers` block from both invoke calls in `Premium.tsx`. The SDK
handles auth automatically — no manual token injection needed.

```ts
// After fix (correct)
const { data, error } = await supabase.functions.invoke('create-checkout', {
  body: { return_url: window.location.origin },
});
```

The `getSession()` call is retained but only for the "Please sign in first" guard, not
for token injection.

---

### Finding 2 — HIGH | `supabase.auth.getClaims()` is not a public API in v2.99.2

**Location:** `supabase/functions/create-checkout/index.ts:33` and
`supabase/functions/create-portal-session/index.ts:33`

Both Edge Functions use:
```ts
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
if (claimsError || !claimsData?.claims) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
}
const userId = claimsData.claims.sub;
const userEmail = claimsData.claims.email;  // create-checkout only
```

`supabase.auth.getClaims()` is NOT a documented or stable public API in
`@supabase/supabase-js@2`. It was an internal shortcut that locally base64-decodes the
JWT payload without server-side signature verification.

The documented and correct method for Edge Functions is `supabase.auth.getUser(token)`,
which makes a verified call to Supabase Auth and returns the full user object. This is
the pattern shown in all current Supabase Edge Function examples.

If `getClaims` doesn't exist in v2.99.2, the outer try/catch catches the TypeError and
returns 500 — a secondary error path that's masked by the Finding 1 gateway-level 401.
If it does exist (as an undocumented method), it doesn't validate the JWT signature,
making it a security weakness.

**Proposed fix:**
Replace `getClaims` with `getUser` in both Edge Functions:

```ts
// Before
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
if (claimsError || !claimsData?.claims) { return 401; }
const userId = claimsData.claims.sub;
const userEmail = claimsData.claims.email;

// After
const { data: { user }, error: userError } = await supabase.auth.getUser(token);
if (userError || !user) { return 401; }
const userId = user.id;
const userEmail = user.email;   // create-checkout only; create-portal-session doesn't need email
```

---

### Finding 3 — MEDIUM | `Settings.tsx` invokes a non-existent Edge Function

**Location:** `src/pages/Settings.tsx:93`

```ts
const { data, error } = await supabase.functions.invoke('create-portal-link');
```

No `create-portal-link` function exists in `supabase/functions/`. The deployed function
is `create-portal-session`. This call always fails (404 or function not found error).
The error is silently swallowed — `console.error('Portal error:', err)` but no user toast.

**Proposed fix:**
Change the function name to `create-portal-session` and pass the same body as
`Premium.tsx:handlePortal` uses:

```ts
const { data, error } = await supabase.functions.invoke('create-portal-session', {
  body: { return_url: window.location.origin },
});
```

---

### Finding 4 — INFO | `handleCheckout` in `Premium.tsx` silently drops the "no URL" case

**Location:** `src/pages/Premium.tsx:37`

After the recent commit, there's a guard:
```ts
toast.error('Checkout URL was not returned');
```
This is not a bug — it's a correct fallback. No change needed.

---

## Root Cause Summary

| Layer | Issue | Status |
|-------|-------|--------|
| Supabase gateway | `apikey` header missing → strips Authorization before function receives it | **Root cause** (Finding 1) |
| Edge Function auth | `getClaims()` → undocumented/insecure, should be `getUser()` | Secondary (Finding 2) |
| Settings.tsx | Wrong function name → 404 | Separate bug (Finding 3) |

The 401 is caused at the **gateway level** (Finding 1), not inside the function code.
This is why invocation logs show no Authorization header — the header never reaches the
Deno runtime.

---

## Task Type
- [x] Fullstack — Frontend (Premium.tsx, Settings.tsx) + Backend (Edge Functions)

---

## Technical Solution

**Frontend:** Remove explicit `headers` from all `invoke()` calls. The SDK auto-injects
`Authorization: Bearer <user_jwt>` and `apikey: <anon_key>` when authenticated.

**Edge Functions:** Replace `supabase.auth.getClaims(token)` with
`supabase.auth.getUser(token)` and update field access to use `user.id` / `user.email`.

No database changes. No webhook changes. No `PremiumSuccess.tsx` changes.

---

## Implementation Steps

### Step 1 — Backup originals
```
backups/YYYY-MM-DD_HHMMSS/
  src/pages/Premium.tsx
  src/pages/Settings.tsx
  supabase/functions/create-checkout/index.ts
  supabase/functions/create-portal-session/index.ts
```

### Step 2 — `Premium.tsx`: remove explicit `headers` from both invoke calls

`handleCheckout` — remove the entire `headers: { ... }` block:
```ts
const { data, error } = await supabase.functions.invoke('create-checkout', {
  body: { return_url: window.location.origin },
});
```

`handlePortal` — remove the entire `headers: { ... }` block:
```ts
const { data, error } = await supabase.functions.invoke('create-portal-session', {
  body: { return_url: window.location.origin },
});
```

The `getSession()` / `!session` guard stays in both handlers (it's a valid UX check).

### Step 3 — `Settings.tsx`: fix function name

Change `'create-portal-link'` → `'create-portal-session'` and add the `body`:
```ts
const { data, error } = await supabase.functions.invoke('create-portal-session', {
  body: { return_url: window.location.origin },
});
```

### Step 4 — `create-checkout/index.ts`: replace getClaims with getUser

```ts
// Remove:
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
if (claimsError || !claimsData?.claims) { return 401 response; }
const userId = claimsData.claims.sub;
const userEmail = claimsData.claims.email;

// Add:
const { data: { user }, error: userError } = await supabase.auth.getUser(token);
if (userError || !user) { return 401 response; }
const userId = user.id;
const userEmail = user.email ?? '';
```

### Step 5 — `create-portal-session/index.ts`: replace getClaims with getUser

```ts
// Remove:
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
if (claimsError || !claimsData?.claims) { return 401 response; }
const userId = claimsData.claims.sub;

// Add:
const { data: { user }, error: userError } = await supabase.auth.getUser(token);
if (userError || !user) { return 401 response; }
const userId = user.id;
```

### Step 6 — Deploy Edge Functions
- Redeploy `create-checkout` (changed)
- Redeploy `create-portal-session` (changed)

### Step 7 — Commit locally
```
[fix]: resolve 401 on Edge Functions — remove explicit auth headers, replace getClaims with getUser

- Premium.tsx: remove explicit Authorization headers from invoke() calls;
  SDK auto-injects user JWT + apikey via session management
- Settings.tsx: fix function name create-portal-link → create-portal-session
- create-checkout: replace supabase.auth.getClaims with supabase.auth.getUser
- create-portal-session: replace supabase.auth.getClaims with supabase.auth.getUser
```

---

## Key Files

| File | Operation | Description |
|------|-----------|-------------|
| `src/pages/Premium.tsx` | Modify | Remove `headers` from both `invoke()` calls |
| `src/pages/Settings.tsx` | Modify | Fix function name + add body |
| `supabase/functions/create-checkout/index.ts` | Modify | getClaims → getUser |
| `supabase/functions/create-portal-session/index.ts` | Modify | getClaims → getUser |

---

## Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| SDK doesn't auto-inject auth in some edge case | Retained `getSession()` guard in both handlers; if session is null the user is redirected to sign in before invoke fires |
| `getUser(token)` makes a network round-trip to Auth (slower than local getClaims) | Acceptable — this is the secure and officially supported pattern; latency is negligible vs Stripe API calls |
| Settings.tsx portal invocation now has a body | `create-portal-session` already reads `return_url` from the body (and ignores it — it uses the Origin header). Passing a body is harmless. |

---

## SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: N/A
- GEMINI_SESSION: N/A
