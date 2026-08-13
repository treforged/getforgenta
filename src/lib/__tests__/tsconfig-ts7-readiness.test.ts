import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * TypeScript 7 readiness pins.
 *
 * The 2026-08-12 evaluation (handoff/2026-08-12-typescript-7-evaluation.md)
 * measured this codebase under tsc 7.0.2: it is clean, in ~1.0s instead of
 * ~9.1s, but ONLY with the two tsconfig settings pinned below. The bump itself
 * is blocked on typescript-eslint, not on this repo.
 *
 * Both settings are invisible under the TypeScript 5.9.3 we actually ship, which
 * is exactly why they need a test: nothing on the current toolchain complains if
 * someone puts `baseUrl` back, and the cost would land months later on whoever
 * retries the upgrade.
 */
describe('tsconfig is TypeScript 7 ready', () => {
  const raw = readFileSync(resolve(__dirname, '../../../tsconfig.json'), 'utf8');

  // tsconfig is JSONC. Only whole-line comments are used here, so dropping them
  // is enough and cannot corrupt a string value the way a greedy regex would.
  const options = JSON.parse(
    raw
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n'),
  ).compilerOptions as Record<string, unknown>;

  it('does not set baseUrl, which TS 7 removed outright', () => {
    // tsc 7.0.2: "error TS5102: Option 'baseUrl' has been removed."
    expect(options).not.toHaveProperty('baseUrl');
  });

  it('keeps the @/* path alias, which resolves without baseUrl', () => {
    expect((options.paths as Record<string, string[]>)['@/*']).toEqual(['./src/*']);
  });

  it('names node in types, which TS 7 no longer infers ambiently', () => {
    // Without this, 65 errors appear across the fixture-reading tests:
    // `node:fs`, `node:path`, `__dirname` and `process` all go unresolved.
    expect(options.types).toContain('node');
  });

  it('has not turned off a check to buy compatibility', () => {
    // The evaluation's standing rule: no green build bought with a loosened
    // compiler. If a future TS 7 attempt needs one of these relaxed, that is a
    // finding to report, not a diff to slip in.
    expect(options.strict).toBe(true);
    expect(options.noFallthroughCasesInSwitch).toBe(true);
    expect(options.isolatedModules).toBe(true);
  });
});
