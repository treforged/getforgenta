#!/usr/bin/env node
// context-gate: PostToolUse hook. Reads the session transcript, computes the
// current context size from the most recent assistant message's usage block,
// and reminds Claude to run the context-handoff skill when context is in the
// 150k-200k token band. Throttled to one reminder per 3 minutes per session.

import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// 175k, not 150k (Tre, 2026-08-09). The gate is not really at 87% of a 200k window: a fresh session
// spends ~65-70k rebuilding context (system + CLAUDE.md + memory + handoff.md + re-reading the same
// source files) before its first useful edit, so 150k left only ~82k of PRODUCTIVE room and paid the
// rebuild too often. Restart cost is not a one-off — it sits in the prefix and is re-billed on every
// request of the new session. 25k of headroom is still comfortable for a handoff write (~8-12k).
// Do not push past ~180k: overrunning means auto-compact, which flattens exactly the
// "do not re-litigate" decisions and live-verification debt these handoffs exist to carry.
const DEFAULT_WINDOW = 200_000;
const GATE_FRACTION = 0.875; // 175k of a 200k window, the tuned figure above.
const THROTTLE_MS = 3 * 60 * 1000;

// Windows this harness actually ships, smallest first. Used only to turn an
// observed context size into the smallest window that could possibly contain it.
const WINDOW_LADDER = [200_000, 1_000_000, 15_000_000];

/**
 * The context window this session is really running in.
 *
 * Hooks are not told the window size, and hard-coding 200k made this gate fire
 * continuously on a large-window session: on 2026-08-26 it interrupted roughly
 * a dozen times in one session that was using 2.5% of its budget, demanding a
 * handoff and a /clear that would have thrown away a working session for
 * nothing. A gate that cries wolf is worse than no gate, because the real
 * warning stops being read.
 *
 * The inference is a deduction rather than a guess: auto-compact fires near the
 * window limit, so a session sitting healthily at 385k tokens PROVES its window
 * is larger than 200k. Take the smallest shipped window that still comfortably
 * contains what we have already observed. Set CLAUDE_CONTEXT_WINDOW_TOKENS to
 * override, or CLAUDE_CONTEXT_GATE_THRESHOLD to pin the trigger outright.
 */
/**
 * The window the CONFIGURED model declares, or 0 when none says. The inference below cannot see a
 * 1M session until it passes 190k, and a 1M session here BOOTS at ~170k (the SessionStart hook
 * payload alone), so the gate fired before the first edit (2026-10-03). The transcript records
 * "claude-opus-5-5" with no window suffix, but settings.json carries "opus[1m]". Most specific
 * settings file wins, as in Claude Code: local, then project, then user.
 */
export function configuredWindow(files) {
  for (const f of files) {
    try {
      const model = JSON.parse(readFileSync(f, "utf8"))?.model;
      if (typeof model !== "string") continue;
      return /\[1m\]/i.test(model) ? 1_000_000 : 0;
    } catch {
      // missing or unreadable: try the next, less specific file
    }
  }
  return 0;
}

const SETTINGS_FILES = [
  join(process.cwd(), ".claude", "settings.local.json"),
  join(process.cwd(), ".claude", "settings.json"),
  join(homedir(), ".claude", "settings.json"),
];

function windowFor(tokens) {
  const override = Number(process.env.CLAUDE_CONTEXT_WINDOW_TOKENS);
  if (Number.isFinite(override) && override > 0) return override;
  const inferred = WINDOW_LADDER.find((w) => tokens < w * 0.95) ?? WINDOW_LADDER[WINDOW_LADDER.length - 1];
  return Math.max(inferred, configuredWindow(SETTINGS_FILES));
}

function thresholdFor(tokens) {
  const pinned = Number(process.env.CLAUDE_CONTEXT_GATE_THRESHOLD);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;
  return Math.round(windowFor(tokens) * GATE_FRACTION) || DEFAULT_WINDOW * GATE_FRACTION;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function contextTokens(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const u = entry?.message?.usage;
    if (!u || typeof u.input_tokens !== "number") continue;
    return (
      u.input_tokens +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0) +
      (u.output_tokens ?? 0)
    );
  }
  return 0;
}

function throttled(sessionId) {
  const marker = join(tmpdir(), `claude-context-gate-${sessionId || "default"}`);
  try {
    if (existsSync(marker) && Date.now() - statSync(marker).mtimeMs < THROTTLE_MS) {
      return true;
    }
  } catch {
    // unreadable marker -> treat as not throttled
  }
  try {
    writeFileSync(marker, String(Date.now()));
  } catch {
    // best effort
  }
  return false;
}

try {
  const input = JSON.parse(readStdin() || "{}");
  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

  const tokens = contextTokens(transcriptPath);
  const threshold = thresholdFor(tokens);
  if (tokens < threshold) process.exit(0);
  if (throttled(input.session_id)) process.exit(0);

  const kTokens = Math.round(tokens / 1000);
  // Interpolated, never a literal. It used to say "threshold 150k" while the
  // constant was 175k, so the reminder misreported its own trigger to the one
  // reader who might have questioned it.
  const kThreshold = Math.round(threshold / 1000);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `CONTEXT GATE: context is at ~${kTokens}k tokens (threshold ${kThreshold}k). ` +
          `STOP starting new work. Run the context-handoff skill NOW: update handoff.md ` +
          `(goals, current state, active files, changes made, failed attempts, next steps), ` +
          `commit it, then tell the user to run /clear so the next agent can resume from handoff.md.`,
      },
      systemMessage: `context-gate: ~${kTokens}k tokens — handoff to handoff.md recommended before /clear`,
    }),
  );
} catch {
  // Never block the session on a gate failure.
  process.exit(0);
}
