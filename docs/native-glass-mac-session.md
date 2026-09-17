# The borrowed-MacBook session — native iOS glass, in the order that answers it fastest

Tre, 2026-09-16: *"i want native glass. i just dont have access to a macbook rn. i can borrow a
friends at some point. maybe this weekend."* Ask `7bcea8d0`.

**This file exists so that session is spent MEASURING, not installing.** Everything below that
does not need a Mac has already been done on the Windows desk and is on `origin/main`.

---

## THE ONE QUESTION, and it is not "does glass work"

`UIVisualEffectView` works. What is unknown is whether it can be used **on a surface that has
its own content**, which is every surface this app would want it on.

The effect view is a **sibling of the WKWebView**, not a layer inside it. So:

| Where it sits | What it samples | What it costs |
| --- | --- | --- |
| **Below** the web view | the native background — **no app content at all** | useless: it blurs a flat colour |
| **Above** the web view | app content, correctly | **covers that surface's own web-rendered icons, labels and figures** |

There is no third position. The shape that works needs a **SECOND transparent WKWebView** holding
the chrome content, layered over the effect view — and that is an architecture change, not a
feature.

⚠️ **THAT IS ANALYSIS, NOT MEASUREMENT.** It was reached constructively on the Windows desk by
working through all four candidate surfaces (see `handoff.md`, 2026-09-15), and every step of it
is plausible and unverified. **The Mac is the instrument that turns it into measurement, and the
whole point of the session is to find out whether the analysis is right.** Do not spend the
session building on the assumption that it is.

---

## WHAT IS ALREADY BUILT AND ON MAIN — do not rebuild any of it

- `ios/App/App/GlassEffectPlugin.swift` — `isSupported` / `apply` / `remove`. Compiles against the
  iOS 15 deployment target with every iOS 26 reference inside `#available`. Confirmed green on
  the `macos-latest` runner (`.github/workflows/ios-build.yml`), so **Swift has a red/green gate
  without a Mac** and always did.
- `src/lib/native-glass.ts` — the JS side, `registerPlugin('GlassEffect')`.
- `src/lib/__tests__/native-glass-bridge.gate.test.ts` — asserts the three strings that join the
  two (`jsName` ↔ `registerPlugin`, each `CAPPluginMethod` ↔ the TS interface, and target
  membership in `project.pbxproj`), all DERIVED from the files, with four positive controls that
  run first because two empty sides agree perfectly.
- `isUserInteractionEnabled = false` on the effect view — without it the view swallows every tap
  that lands on it and the app underneath stops responding.

**What is deliberately NOT built** (Sam, 2026-09-15): frame sync. The effect view is a sibling, so
it knows nothing about scrolling, resizing, rotation or the keyboard, and the caller owns
re-pushing the rect. One static surface first, because it is the cheapest thing that can answer
whether the approach survives contact at all.

---

## SETUP, and budget 30 minutes for it rather than being surprised

```bash
git clone https://github.com/treforged/getforgenta.git && cd getforgenta
npm i
npm run build && npx cap sync ios
open ios/App/App.xcodeproj       # the .xcodeproj — see the warning below
```

Then in the running app, open **`/demo`**. That is the whole of the data setup.

✅ **DO NOT COPY `.env.local` ONTO A BORROWED MACHINE. IT IS NOT NEEDED AND IT SHOULD NOT BE
THERE.** An earlier draft of this file told you to, which was wrong twice over: it puts Tre's
Supabase keys on somebody else's laptop, and it is not necessary, because **`/demo` needs no
credentials and renders the same chrome.** Measured 2026-09-16 at 390x844 with an empty browser
profile and no session in `localStorage`: the floating pill comes up at the identical rect
(14,759, 363x71) with the identical radius and all five labels. **Every measurement below happens
on chrome, and the chrome does not care who is signed in.**

(If the app later needs real signed-in data for some other question, that is a reason to bring the
question back to the Windows desk — not a reason to carry keys to a borrowed Mac.)

Scheme: **App**.

⚠️ **THERE IS NO `.xcworkspace` IN THIS REPO, AND THE HABIT SAYS OTHERWISE.** Capacitor's
CocoaPods setup gives you `App.xcworkspace` and every tutorial tells you to open the workspace
rather than the project. **This app is on Capacitor's SPM setup** — `ios/App/CapApp-SPM`, no
`Podfile`, no workspace — so that instruction is wrong here and `open` would fail on a path that
does not exist. Taken from the thing that actually builds rather than from memory:
`.github/workflows/ios-build.yml` runs `xcodebuild -project ios/App/App.xcodeproj -scheme App`.
Dependencies resolve through SPM on first open, which takes a few minutes with no visible
progress — let it finish before concluding anything is broken.

Then in Xcode: select a **simulator running iOS 26** (Xcode → Settings → Platforms if it is not
installed — that download is large, so start it first and read the rest while it runs), and Run.

A physical device needs signing with Tre's Apple ID and is **not required for this question** —
`UIVisualEffectView` composites identically in the simulator. Use the simulator.

---

## THE MEASUREMENTS, cheapest first, so a short session still yields an answer

**Stop at the first one that fails.** Each is a real answer, including the early ones.

### 1. The bridge round-trips (2 minutes)

In Safari → Develop → Simulator → the app's web view, console:

```js
const G = window.Capacitor.Plugins.GlassEffect;
await G.isSupported({ echo: 'hello' });
```

Expect `{ supported: true, iosVersion: '26.x', echo: 'hello' }`.

⚠️ **REACH IT THROUGH `Capacitor.Plugins`, NOT THROUGH AN IMPORT.** The simulator runs the BUILT
bundle, so `await import('/src/lib/native-glass.ts')` — the obvious thing to type, and what a dev
server would accept — resolves nothing there. `'GlassEffect'` is the `registerPlugin` name and the
Swift `jsName`; the gate test asserts those two strings agree, so this is the same name both sides
already use.

⚠️ **AND IF `Capacitor.Plugins.GlassEffect` IS UNDEFINED, THAT IS A RESULT, NOT A TYPO.** The web
fallback in `native-glass.ts` resolves `{ applied: false }` rather than throwing — deliberately, so
a browser and an Android device get a falsy answer and their CSS instead of an unhandled rejection.
**So a silent `false` everywhere means you are talking to the WEB implementation and the native
plugin never registered.** Check `@objc(GlassEffectPlugin)` and target membership before blaming
the material.

⚠️ **The `echo` is the whole point of that method.** A call that resolves with the wrong echo is a
bridge connected to something else. `supported: false` means the simulator is below iOS 26 — fix
the simulator, not the code.

### 2. A surface with NOTHING under it (5 minutes) — does the material render at all?

```js
await G.apply({ id: 'probe', x: 20, y: 200, width: 350, height: 120, cornerRadius: 24 });
```

**Take a screenshot.** You are asking one thing: is there a real blurred rectangle over the app?

- **Nothing appears** → the view is not reaching the hierarchy. Check `bridge?.viewController?.view`.
  This is a bridge problem, not a material problem, and it ends the session's main question early.
- **A rectangle appears** → go on.

### 3. THE QUESTION ITSELF (15 minutes) — does it cover the content it sits on?

Apply it over a surface that **has web content** — the new floating tab bar is the obvious
candidate, since it is already a pill and already glass in CSS. Get its rect from the page:

⚠️ **FIND THE BAR BY ITS SHAPE, NEVER BY `rounded-full`.** This snippet used to read
`document.querySelector('nav[class*="rounded-full"]')`, and that is the correctness-marker trap
this repo has already paid for twice - `scripts/check-nav-doors.mjs` carries the full note and
says in as many words "do not simplify that selector back". `rounded-full` is present only when
the bar is CORRECT, so if the pill has regressed to the old pinned rectangle the selector returns
`null`, the next line throws on `.getBoundingClientRect()`, and a ONE-SHOT borrowed-Mac session
is spent debugging the instrument instead of answering the question. The shape below is true of
the pinned bar and the pill alike.

```js
const nav = [...document.querySelectorAll('nav')].find((el) => {
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).position === 'fixed'
    && r.width > 0 && r.height > 0 && r.bottom > innerHeight / 2;
});
if (!nav) throw new Error('no fixed bottom <nav> in the lower half of the viewport - STOP: this is the instrument, not the answer');
const r = nav.getBoundingClientRect();
await G.apply({ id: 'tabbar', x: r.left, y: r.top, width: r.width, height: r.height, cornerRadius: r.height / 2 });
```

**Screenshot it, and look for the five tab labels and icons.** (Re-verified 2026-09-17: the bar is
still `grid-cols-5` over `PRIMARY` in `src/components/layout/MobileNav.tsx`, so "five" is current
rather than inherited from when this was written. If that count ever changes, the instruction is
"every label the bar renders", not the number.)

- **The labels and icons are GONE, blurred away under the material** → the analysis is CONFIRMED.
  Native glass cannot be used on any surface with its own content without a second WKWebView.
  **That is a complete and valuable result — write it down and stop.** The CSS glass already
  shipped is then the right answer for this app, not a placeholder.
- **The labels and icons are still legible over the material** → the analysis is WRONG, which is
  the better outcome and the one worth the trip. Capture the screenshot, note the iOS version, and
  the surface-by-surface rollout becomes ordinary work.

### 4. Only if 3 says the analysis is wrong (the rest of the session)

Push the rect on scroll and rotation and see whether it tracks acceptably, or lags behind the
content by enough to read as broken. That is the next unknown, and it is not worth opening until
3 has answered.

---

## WHAT TO BRING HOME

The screenshots from 2 and 3, the iOS version, and one sentence saying which way 3 went. Nothing
else from this session is hard to reproduce on the Windows desk.

**Do not tag a `v*` build or dispatch a TestFlight upload from the Mac** — there is nothing for
Tre to look at until 3 has an answer, and Apple caps uploads per app per day.
