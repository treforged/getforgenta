# The signed-in verification pass

**Five minutes, in this order, when somebody is signed in.** Written 2026-09-06 because three
slices shipped that day carrying "not verified in a browser", all for the same reason: the dev
sign-in was lost at ~21:42 and the surfaces below **do not render in demo mode**. One ordered pass
closes all of them; three separate re-derivations is what this file exists to prevent.

## Before you start

- **`http://localhost:8080` and no other origin.** Supabase persists the session in `localStorage`,
  which is scoped per origin, so 8081 or `127.0.0.1` is a *signed-out app* wearing the same UI.
  `vite.config.ts` sets `strictPort: true` for exactly this reason — free 8080, never switch ports.
- Serve it: `node scripts/dev-session.mjs up` (credential-free; `check` reports without starting).
- Sign in **manually, once**, in the Claude-controlled Chrome. Never script credential entry, never
  copy a token out of the browser, never write session material to disk — see the `dev-signin`
  skill. **Leave the tab open afterwards**; an open tab is what keeps the token refreshing.
### ⚠️ The sign-in may be revoked *while you work*, and it looks like a wipe

Diagnosed by Sam on 2026-09-06 after the 21:42 loss, and it changes what to do rather than only
what to expect. Probed on the canonical origin: **50 `localStorage` keys present and writable —
`forgenta:trusted_device_id`, `forged:onboarding_done_*`, every `tre:*` preference. Exactly ONE was
gone: the `sb-*-auth-token`.**

**One key of fifty is not loss, it is REVOCATION.** The Supabase client deletes that entry itself
on an explicit `signOut()` **or when a refresh is rejected**. The leading hypothesis — **not a
confirmed finding**, because console tracking starts when the tool is first called and the failing
tab was gone by the time anyone looked — is **refresh-token rotation with two contexts holding one
token**: the automated Chrome and Tre's own browser, whichever refreshes second getting rejected.

What follows from it, whether or not the hypothesis holds:

- **Arm `read_console_messages` on the parked tab BEFORE a long run.** The evidence only exists at
  the moment of failure, and it has now been lost twice by looking afterwards.
- **Leave the app tab parked and open** (step 5 of the `dev-signin` skill). An open tab is what
  keeps the token refreshing, and closing tabs during cleanup is a plausible contributor.
- **Re-probe the session immediately before a check you cannot repeat cheaply**, rather than
  assuming a sign-in from twenty minutes ago is still live.
- **Prefer ONE long-lived measuring frame to many short ones.** Creating and destroying same-origin
  iframes multiplies the contexts that can attempt a refresh.

- Measure at **390px** in a same-origin iframe rather than by eye. It is the house method and it
  produces numbers somebody else can check:

```js
const f = document.createElement('iframe');
f.src = '/dashboard';
f.style.cssText = 'position:fixed;top:0;left:0;width:390px;height:844px;z-index:2147483647;border:0';
document.body.appendChild(f);
```

---

## 1. `BankActivity` — "Link and correct" (⚠️ money, do this first)

**Why it is first:** it is the only unverified item that can change a stored amount.
Shipped `b7913fc0`. ⚠️ **DATA-only, not demo-only** — corrected after the first run: it DOES mount
signed in and renders "0 awaiting a decision". It needs a pending bank row that pairs with a typed
entry, which is rarer than being signed in.

1. Go to **Transactions → the bank review surface** on a signed-in account with synced charges.
2. Find a charge whose suggestion is *your own typed entry* and whose amounts disagree.
   - If none exists naturally, **do not manufacture one against real data.** Read step 4 instead.
3. The row's button must read **`Link and correct $X → $Y`** — *both* figures, before any press.
   A row that agrees still reads `Matches your entry on <date>`. If a differing row shows the old
   wording, the wiring is dead.
4. **"Accept all suggested" must NOT count discrepant rows.** Its own invariant is that it cannot
   create money. Check the count on the button against the number of suggested rows on screen: a
   row with a differing amount **or a differing date** should be missing from it.
5. Press it once on a real pair. Afterwards the ledger row carries the **bank's** amount and date,
   and its `origin` reads `synced` so it is not offered again.

## 2. `GoalLumpSumPanel` — the auto-extra guard

Shipped `797db4a9`. **Does not render in demo** (`{!isDemo && …}`).

1. **Savings Goals**, on a goal whose `auto_extra` is ON.
2. Under *Planned Contributions*, the **Add** button must be **disabled**, and the note must read
   *"Extra payments here are handled automatically from your left-over cash…"*.
3. It must **not** also say "No planned contributions yet" — two sentences that contradict each
   other is how a guarded empty state usually reads, and this one should not.
4. On a goal with `auto_extra` OFF, Add must be **usable**.

⚠️ **The unit test cannot catch a call-site regression** — it renders the component directly, so
`autoExtraOn={g.auto_extra === true}` going missing turns nothing red. **THIS check — step 2 — is
the only thing that covers it**, and it only covers it if you look at goals on BOTH sides of the
flag: a call site dropping the prop renders every goal unguarded, which looks normal until you
notice that the guarded ones are missing.

## 3. The identity badge in partner view

Shipped `dfb058ce`. The own-account half is already verified (label `TRE`, 70×44 at left=9).
**This half needs an account with a partner linked**, which Tre's did not have on 2026-09-06.

1. With a partner linked, open the drawer and switch to partner view.
2. The top-left badge must show the **partner's** name and initials, not yours, and must be tinted
   `text-primary` rather than muted.
3. **The partner-view banner must still be there.** It has not earned removal.
4. An unnamed partner must read **"Partner"** — never your own name and never "You".

## 4. Back on pushed screens, fresh-entry case

Shipped `b43e1bb1`. The in-app path is verified (`/settings` → press → `/dashboard`). **What is
not** is a deep link.

1. Open **`/settings` directly as the first navigation of a fresh tab** while signed in.
2. `window.history.state.idx` should read **0**.
3. Press the top-left chevron. It must land on **`/dashboard`** — **inside the app**. If it exits
   the app or the WebView goes blank, `nav-back.ts` is reading the wrong signal.

---

## Recording the result

Tick these off in `handoff.md` **by name**, and say which ones you actually pressed. A pass nobody
recorded is a pass somebody repeats. If a check cannot be run — no partner linked, no discrepant
charge — write **"not reachable"**, never "passed": the whole point of this file is that
unverified and verified stopped being told apart on 2026-09-06.

---

## Results, 2026-09-06 (first run, on Tre's real signed-in account)

Recorded by name, as this file requires. Two of four ran; two could not.

### 1. `BankActivity` "Link and correct" — **NOT REACHABLE**
`BankActivity` **does** mount signed in and renders — *"0 awaiting a decision / Nothing needs a
decision"* — so the note that it is demo-only was too strong: it is DATA-only. But the queue is
empty, so the control has nothing to appear on, and a discrepant charge was deliberately **not
manufactured against real money**. "Accept all suggested" is absent for the same reason. ⚠️ The
19-charge merchant-memory bulk apply is a DIFFERENT control and is not evidence for this one.
**Still unverified. First thing to run when a bank row pairs with a typed entry.**

### 2. `GoalLumpSumPanel` auto-extra guard — **PASS, on all four goals, both directions**
Stronger than a pass on the guarded state alone, because the same screen showed both outcomes and
they match the database exactly:

| Goal | `auto_extra` | What the panel showed |
|---|---|---|
| Move fund, then emergency fund | `true` | guard note, Add disabled |
| Roth IRA | `true` | guard note, Add disabled |
| Brokerage | `true` | guard note, Add disabled |
| **401K Roth** | **`false`** | **Add usable, "No planned contributions yet"** |

⚠️ **THIS IS THE CHECK THE UNIT TEST CANNOT DO, AND IT PASSED.** If the call site were dropping
`autoExtraOn`, **all four** would render unguarded. Exactly the three rows with `auto_extra = true`
are guarded, which proves `autoExtraOn={g.auto_extra === true}` is wired AND reading the right
field. `401K Roth` looking different is the guard working, not failing.

### 3. Identity badge in partner view — **NOT REACHABLE**
Own-account half confirmed again on real data (the bar renders `T` + `TRE`). No partner is linked
to this account, so partner view cannot be entered from here.

### 4. Back from a deep link — **not run this pass.**

### ⬜ One thing seen but NOT read, so not a finding
In "Where the extra money goes", `401K Roth` appears to carry the same `SHARE` / `AUTO EXTRA`
labels as goals whose `auto_extra` is `true`, while its own flag is `false`. That is a DIFFERENT
surface (`surplus-ranking`), the label may legitimately mean "eligible" rather than "on", and
nobody has read the row. Recorded so it is checked, not repaired blind.
