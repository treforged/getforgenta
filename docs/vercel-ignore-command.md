# Why `vercel.json` has an `ignoreCommand`, and why the explanation lives HERE

⚠️ **THIS FILE EXISTS BECAUSE THE COMMENT COULD NOT LIVE IN `vercel.json`.** The first attempt put
the reasoning in a `"$comment"` array at the top of that file, and **Vercel rejected the whole
config**:

> The `vercel.json` schema validation failed with the following message: should NOT have additional
> property `$comment`

That broke **two consecutive production deployments** before it was caught. `vercel.json` allows no
unknown top-level properties — not `$comment`, not `//`, not anything. **Do not add one.** If you
need to explain something about that file, add it to this document.

## What the rule does

```
"ignoreCommand": "git diff --quiet HEAD^ HEAD -- ':(exclude)docs/**' ':(exclude)*.md' ':(exclude)claudecontext/**'"
```

A commit that changes only documentation does not build and does not store a deployment.

## Why it was added

Vercel emailed that the free team had used **100% of its 10 GB Deployment Storage**. The cause was
not traffic. It was **20 production deployments in about three hours**, and half of them commits
that changed no shipped byte.

Measured, not assumed:

| Window | Docs-only | Total |
| --- | --- | --- |
| The 20 most recent production deployments (3.03 hours) | **10** | 20 |
| Commits in the last 24 hours of git history | **40** | 115 |

⚠️ **No GB saving is claimed.** Per-deployment size was not measurable from the API, and converting
"half the builds" into "half the storage" assumes every build is the same size. It has not been
verified.

## The exit codes are backwards from intuition

**`0` SKIPS the build. Non-zero BUILDS it.**

`git diff --quiet A B -- <paths>` exits **0 when there is NO difference**. So diffing with the
documentation paths *excluded* lands exactly right: nothing left once docs are removed means
nothing to build.

## It fails OPEN, on purpose

On a shallow clone `HEAD^` may not exist. Git then exits **128** — non-zero — so it **builds**.

That is the opposite of the bank-link entitlement gate, which fails CLOSED, and the difference is
deliberate. There, the expensive mistake is letting a billable action through. Here, the expensive
mistake is **skipping a real build silently**, because a skipped deployment looks exactly like "no
changes needed".

## Proven both ways before it was trusted

A skip rule that has only been proven to skip is not proven.

| Commit | Exit | Result |
| --- | --- | --- |
| `docs(cost)` | 0 | skip |
| `docs(handoff)` | 0 | skip |
| `[billing]` (source) | 1 | build |
| `[transactions]` (source) | 1 | build |
| a bad ref | 128 | build |

`docs(legal)` **builds**, correctly — `LICENSE` has no `.md` extension so it falls outside the
exclusions, and building is the safe direction.

## The lesson that outlived the bug

The rule itself was proven both ways. **The file it was written into was not.** Validating the JSON
locally with `node -e "require('./vercel.json')"` proved it was well-formed JSON and said nothing
about whether Vercel would accept its *schema* — a green check against the wrong authority, which is
the same false-green family as a test that exercises a mock instead of the code.

**After changing `vercel.json`, watch the deployment reach READY.** Do not treat a valid-JSON check,
or a successful `git push`, as evidence that the config was accepted.
