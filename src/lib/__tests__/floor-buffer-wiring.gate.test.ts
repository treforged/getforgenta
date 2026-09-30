// GATE: every surface that computes the cash floor reads the SAME buffered rules.
//
// The variable-bill buffer rides on a `floor_buffer` field that `useFloorBufferedRules` stamps on a
// copy of the rules. A floor computed from raw `useRecurringRules()` rows reserves less, shows a
// different payoff date, and nothing goes red - so this derives the call sites from the source
// rather than naming them, and fails on any new one that is not accounted for.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const FLOOR_CALL = /\b(getAugmentedMinSafeCash|getPrePaycheckNextMonthBills|getMinSafeCash)\(/;
const HOOK = 'useFloorBufferedRules';

/**
 * Files that call a floor function with rules HANDED TO THEM, and the one file that hands them
 * over. The feeder must use the hook; that is what makes the receiver safe.
 */
const RECEIVERS: Record<string, string> = {
  'hooks/useCardProjection.ts': 'contexts/CardProjectionContext.tsx',
  'components/debt/CreditCardEngine.tsx': 'pages/DebtPayoff.tsx',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
const read = (r: string) => readFileSync(join(ROOT, r), 'utf8');

describe('floor buffer wiring', () => {
  const callers = walk(ROOT).map(rel).filter(r => FLOOR_CALL.test(read(r)));

  it('finds the floor call sites it is meant to police (positive control)', () => {
    // pay-schedule.ts defines them; a broken walk or regex would find nothing and pass everything.
    expect(callers).toContain('lib/pay-schedule.ts');
    expect(callers).toContain('hooks/useCardProjection.ts');
    expect(callers.length).toBeGreaterThanOrEqual(7);
  });

  it('every caller outside src/lib uses the hook, or is a receiver whose feeder does', () => {
    const bad = callers
      .filter(r => !r.startsWith('lib/'))
      .filter(r => {
        if (read(r).includes(HOOK)) return false;
        const feeder = RECEIVERS[r];
        return !(feeder && read(feeder).includes(HOOK));
      });
    expect(bad).toEqual([]);
  });

  it('the engine hook that builds ForecastInputs uses it too (its rules reach forecast-engine.ts)', () => {
    expect(read('hooks/useForecastEngineInputs.ts')).toContain(HOOK);
  });
});
