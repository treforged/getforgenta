/**
 * A COMP IS NOT A SUBSCRIBER — locked, because the SQL has no other gate.
 *
 * Tre, 2026-09-05: *"fix the reporting bug so comps dont count as subscribers."*
 *
 * `revenue_summary_lines()` reported FIVE active Stripe premium subscriptions. Read against
 * Stripe live mode the same day: eight subscriptions, six active, every one carrying a
 * discount, five of six with no payment method — and exactly ONE charge in the account's whole
 * history, $4.99 to Tre's own card while testing his own checkout. Nobody has ever paid.
 *
 * ── WHY THESE ARE GREP-LOCKS AND NOT BEHAVIOURAL TESTS ───────────────────────────────────────
 * The logic lives in a Postgres function, and this repo has no SQL test harness — vitest cannot
 * reach it. The proof that the fix works is the measured before and after on the LIVE function,
 * recorded in the migration and the commit body:
 *
 *     before   stripe / premium / active   count 5
 *     after    stripe / premium / active   paying 0, comped 5
 *
 * What these cases DO protect is the thing a future session could plausibly undo while tidying:
 * dropping the filter, or folding the comped figure back into the paying one. Both would restore
 * a number that reads as traction and is not, silently, with every existing test still green.
 *
 * They are honest about being a weaker instrument than a behavioural test, which is why the
 * measured numbers are written down beside them rather than left in a terminal nobody kept.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const stripSqlComments = (src: string) => src.replace(/^\s*--.*$/gm, '');
const stripTsComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const MIGRATION = 'supabase/migrations/20260905_subscriptions_is_comp.sql';
const REVENUE_PUSH = 'supabase/functions/revenue-push/index.ts';

describe('revenue reporting never counts a comp as a subscriber', () => {
  it('counts only non-comped rows as the paying figure', () => {
    const sql = stripSqlComments(read(MIGRATION));
    // The paying count and the "ending" count must BOTH exclude comps. Ending is the one that
    // gets forgotten, because it reads as a sub-detail of a number already filtered.
    expect(sql).toContain('count(*) filter (where not s.is_comp)');
    expect(sql).toContain('count(*) filter (where not s.is_comp and s.cancel_at_period_end)');
  });

  it('reports comps SEPARATELY rather than dropping them', () => {
    const sql = stripSqlComments(read(MIGRATION));
    // Hiding them would answer the reporting bug by removing information, which is not the
    // same as fixing it. How many people are carried for free is something Tre asked to see.
    expect(sql).toContain('count(*) filter (where s.is_comp)');
    expect(sql).toMatch(/returns table\([^)]*comped bigint/);
  });

  it('defaults is_comp to TRUE, so a forgotten write under-reports rather than invents', () => {
    const sql = stripSqlComments(read(MIGRATION));
    expect(sql).toMatch(/is_comp boolean not null default true/);
  });

  it('keeps the anon revoke on the recreated function, or the leak silently reopens', () => {
    // CREATE grants EXECUTE to PUBLIC by default, so redefining the function undoes
    // 20260905_revoke_revenue_summary_from_public.sql unless the revoke travels with it.
    const sql = stripSqlComments(read(MIGRATION));
    expect(sql).toContain('revoke execute on function public.revenue_summary_lines() from public');
    expect(sql).toContain('revoke execute on function public.revenue_summary_lines() from anon');
  });

  it('carries comped through the push, and never adds it to the paying total', () => {
    const ts = stripTsComments(read(REVENUE_PUSH));
    expect(ts).toMatch(/comped:\s*number/);
    // Two separate reductions. A single one summing both fields is the exact regression.
    expect(ts).toMatch(/const paying = lines\.reduce\(\(n, l\) => n \+ \(l\.count \?\? 0\), 0\)/);
    expect(ts).toMatch(/const comped = lines\.reduce\(\(n, l\) => n \+ \(l\.comped \?\? 0\), 0\)/);
    expect(ts).not.toMatch(/l\.count \+ l\.comped/);
  });
});
