// The username rules live in TWO places and MUST agree: `src/lib/username.ts` (the courtesy the
// browser shows) and `supabase/migrations/20260918_username_allowed_server_side.sql` (the control
// that actually refuses a write). They cannot share code across TypeScript and SQL, so this gate
// asserts they carry the same words instead.
//
// ⚠️ THIS EXISTS BECAUSE THE SERVER HALF DID NOT, UNTIL 2026-09-18. `RESERVED_USERNAMES` was
// enforced only in the browser, so an authenticated caller going straight at PostgREST could claim
// `support`, `admin` or `forgenta` - the impersonation handles that file itself calls the
// expensive ones. A list that lives in two files and is checked by nobody drifts back into that
// state the first time somebody adds a word to one of them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BANNED_SUBSTRINGS,
  RESERVED_USERNAMES,
  containsBannedWord,
  usernameProblem,
  usernameProblemMessage,
} from '../username';

const MIGRATION = resolve(
  __dirname,
  '../../../supabase/migrations/20260918_username_allowed_server_side.sql',
);

/** Pull a quoted-string array out of the migration, given the line that opens it. */
function sqlArrayAfter(sql: string, opener: string): string[] {
  const start = sql.indexOf(opener);
  if (start === -1) return [];
  const close = sql.indexOf(']', start);
  if (close === -1) return [];
  const body = sql.slice(start + opener.length, close);
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

describe('the TypeScript and SQL username lists agree', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const sqlReserved = sqlArrayAfter(sql, "lower(btrim(p_username)) <> all (array[");
  const sqlBanned = sqlArrayAfter(sql, 'from unnest(array[');

  // ⚠️ POSITIVE CONTROL ON THE EXTRACTION, FIRST. Two empty arrays compare equal perfectly, so a
  // regex that matches nothing would report the lists as in step for ever. This is the assertion
  // that makes every comparison below mean something.
  it('the extraction found both SQL lists', () => {
    expect(sqlReserved.length).toBeGreaterThan(10);
    expect(sqlBanned.length).toBeGreaterThan(20);
    expect(sqlReserved).toContain('support');
    expect(sqlBanned).toContain('fuck');
  });

  it('the reserved lists are the same set', () => {
    expect([...sqlReserved].sort()).toEqual([...RESERVED_USERNAMES].sort());
  });

  it('the banned lists are the same set', () => {
    expect([...sqlBanned].sort()).toEqual([...BANNED_SUBSTRINGS].sort());
  });
});

describe('the filter refuses what it should', () => {
  // Reserved: the impersonation handles.
  it.each(['support', 'admin', 'forgenta', 'billing', 'official'])('%s is reserved', (u) => {
    expect(usernameProblem(u)).toBe('reserved');
  });

  // Banned, plain and evaded.
  it.each([
    'fuckface', 'xxshitxx', 'mynazi', 'hitler88',
    'sh1t_lord', 'n4zi_kid', 'f_u_c_k', 's_h_1_t',
  ])('%s is banned', (u) => {
    expect(usernameProblem(u)).toBe('banned');
    expect(containsBannedWord(u)).toBe(true);
  });
});

describe('the filter does NOT cry wolf', () => {
  // ⚠️ THE LOAD-BEARING HALF. A substring filter that refuses `therapist_jo` is one Tre hears
  // about, and every entry here is a word that a shorter, lazier list would have caught:
  // rapist/therapist, pedo/torpedo, spic/spice, cock/cocktail, ass/class, anal/analysis,
  // cum/documents - plus the two that a blind underscore strip would have joined into a slur.
  it.each([
    'drforged', 'treforged1', 'walkprobe', 'tre_forged',
    'therapist_jo', 'torpedo_fan', 'spice_girl', 'suspicion',
    'cocktail_bar', 'peacock', 'classpass', 'analysis_pro',
    'documents', 'cash_item', 'miss_hit', 'grape_soda',
    'scrape_king', 'shellfish', 'titlecase', 'sussex_lad',
  ])('%s is claimable', (u) => {
    expect(containsBannedWord(u)).toBe(false);
    expect(usernameProblem(u)).toBeNull();
  });
});

describe('the message never names the rule', () => {
  // ⚠️ `reserved`, `banned` and "already taken" must read IDENTICALLY. Naming which rule was hit
  // tells a scraper whether a handle exists, which is the enumeration leak `username.ts` closed
  // for `reserved` and which a new problem code is the obvious way to re-open.
  it('banned and reserved share one sentence', () => {
    expect(usernameProblemMessage('banned')).toBe('That username is not available.');
    expect(usernameProblemMessage('reserved')).toBe(usernameProblemMessage('banned'));
  });
});
