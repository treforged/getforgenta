#!/usr/bin/env node
// usage-guard: PreToolUse hook. Pauses work when the current 5-hour Claude usage
// block reaches THRESHOLD_PCT of the largest 5-hour block seen historically, and
// tells the agent to schedule a wakeup for when the window resets.
//
// Why "largest historical block" is the ceiling: the plan's real 5-hour limit is
// not exposed anywhere locally. A block gets capped precisely because the limit
// was hit, so past peaks are the best available proxy. It self-calibrates as
// usage history grows, with no magic number to maintain.
//
// The percentage is therefore an ESTIMATE from local token counts, not
// Anthropic's authoritative rate-limit counter. That is why the default
// threshold is 90 rather than 95.
//
// FAIL OPEN, ALWAYS. A broken meter must never be able to wedge a session, so
// every error path allows the tool call through.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const THRESHOLD_PCT = Number(process.env.FORGENTA_USAGE_THRESHOLD ?? 90);
// ccusage shells out to npx, so keep the call rare. Usage cannot move far in 2 min.
const ACTIVE_TTL_MS = 120 * 1000;
// History only changes when a block closes; once a day is plenty.
const CEILING_TTL_MS = 24 * 60 * 60 * 1000;
const CCUSAGE_TIMEOUT_MS = 20 * 1000;

// Tools that must keep working while paused, or the agent cannot arrange its own
// resume or report why it stopped.
const ALWAYS_ALLOW = new Set([
  "ScheduleWakeup",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
  "TodoWrite",
]);

const CACHE_DIR = join(tmpdir(), "forgenta-usage-guard");

function allow() {
  process.exit(0);
}

function readCache(name, ttlMs) {
  try {
    const p = join(CACHE_DIR, name);
    if (!existsSync(p)) return null;
    if (Date.now() - statSync(p).mtimeMs > ttlMs) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(name, value) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, name), JSON.stringify(value));
  } catch {
    /* cache is an optimisation, never a requirement */
  }
}

function ccusage(args) {
  // Run through a shell as one fixed string. Windows cannot spawn npx.cmd
  // directly (EINVAL since Node 18.20 / 20.12), and passing an args array
  // alongside shell:true is deprecated because arguments are concatenated
  // rather than escaped. Every token here is a literal from this file, so there
  // is no interpolation of external input.
  const out = execSync(`npx -y ccusage@latest ${args.join(" ")} --json`, {
    encoding: "utf8",
    timeout: CCUSAGE_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(out);
}

/** Largest completed 5-hour block on record, in tokens. */
function ceilingTokens() {
  const cached = readCache("ceiling.json", CEILING_TTL_MS);
  if (cached?.ceiling) return cached.ceiling;

  const blocks = ccusage(["blocks"])?.blocks ?? [];
  const ceiling = blocks
    // Exclude the in-flight block (it is still growing) and ccusage's synthetic
    // gap entries, which represent idle time rather than usage.
    .filter((b) => !b.isActive && !b.isGap && typeof b.totalTokens === "number")
    .reduce((max, b) => Math.max(max, b.totalTokens), 0);

  if (!ceiling) return null;
  writeCache("ceiling.json", { ceiling });
  return ceiling;
}

/** Current block usage as a percentage of the ceiling, plus its reset time. */
function usageState() {
  const cached = readCache("active.json", ACTIVE_TTL_MS);
  if (cached) return cached;

  const ceiling = ceilingTokens();
  if (!ceiling) return null;

  const active = (ccusage(["blocks", "--active"])?.blocks ?? [])[0];
  if (!active?.endTime || typeof active.totalTokens !== "number") return null;

  const state = {
    pct: Math.round((active.totalTokens / ceiling) * 1000) / 10,
    usedTokens: active.totalTokens,
    ceiling,
    resetIso: active.endTime,
    secondsToReset: Math.max(0, Math.round((Date.parse(active.endTime) - Date.now()) / 1000)),
  };
  writeCache("active.json", state);
  return state;
}

function main() {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return allow();
  }

  if (ALWAYS_ALLOW.has(payload.tool_name)) return allow();

  let state;
  try {
    state = usageState();
  } catch {
    return allow(); // ccusage missing, offline, slow, or output changed shape
  }
  if (!state || state.pct < THRESHOLD_PCT) return allow();

  // Recompute from the cached reset timestamp so the countdown stays accurate
  // even when the rest of the state came from cache.
  const secondsToReset = Math.max(0, Math.round((Date.parse(state.resetIso) - Date.now()) / 1000));
  if (secondsToReset === 0) return allow(); // window already rolled over

  const mins = Math.ceil(secondsToReset / 60);
  const resetLocal = new Date(state.resetIso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const reason = [
    `USAGE PAUSE: the current 5-hour window is at ~${state.pct}% of your historical peak `,
    `(${state.usedTokens.toLocaleString()} of ~${state.ceiling.toLocaleString()} tokens), `,
    `at or above the ${THRESHOLD_PCT}% stop line.`,
    `\n\nThe window resets at ${resetLocal} local (${state.resetIso}), in ~${mins} min.`,
    `\n\nDo this now, in order:`,
    `\n1. Do NOT retry this tool call and do NOT start new work.`,
    `\n2. Commit anything already finished, then update handoff.md so nothing is lost.`,
    `\n3. Call ScheduleWakeup with delaySeconds=${Math.min(3600, secondsToReset + 120)}`,
    ` and a reason naming the reset time, passing the current /loop prompt so work resumes.`,
    `\n   ScheduleWakeup clamps to [60, 3600]. If the reset is more than an hour out, this`,
    ` wakeup will fire early — that is expected: re-check on wake and re-arm until the window rolls over.`,
    `\n4. Tell the user work is paused until ${resetLocal} and that it will resume on its own.`,
  ].join("");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

try {
  main();
} catch {
  allow();
}
