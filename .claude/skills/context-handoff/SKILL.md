---
name: context-handoff
description: Check context usage at each TDD gate / step boundary. When context is between 150k and 200k tokens, write a clean handoff to handoff.md (goals, current state, active files, changes made, failed attempts, next steps), commit it, and hand the session to a fresh agent via /clear — even mid-phase. Also use when resuming a session where handoff.md exists.
---

# Context Handoff

Purpose: never let a session degrade or die at the context ceiling. Work is
checkpointed to `handoff.md` at the repo root so a fresh agent can continue
mid-phase with zero re-discovery.

## The loop (TDD gate)

After **every completed step** — a TDD gate (test written / test passing /
refactor done), a plan-item completion, a commit, or any natural pause:

1. Check context usage. Signals, in order of reliability:
   - A `context-gate:` system message or `CONTEXT GATE` reminder injected by
     the PostToolUse hook (`.claude/hooks/context-gate.mjs`) — this is the
     authoritative trigger.
   - Any harness low-context warning.
   - Self-estimate: long session, many large file reads, many tool calls.
2. **Under 150k tokens** → continue working. Do nothing.
3. **150k–200k tokens** → STOP starting new work, even in the middle of a
   phase. Finish only the atomic action in flight (e.g. complete the current
   Edit so the file isn't left broken), then run the handoff procedure below.

## Handoff procedure

1. Write (or fully refresh) `handoff.md` at the repo root using the exact
   template below. Overwrite stale content — the file always reflects NOW.
2. Commit it locally together with any work-in-progress changes:
   `[handoff]: checkpoint at ~<N>k tokens — <one-line state>`
   (Never push. Follow normal backup policy for modified source files.)
3. End the turn with this exact instruction to the user, and nothing pending:
   > Context is at ~<N>k tokens. handoff.md is updated and committed.
   > Run `/clear`, then say "continue from handoff.md" to resume.
   Claude cannot run `/clear` itself — the user must.

## handoff.md template

```markdown
# Handoff — <YYYY-MM-DD HH:MM> — <branch>

## Goals
- The overall objective of this effort, in the user's words where possible.
- Acceptance criteria / definition of done.

## Current State
- Exactly where work stopped (phase, step, TDD gate: red/green/refactor).
- Build/test status right now (passing? failing? which command to verify).
- Anything half-done and what "finished" looks like for it.

## Active Files
- `path/to/file.ts` — why it matters / what's being changed in it.
- (every file the next agent must open first)

## Changes Made
- Commits this session: `<sha> <message>` (from `git log --oneline`).
- Uncommitted changes and why they're uncommitted, if any.

## Failed Attempts
- Approaches tried that did NOT work, and why — so the next agent
  doesn't repeat them. Include reverted code, dead ends, wrong hypotheses.

## Next Steps
1. The immediate next action (specific: file, function, test name).
2. Then-what, in order.
3. Open questions / ambiguities to ask the user about (per CLAUDE.md,
   ask — don't guess).
```

## Resuming (fresh agent)

If `handoff.md` exists at session start or the user says "continue from
handoff.md":

1. Read `handoff.md` in full before touching anything else.
2. Verify Current State claims (run the stated test/build command, check
   `git log` / `git status`) — the file reflects when it was written.
3. Continue from Next Steps step 1. Do not retry anything listed under
   Failed Attempts without new information.
4. Keep updating `handoff.md` at the same gate cadence.

## Rules

- The handoff must be self-contained: assume the next agent has ZERO memory
  of this conversation. No shorthand, no codenames, full paths.
- Mid-phase handoff is expected and fine — the template captures the
  mid-phase state precisely so continuation is seamless.
- Never skip the commit: an uncommitted handoff.md can be lost.
