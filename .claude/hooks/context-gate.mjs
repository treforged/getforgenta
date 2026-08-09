#!/usr/bin/env node
// context-gate: PostToolUse hook. Reads the session transcript, computes the
// current context size from the most recent assistant message's usage block,
// and reminds Claude to run the context-handoff skill when context is in the
// 150k-200k token band. Throttled to one reminder per 3 minutes per session.

import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 175k, not 150k (Tre, 2026-08-09). The gate is not really at 87% of a 200k window: a fresh session
// spends ~65-70k rebuilding context (system + CLAUDE.md + memory + handoff.md + re-reading the same
// source files) before its first useful edit, so 150k left only ~82k of PRODUCTIVE room and paid the
// rebuild too often. Restart cost is not a one-off — it sits in the prefix and is re-billed on every
// request of the new session. 25k of headroom is still comfortable for a handoff write (~8-12k).
// Do not push past ~180k: overrunning means auto-compact, which flattens exactly the
// "do not re-litigate" decisions and live-verification debt these handoffs exist to carry.
const THRESHOLD = 175_000;
const THROTTLE_MS = 3 * 60 * 1000;

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
  if (tokens < THRESHOLD) process.exit(0);
  if (throttled(input.session_id)) process.exit(0);

  const kTokens = Math.round(tokens / 1000);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `CONTEXT GATE: context is at ~${kTokens}k tokens (threshold 150k). ` +
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
