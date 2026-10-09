// The client's closed list of funnel steps must equal the table's CHECK constraint, or a new step
// is silently refused by the database (an insert error the tracker swallows by design). Reads the
// NEWEST migration that sets the constraint, so the next step added to one side fails here until
// the other side follows. Would-fail: add a step to FUNNEL_STEPS without a migration.
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
import { FUNNEL_STEPS } from '../signup-funnel';

describe('funnel steps', () => {
  it('match the newest signup_funnel_events_step_check', () => {
    const dir = 'supabase/migrations';
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const setting = files.filter((f) =>
      /add constraint signup_funnel_events_step_check/.test(readFileSync(`${dir}/${f}`, 'utf8')));
    expect(setting.length).toBeGreaterThan(0);
    const sql = readFileSync(`${dir}/${setting[setting.length - 1]}`, 'utf8');
    const list = sql.match(/add constraint signup_funnel_events_step_check check \(step in \(([\s\S]*?)\)\)/)![1];
    const steps = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect([...steps].sort()).toEqual([...FUNNEL_STEPS].sort());
  });
});
