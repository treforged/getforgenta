import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The guard on the trap that has bitten this repo twice.
 *
 * `useNetWorthSnapshotRecorder` is the ONLY writer of `net_worth_snapshots`. It lived on
 * `/net-worth`; that route became a redirect on 2026-05-22 and recording silently died with the
 * chart frozen behind it, unnoticed for ten weeks. It was re-hooked to the Accounts page on
 * 2026-08-02, and when the chart moved to the Overview on 2026-08-20 the writer had to move too.
 *
 * Nothing about that failure is visible in a type check, a build, or a rendered page: the app
 * works perfectly, and the chart just stops gaining points. So the guard is structural — the
 * recorder must be mounted from `Dashboard.tsx`, which is the surface every panel hangs off, and
 * it must be mounted from exactly one place so a future move cannot leave a second stale copy
 * behind.
 */

const SRC = join(process.cwd(), 'src');
const HOOK = 'useNetWorthSnapshotRecorder';

/**
 * Comments are stripped before searching. A commented-out call still contains the hook's name,
 * and a guard that a `//` defeats is not a guard — the would-fail check for this file is exactly
 * "comment the call out in Dashboard.tsx", and it must go red.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    // `.claude/worktrees` copies have polluted a vitest scan here before; staying under
    // `src` and skipping test folders keeps this counting the real app only.
    if (entry === '__tests__' || entry === 'node_modules') return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const callSites = sourceFiles(SRC).filter(file => {
  if (file.endsWith(join('hooks', `${HOOK}.ts`))) return false; // its own definition
  return stripComments(readFileSync(file, 'utf8')).includes(`${HOOK}(`);
});

describe('net-worth snapshot recorder mounting', () => {
  it('is mounted from Dashboard.tsx, above the panel switch', () => {
    const dashboard = stripComments(readFileSync(join(SRC, 'pages', 'Dashboard.tsx'), 'utf8'));
    expect(dashboard).toContain(`${HOOK}()`);
  });

  it('is mounted from exactly one place, so a move cannot leave a stale second writer', () => {
    expect(callSites.map(f => f.replace(SRC, 'src'))).toHaveLength(1);
  });

  it('is NOT mounted from the Accounts page, which is only rendered when its pill is active', () => {
    const accounts = stripComments(readFileSync(join(SRC, 'pages', 'Accounts.tsx'), 'utf8'));
    expect(accounts).not.toContain(HOOK);
  });
});
