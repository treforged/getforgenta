# TypeScript 7 — evaluation, 2026-08-12

**Verdict: NOT YET, and the reason is not this codebase.** Under tsc 7.0.2 the
application typechecks **clean in ~1.0s instead of ~9.1s**, needing two tsconfig
changes and not one line of application code. What blocks the bump is
**typescript-eslint**, which refuses to load against TS 7 at all and has no
published release that does — not on `latest`, not on `canary`.

`chore(deps-dev): bump typescript from 5.9.3 to 7.0.2` (Dependabot #65) should be
**closed**, not merged and not left open going red.

Everything below was measured on this machine. No finding here is inferred from a
version number or a release note.

---

## The four questions the brief asked, in order

### 1. Why the Vercel deploy fails — it never reaches the compiler

Reproduced exactly, in a throwaway worktree checked out at #65's own head
(`ab650ec7`), rather than read off the PR page:

```
######## npm ci => ok=false 0.8s
npm error code ERESOLVE
npm error While resolving: typescript-eslint@8.66.0
npm error Found: typescript@7.0.2
npm error Could not resolve dependency:
npm error peer typescript@">=4.8.4 <6.1.0" from typescript-eslint@8.66.0
npm error Conflicting peer dependency: typescript@6.0.3
```

**The build dies at dependency install.** Not at `tsc`, not at `vite build` —
before any TypeScript is read. Anyone reading "TypeScript 7 breaks the build"
would reasonably go looking for type errors; there are none to find, and that is
why this needed reproducing instead of assuming.

Dependabot's lockfile was generated with the peer conflict overridden, so the
lockfile it committed cannot be installed by an ordinary `npm ci`.

### 2. Why the audit check fails — the same install, and no vulnerability at all

`.github/workflows/dependency-audit.yml` runs `npm ci` and *then*
`npm audit --audit-level=high`. On #65 the job dies at the first step, for the
ERESOLVE above. The audit itself never runs.

On the current tree the audit step is genuinely green:

```
npm audit --audit-level=high exit code: 0
3 moderate severity vulnerabilities
```

The three moderates are the known `@capacitor/cli → xcode → uuid` chain, already
on the backlog as needing an 8.x major plus mobile verification. They are below
the `high` threshold, so they do not fail the gate. **The red audit check on #65
carries no security signal whatsoever** — worth saying plainly, because "the
audit check is red on the security-relevant PR" is exactly the sentence that
gets a real advisory ignored later.

### 3. What tsconfig uses that TS 7 changed — two things, both now fixed

Found by running the compiler, not by reading the changelog:

```
tsconfig.json(18,5): error TS5102: Option 'baseUrl' has been removed.
  Please remove it from your configuration.
```

**`baseUrl` was removed outright in TS 7.** It was doing nothing here: `paths` is
written relative to the tsconfig (`"@/*": ["./src/*"]`), which is how TS resolves
it with no baseUrl at all. Removing it is clean under **both** compilers.

With that fixed, 65 errors remained — all one family:

```
error TS2591: Cannot find name 'node:fs'. ... add 'node' to the types field
error TS2304: Cannot find name '__dirname'.
error TS2591: Cannot find name 'process'.
```

**TS 7 does not pick up `@types/node` ambiently the way TS 5 did.** Every hit is
in a fixture-reading test (`forecast-engine.goldenTierA`, `projection-harness`,
`plaid-sync-cadence.parity`, and 15 others). Naming it — `"types": ["node"]` — is
the compiler's own suggested fix and takes TS 7 to **0 errors**. Setting
`typeRoots` instead does not work; that was tried and left all 65 in place.

⚠️ **`"types"` narrows ambient type inclusion, which reads like a loosening and
is not one.** Excluding a global can only ever produce *more* unresolved names,
never hide a type error, and here it produces none: TS 5.9.3 also reports 0
errors with it set. Of the 21 installed `@types` packages, everything the app
actually consumes (`react`, `react-dom`, the d3 and chai trees) arrives through
ordinary imports rather than ambiently.

### 4. The dependency chain — one lagging `.d.ts`, already masked

`skipLibCheck: true` is pre-existing in this repo and was **not** touched. With
it on, as shipped, vite, vitest, `@supabase/*` and the two LaunchDarkly SDKs all
resolve and check clean under TS 7.

Turning it off to look underneath is where the one real vendor lag shows:

| compiler | `skipLibCheck: false` |
|---|---|
| TS 5.9.3 | **0 errors** |
| TS 7.0.2 | **21 errors, all in one file** |

```
node_modules/@supabase/auth-js/dist/module/lib/webauthn.dom.d.ts(501,18):
  error TS2430: Interface 'PublicKeyCredentialFuture<T>' incorrectly extends
  interface 'PublicKeyCredential'.
```

So **`@supabase/auth-js` is the dependency whose types are not TS 7 clean**, and
the repo's existing `skipLibCheck` is what keeps it from mattering. It does not
block the upgrade today. It is worth knowing before anyone proposes turning
`skipLibCheck` off as a hardening measure, because that would newly couple this
repo's typecheck to a Supabase WebAuthn declaration nobody here calls.

---

## The number that is the whole point of TS 7

Same tsconfig, same source tree, three consecutive runs each, `--noEmit`:

| compiler | run 1 | run 2 | run 3 | errors |
|---|---|---|---|---|
| **TS 5.9.3** | 9.23s | 9.10s | 9.07s | 0 |
| **TS 7.0.2** | 1.03s | 0.99s | 0.99s | 0 |

**~9× faster, at identical output.** That is the reason to want this, and it is
real on this codebase rather than on a benchmark. It is also why the answer here
is "hold", not "drop it": the payoff is worth returning for.

Both compilers were run from isolated installs outside the repo so the shared
checkout was never disturbed. Control: isolated TS 5.9.3 against the *unmodified*
tsconfig reports 0 errors, which is what rules out the harness being the cause of
the TS 7 findings.

---

## What actually blocks it

typescript-eslint does not merely fail a peer range — it **hard-refuses at
runtime**. Forcing the install past the ERESOLVE and running lint:

```
######## npm ci --legacy-peer-deps => ok=true 13.0s
######## npx eslint . => ok=false
typescript-eslint does not support TS 7.0.
See https://github.com/typescript-eslint/typescript-eslint/issues/10940
for tracking typescript-eslint's support for TS >=7.1
```

Note what else that run shows: `npm run build` is **green** under TS 7 (built in
1.15s). So the tempting move — force the peers, ship it, the site builds — would
have worked, and would have silently traded away every lint rule in the repo,
including the `no-explicit-any` baseline that took a repo-wide paydown from 1094
to 0 to establish. That is not a trade worth making invisibly, and the diff that
makes it is one flag in a CI file forever afterwards.

Checked rather than assumed, so nobody re-runs it:

| release | peer range |
|---|---|
| `typescript-eslint@latest` (8.67.0) | `typescript: >=4.8.4 <6.1.0` |
| `typescript-eslint@canary` (8.67.1-alpha.3) | `typescript: >=4.8.4 <6.1.0` |

**There is no published typescript-eslint, stable or pre-release, that supports
TypeScript 7.** Their own message says support is tracked for **TS >= 7.1**, and
7.1 exists today only as `7.1.0-dev.*` nightlies. The wait is real and it is
upstream.

The documented interim is running typescript-eslint against a side-by-side TS 6
API. That means carrying two compilers in the dependency tree so one tool can
disagree with the other about what the language is — rejected for a financial
app's build toolchain, for a benefit that is purely a faster local typecheck.

---

## What shipped in this commit

Nothing that adopts TS 7 — the bump is blocked. What shipped is the part that is
this repo's to fix, so that the retry is a one-line dependency change:

- **`tsconfig.json`** — `baseUrl` removed, `"types": ["node"]` added, with the
  reasoning inline. Verified **0 errors under TS 5.9.3 and 0 under TS 7.0.2**.
- **`src/lib/__tests__/tsconfig-ts7-readiness.test.ts`** — 4 tests pinning both
  settings, the `@/*` alias, and that `strict` / `noFallthroughCasesInSwitch` /
  `isolatedModules` are still on. **Verified it bites:** restoring `baseUrl` and
  dropping `types` fails 2 of the 4.

Why pin it with a test at all: both settings are *invisible* on the toolchain we
actually ship. Nothing goes red today if someone puts `baseUrl` back, and the
cost would land months from now on whoever retries the upgrade and has to
rediscover TS5102 from scratch.

**Gates on this tree:** `npx tsc --noEmit` **0**; `npm run build` green in 1.25s;
full suite **1014/1014 across 125 files**. ⚠️ That count is not comparable to the
handoff's 953/119 floor: this checkout also carries a parallel session's
uncommitted `src/components/builds/__tests__/`. 4 of the 1014 are the new file.

---

## The retry condition, written down so it is not re-derived

Retry the TypeScript 7 bump when **typescript-eslint ships a release whose
`typescript` peer range admits 7.x** — issue
[#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940),
their stated target being TS >= 7.1. One command answers it:

```
npm view typescript-eslint@latest peerDependencies
```

When that range stops ending at `<6.1.0`, the remaining work is expected to be:
bump `typescript`, bump `typescript-eslint`, `npm install`, run the gates. The
tsconfig side is already done and pinned.

Do **not** unblock it by any of these:
- `--legacy-peer-deps` or `--force` in CI or on Vercel — proven above to install
  fine and leave lint dead.
- dropping or downgrading typescript-eslint.
- relaxing `strict`, `skipLibCheck`, or any other compiler check. The evaluation
  found nothing that would need it, so a future diff that does is reporting a new
  problem, not solving this one.

## ⬜ Owed — needs Tre, one action

**Close Dependabot PR #65.** This session could not: `gh` is permission-denied
throughout, as are WebFetch and the GitHub API, so no PR could be read or closed
from here (the branch itself was reachable, via `git ls-remote` and `git fetch`,
which is how the exact commit under test was obtained). Closing it is the point
of this item — a red PR left open for weeks is what teaches everyone to scroll
past red PRs.

Suggested closing comment:

> Held, not merged. TypeScript 7 typechecks this codebase clean in ~1.0s vs
> ~9.1s, but typescript-eslint has no release supporting TS 7 (latest and canary
> both cap at `<6.1.0`) and refuses to load, so `npm ci` fails ERESOLVE before
> the compiler runs — that is the failing Vercel deploy, and the failing audit
> check is the same install step, not a vulnerability. The tsconfig side is
> already fixed and pinned on `main`. Reopen when typescript-eslint#10940 lands.
> Full evaluation: `handoff/2026-08-12-typescript-7-evaluation.md`.
