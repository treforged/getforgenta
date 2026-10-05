#!/usr/bin/env node
// WHICH RUN OF A STORE WORKFLOW ACTUALLY REACHED THE STORE?
//
// "The last SUCCESSFUL run" stopped meaning "the last run that shipped" on 2026-10-04, when
// android-build.yml stopped deploying on every push (Play's "Daily save quota exceeded" turned
// run 37208860959 red after a day of pushes). A push run now builds, goes green, and uploads
// nothing - the same shape ios-build.yml has always had, where a green push run carries a real
// build number and an upload step that reads `skipped`. Anything keyed on "last success" then
// reads a build that never left the runner: the release note covers too few commits, and the
// rollout promoter restarts its 24 h soak on every push.
//
// So this asks the only question that matters: the newest run on <branch> whose step named
// <step> concluded `success`. The run's own conclusion is ignored on purpose - a deploy that
// succeeded inside a run that failed later still shipped.
//
// CLI: node scripts/last-shipped-run.mjs <workflow.yml> "<step name>" [branch]
//   stdout: "<headSha> <stepCompletedAtISO>"   exit 0
//   nothing found in the window                 exit 3
//   gh could not be asked                       exit 2
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WINDOW = 40;

/** `gh` as a function, so a test can hand in canned answers instead of the network. */
export function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

/**
 * @param {{ workflow: string, step: string, branch?: string, gh?: (args: string[]) => any }} opts
 * @returns {{ sha: string, completedAt: string, runId: number } | null}
 */
export function lastShippedRun({ workflow, step, branch = 'main', gh = ghJson }) {
  if (!workflow || !step) throw new Error('workflow and step are both required');
  // `step` may name several steps joined by '||', so a RENAMED deploy step still finds the runs that
  // shipped under its old name (2026-10-05: 'staged 10%' became a full release, 7ef43384).
  const names = step.split('||').map(n => n.trim()).filter(Boolean);
  const runs = gh(['run', 'list', '--workflow', workflow, '--branch', branch, '--limit', String(WINDOW),
    '--json', 'databaseId,headSha,status']);
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    const { jobs = [] } = gh(['run', 'view', String(run.databaseId), '--json', 'jobs']);
    for (const job of jobs) {
      const hit = (job.steps ?? []).find(s => names.includes(s.name) && s.conclusion === 'success');
      if (hit) return { sha: run.headSha, completedAt: hit.completedAt, runId: run.databaseId };
    }
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [workflow, step, branch = 'main'] = process.argv.slice(2);
  if (!workflow || !step) {
    process.stderr.write('usage: last-shipped-run.mjs <workflow.yml> "<step name>" [branch]\n');
    process.exit(2);
  }
  let found;
  try {
    found = lastShippedRun({ workflow, step, branch });
  } catch (err) {
    process.stderr.write(`gh could not be asked about ${workflow}: ${String(err.message).split('\n')[0]}\n`);
    process.exit(2);
  }
  if (!found) {
    process.stderr.write(`no run of ${workflow} on ${branch} in the last ${WINDOW} has "${step}" = success\n`);
    process.exit(3);
  }
  process.stderr.write(`last shipped: run ${found.runId} at ${found.completedAt}\n`);
  process.stdout.write(`${found.sha} ${found.completedAt}\n`);
}
