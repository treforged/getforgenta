---
name: dev-signin
description: Get the local app to a signed-in state for live verification without stalling on a login wall. Use BEFORE any Claude-in-Chrome verification against localhost — checking a tile, a chart, a forecast number, a page render. Covers the canonical origin rule, how to probe sign-in state, and what to do when signed out. Also use when a localhost page unexpectedly shows the login screen.
---

# Dev sign-in (localhost verification sessions)

Purpose: live verification should never stall on a login wall, and should never
ask Tre for a password. Sign-in is manual **once**; every session after that
rides on the browser profile's own storage.

## The one rule that matters

**The canonical origin is `http://localhost:8080`. Only that origin.**

Supabase persists the session in `localStorage`, and `localStorage` is scoped
per origin. A dev server on 8081 is a *different origin* and therefore a
**signed-out app**, even though the profile is signed in on 8080. This has
already sunk one verification plan (session 103's live before/after A/B).

`vite.config.ts` sets `strictPort: true` so the server fails loudly rather than
drifting to another port. If startup fails on the port, free 8080 — do not
switch ports.

## Procedure

### 1. Ensure the origin is serving

```
node scripts/dev-session.mjs up
```

`check` reports without starting anything; `up` starts `npm run dev` detached
and waits for readiness. Both are credential-free.

### 2. Open the app in the Claude-controlled Chrome

The Claude Chrome is a **separate profile from Tre's browser**. Check its state,
never assume it matches his. Navigate to `http://localhost:8080/dashboard`.

### 3. Probe sign-in state

Read the Supabase auth entry from `localStorage` via `javascript_tool`. The key
is derived from the project ref:

```js
const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
if (!key) { console.log('SIGNED OUT: no supabase auth key'); }
else {
  const s = JSON.parse(localStorage.getItem(key));
  const secs = s.expires_at - Math.floor(Date.now() / 1000);
  console.log(`SIGNED IN as ${s.user?.email}; access token expires in ${secs}s; refresh token present: ${!!s.refresh_token}`);
}
```

Then read it back with `read_console_messages`.

An expired **access** token is not a problem: `autoRefreshToken` is on, so an
open tab renews it. The failure state is a **missing key** (never signed in on
this origin/profile, or profile wiped).

### 4. If signed out

Ask Tre to sign in **once, manually**, in the Claude-controlled Chrome, and say
plainly that this is the only step that needs him. Then resume.

**Never** script credential entry, never fill the password field, never read or
copy the access/refresh token out of the browser, and never write session
material to disk. A refresh token on disk is a durable credential to Tre's real
financial account; the browser profile is where it belongs and nowhere else.

### 5. Keep it alive

Leave the app tab **parked and open** at the end of the session. An open tab is
what keeps the token refreshing. Do not close it during cleanup.

## Failure modes, ranked by how often they actually happen

| Symptom | Cause | Fix |
|---|---|---|
| Login screen on a page that worked last session | wrong origin (8081, 127.0.0.1, a preview URL) | go to `http://localhost:8080` |
| **Tre says "signed in" but the probe still says SIGNED OUT** | he signed in in **his own** Chrome; the extension drives a different profile | ask him to sign in *in the window Claude has open* — see below |
| Login screen on 8080 | Chrome profile has no session yet | Tre signs in once, manually |
| Page never loads | dev server down | `node scripts/dev-session.mjs up` |
| Server refuses to start | port 8080 held by another process | free 8080; do NOT use another port |

### The wrong-browser case (hit for real on 2026-08-07)

This is the most likely reason a confirmed sign-in does not take. Before going
back to Tre a second time, rule out the cheap causes yourself:

1. `list_connected_browsers` — if there is exactly one, that IS the automated
   profile, and his everyday Chrome is not it.
2. Probe `127.0.0.1:8080` as well as `localhost:8080`. They are separate
   origins with separate storage.

Only after both come back empty is it genuinely his turn. Make it unambiguous
which window he needs: navigate the automated tab to `/auth` and **screenshot
it**, so he can match the window on screen rather than guess. Signing in on the
wrong one costs another round trip.

## Non-goals

Automating sign-in itself. There is no credential-free way to create a session
from nothing, and creating one from stored credentials would put a durable
credential to real financial data on disk. The manual-once model is the design,
not a limitation to engineer around.
