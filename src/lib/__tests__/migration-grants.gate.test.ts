// A NEW public TABLE MUST CARRY ITS OWN GRANT (ask c99f9ab7).
//
// Supabase, 2026-09-23: from 2026-10-30, a table created in `public` no longer gets the default
// grants to anon / authenticated / service_role. Existing tables keep theirs. A migration that only
// says `create table` would then make a table NOBODY can read - and the app would show it as empty
// rather than fail, because a refused select under PostgREST reads as zero rows.
//
// So every migration from 2026-09-23 on (the day of the notice; the house style already did this)
// that creates a public table must also GRANT on it, to any role. A `revoke` alone does not count:
// after the cutoff there is nothing left to revoke.
//
// DOES NOT COVER: a table created by a script outside supabase/migrations, a grant that lives in a
// different migration file, or whether the grant is the RIGHT one (RLS policies own that).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'migrations');
const FROM = '20260923';

/** Every public table this SQL creates that no GRANT in the same SQL names. */
function tablesWithoutGrant(sql: string): string[] {
  const clean = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const created = [...clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)]
    .map(m => m[1].toLowerCase());
  return created.filter(t => !new RegExp(`\\bgrant\\b[^;]*\\bon\\s+(?:table\\s+)?(?:public\\.)?"?${t}"?[\\s;,]`, 'i').test(clean));
}

describe('tablesWithoutGrant (controls)', () => {
  it('flags a table with no grant', () => {
    expect(tablesWithoutGrant('create table public.widgets (id uuid);')).toEqual(['widgets']);
  });
  it('flags a table that is only revoked', () => {
    expect(tablesWithoutGrant('create table if not exists public.w (id int);\nrevoke all on public.w from anon;')).toEqual(['w']);
  });
  it('passes a granted table, with or without the TABLE keyword', () => {
    expect(tablesWithoutGrant('create table public.w (id int);\ngrant select on public.w to authenticated;')).toEqual([]);
    expect(tablesWithoutGrant('create table public.w (id int);\nGRANT INSERT ON TABLE public.w TO anon;')).toEqual([]);
  });
  it('ignores a grant that is only in a comment', () => {
    expect(tablesWithoutGrant('create table public.w (id int);\n-- grant select on public.w to authenticated;')).toEqual(['w']);
  });
  it('does not let a grant on a longer name cover a shorter one', () => {
    expect(tablesWithoutGrant('create table public.w (id int);\ngrant select on public.w_log to authenticated;')).toEqual(['w']);
  });
});

describe(`every migration from ${FROM} grants on the public tables it creates`, () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.sql') && f.slice(0, 8) >= FROM).sort();

  it('examines at least one migration that creates a table', () => {
    // A zero here would make the check below pass by examining nothing.
    const withTables = files.filter(f => /create\s+table/i.test(readFileSync(join(DIR, f), 'utf8')));
    expect(withTables.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', file => {
    expect(tablesWithoutGrant(readFileSync(join(DIR, file), 'utf8'))).toEqual([]);
  });
});
