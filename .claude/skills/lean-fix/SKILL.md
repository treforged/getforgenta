---
name: lean-fix
description: Token-efficient code-fix workflow. Triage the task size first; for real bugs, route search to an Explore agent, diagnosis+planning to the strongest model, implementation to a Sonnet agent, and review to a cheap reviewer — keeping file dumps out of the main context so every request stays small. Use when fixing bugs or making scoped changes and token/usage efficiency matters.
---

# Lean Fix — token-routed bug fixing

Goal: maximum output per token. Two levers, in order of impact:

1. **Context hygiene** — keep searches, file dumps, and build logs OUT of
   the main thread. Subagent tool output never lands in main context; only
   their final summary does. This is where most per-request token savings
   come from.
2. **Model routing** — strongest model only where intelligence density
   matters (diagnosis, planning). Sonnet for well-specified implementation,
   Haiku for mechanical edits. This is where usage-limit savings come from.

Quality rule (non-negotiable): the strong model owns DIAGNOSIS. Never let
a cheap model guess at root cause. A Sonnet implementer given a precise,
self-contained plan matches strong-model output; given a vague plan it
does not.

## Phase 0 — Triage (main thread, always)

Estimate before spawning anything. Agents start cold and re-derive
context, so they only pay off above a size threshold.

- **Small** (1 file, obvious cause, < ~50 changed lines): fix INLINE.
  No agents. Read only the relevant line ranges, edit, verify, commit.
- **Medium/Large** (multi-file, unknown root cause, cross-system):
  continue to Phase 1.
- Ambiguous requirements at any point → per CLAUDE.md AMBIGUITY RULE,
  stop and ask the user before burning tokens on the wrong problem.

## Phase 1 — Locate (Explore agent)

Spawn an **Explore** agent (read-only) to find the relevant code:

- Prompt with: the symptom, suspected areas, and EXACTLY what to return —
  file paths + line ranges + one-line role of each, plus any config/flow
  facts needed for diagnosis. Specify search breadth ("medium" usually).
- Do NOT grep/read broadly in the main thread for multi-file hunts; that
  is the single biggest context-bloat source.
- If `graphify-out/` exists, tell the Explore agent to start from
  `graphify-out/GRAPH_REPORT.md`.

## Phase 2 — Diagnose + Plan (strongest model)

Spawn a **Plan** agent with `model: "opus"` (or use a `fork` of yourself
when the main conversation already holds the key context — forks inherit
full context and skip re-derivation).

- Input: symptom, Explore findings (paths + line ranges), reproduction
  steps, constraints from CLAUDE.md (root-cause enforcement, platform
  separation, data integrity).
- Required output — a SELF-CONTAINED implementation plan, assuming the
  implementer has zero conversation memory:
  1. Root cause (stated, not hypothesized — if still hypothetical, the
     plan must say how to confirm it first)
  2. Exact files + functions to change, with the intended change per file
  3. What must NOT change (blast-radius fence)
  4. Verification commands (build, tests, manual check)
  5. Backup list per the backup policy
- Read the plan yourself before Phase 3. If the root cause is hand-wavy,
  push back or investigate inline — do not forward a vague plan to a
  cheaper model.

## Phase 3 — Implement (Sonnet agent)

Spawn a **general-purpose** agent with `model: "sonnet"`:

- Prompt = the full plan verbatim + these standing orders:
  - Read ONLY the files/line-ranges named in the plan.
  - Take timestamped backups per `./backups/` policy before editing.
  - Run the plan's verification commands; report actual output, not
    "should work".
  - If reality contradicts the plan (root cause wrong, file moved),
    STOP and report back — do not improvise a different fix.
- For purely mechanical follow-ups (rename sweep, lint fixes, applying
  an identical pattern across files), use `model: "haiku"` instead.
- Run independent implementation subtasks as PARALLEL Agent calls in one
  message; keep dependent/same-file work in a single agent.

## Phase 4 — Verify + Review (cheap)

- Re-run verification in the main thread only if the implementer's
  report is unclear; otherwise trust its pasted output.
- For risky changes (money math, auth, sync), spawn `code-reviewer`
  (Sonnet default) on the diff. Fix CRITICAL/HIGH findings via the same
  implementer agent (SendMessage to it — it keeps its context; don't
  spawn a fresh one).
- Commit locally per policy. No push.

## Standing token-hygiene rules (any phase, any session)

- Read files by line range when you know the region; never re-read a
  file you just edited.
- Batch independent tool calls into one message.
- Don't paste large code blocks into chat when a `path:line` reference
  works.
- Summaries between phases carry FACTS (paths, line numbers, root cause,
  commands), not transcripts.
- If the context-gate fires mid-fix, the handoff (context-handoff skill)
  takes priority over finishing the phase.
