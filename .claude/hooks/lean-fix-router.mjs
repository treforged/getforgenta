#!/usr/bin/env node
// lean-fix-router: UserPromptSubmit hook. When the user's prompt looks like a
// code-fix/debug request, inject a reminder to apply the lean-fix workflow
// automatically (triage -> Explore -> strong-model plan -> Sonnet implement).
// Silent on everything else so non-fix prompts carry zero token overhead.

import { readFileSync } from "node:fs";

const FIX_SIGNALS =
  /\b(fix|bug|bugs|broken|breaks?|error|errors|fail(s|ed|ing)?|crash(es|ed|ing)?|wrong|incorrect|not work(s|ing)?|doesn'?t work|issue|debug|regression|mismatch|stack ?trace|exception)\b/i;

// Skips: prompts that are already slash commands, questions about the setup
// itself, or clearly non-code requests are left alone.
const SKIP = /^\s*\//;

try {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const prompt = String(input.prompt ?? "");

  if (!prompt || SKIP.test(prompt) || !FIX_SIGNALS.test(prompt)) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext:
          "lean-fix-router: this looks like a code-fix request. Apply the lean-fix skill workflow " +
          "automatically (do not wait for a manual /lean-fix): Phase 0 triage first — small one-file " +
          "fixes stay inline with no agents; otherwise Explore agent for search, strongest model for " +
          "diagnosis+plan, Sonnet agent for implementation, cheap review. Strong model owns root cause.",
      },
    }),
  );
} catch {
  // Never block prompt submission on a router failure.
  process.exit(0);
}
