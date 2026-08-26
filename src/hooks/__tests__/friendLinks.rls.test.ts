// WARNING: what this protects. Phase 0 of docs/friends-leaderboard-plan.md is a security
// surface with no UI, exactly like the partner-link Phase 0 before it — nothing in the app
// will visibly break if one of these properties is quietly removed, and the first symptom
// would be somebody reading a stranger's data.
//
// Four properties here cannot be re-derived by reading the migration casually:
//
//   1. The migration's FIRST act on EACH of the three new tables is a revoke. Verified on
//      this project 2026-08-19: the default ACLs on schema public grant ALL to anon AND
//      authenticated for every new table, so a grant-only migration leaves it world-writable.
//   2. `invite_code_hash` is absent from the SELECT column grant. A code that can be read
//      back is the 2026-06-15 `share_token` enumeration hole (20260615_fix_public_rls.sql).
//   3. Both helper functions fail CLOSED — an empty set and a false, never a null — so an
//      unlinked, un-opted-in or revoked viewer resolves to no rows rather than to "unknown".
//   4. The feature adds NOTHING to any table that holds money. Friend visibility ends at
//      `leaderboard_snapshots`; the last two describes below fail if a policy or a grant ever
//      names any other table.
//
// The database cannot be reached from a unit test (and Phase 0 deliberately ships no hook to
// drive), so the technique is the one partner-link-phase0.test.ts uses: assert the migration
// SOURCE, then evaluate the visibility rule through a model that is PINNED to that source by
// an exact-text assertion. If the SQL predicate is edited, the pin fails first and the model
// has to be re-derived rather than quietly diverging from the thing it claims to describe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sqlSrc = readFileSync(
  resolve(here, '../../../supabase/migrations/20260826_friend_links.sql'),
  'utf8',
);

// Executable statements only. The migration is deliberately comment-heavy, and prose about
// what is NOT granted reads exactly like a grant to a regex — the partner-link version of
// this file was caught by that once.
const sqlStatements = sqlSrc
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
  .filter(Boolean);

// The three tables this migration is allowed to exist for, and the two functions.
const NEW_TABLES = ['friend_links', 'leaderboard_shares', 'leaderboard_snapshots'] as const;
const NEW_FUNCTIONS = ['active_friend_ids', 'is_metric_shared'] as const;

// Plan §2: "zero new policies on any raw financial table". Named here so the failure message
// says which one came back; the generic sweep further down catches tables nobody listed.
const NEVER_TOUCHED = [
  'accounts', 'transactions', 'debts', 'savings_goals', 'profiles', 'budget_items',
  'recurring_rules', 'assets', 'liabilities', 'net_worth_snapshots', 'payment_plans',
  'car_funds', 'car_builds', 'synced_transactions', 'plaid_items', 'financial_connections',
  'user_subscriptions', 'partner_links',
] as const;

const METRICS = ['goal_progress', 'savings_streak', 'debt_payoff', 'budget_adherence'] as const;

describe('migration: the default ACLs are killed before anything is granted', () => {
  it.each(NEW_TABLES)('revokes from anon and authenticated as the very next statement after create table %s', (table) => {
    const createAt = sqlStatements.findIndex((s) =>
      s.startsWith(`create table if not exists public.${table} (`));
    expect(createAt, `no create table for ${table}`).toBeGreaterThan(-1);
    // Not merely "before the first grant" — immediately after, so there is no window at all.
    expect(sqlStatements[createAt + 1]).toBe(`revoke all on public.${table} from anon, authenticated`);
  });

  it.each(NEW_TABLES)('enables row level security on %s', (table) => {
    expect(sqlSrc).toContain(`alter table public.${table} enable row level security;`);
  });

  it('is wrapped in a single transaction — policies reference functions defined in the same file', () => {
    expect(sqlSrc).toContain('\nbegin;\n');
    expect(sqlSrc.trimEnd().endsWith('commit;')).toBe(true);
  });
});

describe('migration: the invite code hash has no client-readable path', () => {
  it('omits invite_code_hash from the SELECT column grant', () => {
    const grant = sqlSrc.match(/grant select \(([^)]*)\)\s*\n?\s*on public\.friend_links/);
    expect(grant).not.toBeNull();
    expect(grant![1]).not.toContain('invite_code_hash');
    // Everything the plan does allow, so a future widening is a deliberate edit here.
    for (const col of [
      'id', 'inviter_id', 'invitee_email', 'expires_at',
      'accepted_by', 'accepted_at', 'revoked_at', 'created_at',
    ]) {
      expect(grant![1]).toContain(col);
    }
  });

  it('grants UPDATE on revoked_at and revoked_by only', () => {
    expect(sqlSrc).toContain('grant update (revoked_at, revoked_by) on public.friend_links to authenticated;');
  });

  it('grants no INSERT and no DELETE on friend_links — both consents go through the function', () => {
    const grants = sqlStatements.filter(
      (s) => s.startsWith('grant') && s.includes('public.friend_links'),
    );
    expect(grants).toHaveLength(2);
    for (const g of grants) {
      expect(g, g).not.toMatch(/\binsert\b/);
      expect(g, g).not.toMatch(/\bdelete\b/);
      expect(g, g).not.toMatch(/\ball\b/);
      // A bare `grant select on ...` with no column list would re-expose the hash.
      expect(g, g).toMatch(/grant (select \(|update \()/);
    }
  });

  it('never grants a client role anything on invite_code_hash', () => {
    for (const g of sqlStatements.filter((s) => s.startsWith('grant'))) {
      expect(g, g).not.toContain('invite_code_hash');
    }
  });
});

describe('migration: consent cannot be forged or resurrected', () => {
  it('has both member policies on friend_links and nothing else', () => {
    const policies = [...sqlSrc.matchAll(/create policy (friend_links_\w+)/g)].map((m) => m[1]);
    expect(policies.sort()).toEqual(['friend_links_revoke_own', 'friend_links_select_own']);
  });

  // The hole a membership-only predicate would leave: A revokes, B un-revokes, B is back on
  // A's leaderboard without a fresh consent.
  it('makes revocation one-way — USING skips revoked rows, WITH CHECK refuses to write a null', () => {
    const policy = sqlStatements.find((s) => s.startsWith('create policy friend_links_revoke_own'));
    expect(policy).toBeDefined();
    expect(policy).toContain('and revoked_at is null');
    expect(policy).toContain('and revoked_at is not null');
    expect(policy).toContain('for update to authenticated');
  });

  it('keeps the self-link and consent-pair CHECK constraints', () => {
    expect(sqlSrc).toContain('check (accepted_by is distinct from inviter_id)');
    expect(sqlSrc).toContain('check ((accepted_by is null) = (accepted_at is null))');
    expect(sqlSrc).toContain('check (invitee_email = lower(invitee_email))');
  });

  // Friends are many-to-many, so partner_links' one-active-link-per-side indexes are replaced
  // by the canonical unordered pair. Without it A→B and B→A are two active rows for one
  // friendship, and the same person appears twice on the board.
  it('replaces the one-active-link indexes with a canonical-pair index', () => {
    const pair = sqlStatements.find((s) => s.includes('friend_links_one_active_pair'));
    expect(pair).toBeDefined();
    expect(pair).toContain('create unique index if not exists');
    expect(pair).toContain('(least(inviter_id, accepted_by))');
    expect(pair).toContain('(greatest(inviter_id, accepted_by))');
    expect(pair).toContain('where accepted_at is not null and revoked_at is null');
    // The partner-link one-per-side indexes must NOT have been copied across.
    expect(sqlSrc).not.toContain('friend_links_one_active_inviter');
    expect(sqlSrc).not.toContain('friend_links_one_active_acceptor');
  });

  it('keeps one outstanding invite per inviter and address', () => {
    const pending = sqlStatements.find((s) => s.includes('friend_links_one_pending'));
    expect(pending).toBeDefined();
    expect(pending).toContain('create unique index if not exists');
    expect(pending).toContain('(inviter_id, lower(invitee_email))');
    expect(pending).toContain('where accepted_at is null and revoked_at is null');
  });
});

describe('migration: both helpers are hardened the way the 2026-06-21 audit requires', () => {
  const friendIdsFn = sqlSrc.slice(
    sqlSrc.indexOf('create or replace function public.active_friend_ids()'),
    sqlSrc.indexOf('grant execute on function public.active_friend_ids() to authenticated;'),
  );
  const sharedFn = sqlSrc.slice(
    sqlSrc.indexOf('create or replace function public.is_metric_shared('),
    sqlSrc.indexOf('grant execute on function public.is_metric_shared(uuid, text) to authenticated;'),
  );

  it('declares both STABLE SECURITY DEFINER with an empty search_path', () => {
    for (const fn of [friendIdsFn, sharedFn]) {
      expect(fn).toContain("language sql stable security definer set search_path = ''");
    }
  });

  it('schema-qualifies everything, because search_path is empty', () => {
    expect(friendIdsFn).toContain('from public.friend_links fl');
    expect(friendIdsFn).toContain('auth.uid()');
    expect(sharedFn).toContain('from public.leaderboard_shares ls');
  });

  it('active_friend_ids returns a set, and only of ACCEPTED, UNREVOKED links', () => {
    expect(friendIdsFn).toContain('returns setof uuid');
    expect(friendIdsFn).toContain('and fl.accepted_at is not null');
    expect(friendIdsFn).toContain('and fl.revoked_at is null');
    // A LIMIT would silently cap how many friends can be seen; the partner version needed one
    // because it picks a single row, this one must not have it.
    expect(friendIdsFn).not.toMatch(/\blimit\b/);
  });

  // EXISTS returns false, never null, for a missing row / disabled row / null argument. A
  // predicate that could return null would leave the policy's AND-chain undecided rather than
  // closed.
  it('is_metric_shared is an EXISTS over enabled — false, never null', () => {
    expect(sharedFn).toContain('returns boolean');
    expect(sharedFn).toContain('select exists (');
    expect(sharedFn).toContain('and ls.enabled');
    expect(sharedFn).toContain('where ls.user_id = p_user_id');
    expect(sharedFn).toContain('and ls.metric = p_metric');
  });

  it('revokes EXECUTE from PUBLIC, not merely from anon', () => {
    expect(sqlSrc).toContain('revoke all on function public.active_friend_ids() from public, anon;');
    expect(sqlSrc).toContain('grant execute on function public.active_friend_ids() to authenticated;');
    expect(sqlSrc).toContain('revoke all on function public.is_metric_shared(uuid, text) from public, anon;');
    expect(sqlSrc).toContain('grant execute on function public.is_metric_shared(uuid, text) to authenticated;');
  });

  it('defines each function before the policy that calls it', () => {
    const sharedAt = sqlSrc.indexOf('create or replace function public.is_metric_shared(');
    const friendIdsAt = sqlSrc.indexOf('create or replace function public.active_friend_ids()');
    const policyAt = sqlSrc.indexOf('create policy leaderboard_snapshots_select_friend');
    expect(friendIdsAt).toBeGreaterThan(-1);
    expect(sharedAt).toBeGreaterThan(friendIdsAt);
    expect(policyAt).toBeGreaterThan(sharedAt);
  });
});

describe('migration: the opt-in registry defaults to sharing nothing', () => {
  it('defaults enabled to false and keys one row per user and metric', () => {
    expect(sqlSrc).toContain('enabled    boolean not null default false');
    expect(sqlSrc).toContain('constraint leaderboard_shares_user_metric unique (user_id, metric)');
  });

  it.each([...NEW_TABLES].filter((t) => t !== 'friend_links'))('constrains %s.metric to the four published metrics', (table) => {
    const create = sqlStatements.find((s) => s.startsWith(`create table if not exists public.${table} (`));
    expect(create).toBeDefined();
    expect(create).toContain(
      `constraint ${table}_metric check (metric in ('goal_progress', 'savings_streak', 'debt_payoff', 'budget_adherence'))`,
    );
  });

  it('gives a friend no policy at all on leaderboard_shares — whether you opted in is private', () => {
    const policies = [...sqlSrc.matchAll(/create policy (leaderboard_shares_\w+)/g)].map((m) => m[1]);
    expect(policies.sort()).toEqual([
      'leaderboard_shares_insert_own',
      'leaderboard_shares_select_own',
      'leaderboard_shares_update_own',
    ]);
    for (const p of policies) {
      const stmt = sqlStatements.find((s) => s.startsWith(`create policy ${p}`));
      expect(stmt, p).toContain('auth.uid() = user_id');
    }
  });
});

describe('migration: the snapshot table can only ever hold a coarse bucket', () => {
  it('clamps bucket_value to 0-520 and pins week to a Monday', () => {
    expect(sqlSrc).toContain('check (bucket_value between 0 and 520)');
    // Same date_trunc the friend policy uses, so a row that is not a Monday cannot exist and
    // cannot become an invisible seventh publish slot inside one week.
    expect(sqlSrc).toContain("check (week = date_trunc('week', week::timestamp)::date)");
  });

  it('enforces the weekly cadence with the (user_id, metric, week) key', () => {
    expect(sqlSrc).toContain(
      'constraint leaderboard_snapshots_user_metric_week unique (user_id, metric, week)',
    );
  });

  // Every owner-write policy pins auth.uid() = user_id in WITH CHECK. The spoofing that
  // matters is not a wrong bucket about yourself, it is a bucket planted under another id.
  it('pins every owner write to auth.uid() = user_id in WITH CHECK', () => {
    for (const verb of ['insert', 'update']) {
      const stmt = sqlStatements.find((s) =>
        s.startsWith(`create policy leaderboard_snapshots_${verb}_own`));
      expect(stmt, verb).toBeDefined();
      expect(stmt, verb).toContain('with check (auth.uid() = user_id)');
    }
  });

  it('grants no DELETE and no timestamp read on leaderboard_snapshots', () => {
    const grants = sqlStatements.filter(
      (s) => s.startsWith('grant') && s.includes('public.leaderboard_snapshots'),
    );
    expect(grants).toHaveLength(3);
    for (const g of grants) {
      expect(g, g).not.toMatch(/\bdelete\b/);
      expect(g, g).not.toMatch(/\ball\b/);
      expect(g, g).toMatch(/grant (select \(|insert \(|update \()/);
    }
    // created_at / updated_at are writable but not readable: when in the week somebody
    // published is a timing signal a friend could correlate against (plan §5).
    const select = grants.find((g) => g.startsWith('grant select'));
    expect(select).toBe(
      'grant select (id, user_id, metric, bucket_value, week) on public.leaderboard_snapshots to authenticated',
    );
  });
});

// ── The visibility rule, evaluated ───────────────────────────────────────────
// The pin below is what makes the model beneath it evidence rather than a second opinion:
// it asserts the exact predicate text this model was transcribed from, so any edit to the
// SQL fails here first.
const FRIEND_POLICY = 'create policy leaderboard_snapshots_select_friend '
  + 'on public.leaderboard_snapshots for select to authenticated '
  + 'using ( user_id in (select public.active_friend_ids()) '
  + 'and public.is_metric_shared(user_id, metric) '
  + "and week = date_trunc('week', now())::date )";

const OWNER_POLICY = 'create policy leaderboard_snapshots_select_own '
  + 'on public.leaderboard_snapshots for select to authenticated '
  + 'using (auth.uid() = user_id)';

interface Link {
  inviterId: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}
interface Share {
  userId: string;
  metric: string;
  enabled: boolean;
}
interface Snapshot {
  userId: string;
  metric: string;
  bucketValue: number;
  week: string;
}
interface World {
  links: Link[];
  shares: Share[];
  snapshots: Snapshot[];
}

const THIS_MONDAY = '2026-08-24';
const LAST_MONDAY = '2026-08-17';

/** public.active_friend_ids() — the empty set for an unlinked, pending or revoked viewer. */
function activeFriendIds(world: World, viewer: string): string[] {
  return world.links
    .filter((l) =>
      (l.inviterId === viewer || l.acceptedBy === viewer)
      && l.acceptedAt !== null
      && l.revokedAt === null)
    .map((l) => (l.inviterId === viewer ? l.acceptedBy : l.inviterId))
    .filter((id): id is string => id !== null);
}

/** public.is_metric_shared(user_id, metric) — false for a missing or disabled row. */
function isMetricShared(world: World, userId: string, metric: string): boolean {
  return world.shares.some((s) => s.userId === userId && s.metric === metric && s.enabled);
}

/**
 * What a viewer can SELECT from leaderboard_snapshots. Postgres ORs permissive policies, so
 * a row is visible if `_select_own` OR `_select_friend` matches — modelling only the friend
 * half would be the flattering version of this test.
 */
function visibleSnapshots(world: World, viewer: string, currentWeek = THIS_MONDAY): Snapshot[] {
  const friends = activeFriendIds(world, viewer);
  return world.snapshots.filter((s) =>
    s.userId === viewer
    || (friends.includes(s.userId)
      && isMetricShared(world, s.userId, s.metric)
      && s.week === currentWeek));
}

/** The WITH CHECK shared by leaderboard_snapshots_insert_own and _update_own. */
function canWriteSnapshot(actor: string, row: Snapshot): boolean {
  return row.userId === actor;
}

const OWNER = 'owner-1';
const VIEWER = 'viewer-2';

function world(overrides: Partial<World> = {}): World {
  return {
    links: [],
    shares: METRICS.map((metric) => ({ userId: OWNER, metric, enabled: true })),
    snapshots: [
      { userId: OWNER, metric: 'goal_progress', bucketValue: 45, week: THIS_MONDAY },
      { userId: OWNER, metric: 'savings_streak', bucketValue: 12, week: THIS_MONDAY },
      { userId: OWNER, metric: 'goal_progress', bucketValue: 40, week: LAST_MONDAY },
    ],
    ...overrides,
  };
}

const acceptedLink: Link = {
  inviterId: OWNER, acceptedBy: VIEWER, acceptedAt: '2026-08-20T00:00:00Z', revokedAt: null,
};

describe('leaderboard_snapshots visibility — the model, pinned to the policy text', () => {
  it('is transcribed from the policies actually in the migration', () => {
    expect(sqlStatements).toContain(FRIEND_POLICY);
    expect(sqlStatements).toContain(OWNER_POLICY);
  });

  // The positive control. Without it every "sees zero" assertion below would also pass
  // against a model that returns nothing at all.
  it('an accepted, opted-in friend sees this week\'s buckets — and only this week\'s', () => {
    const visible = visibleSnapshots(world({ links: [acceptedLink] }), VIEWER);
    expect(visible.map((s) => s.metric).sort()).toEqual(['goal_progress', 'savings_streak']);
    expect(visible.every((s) => s.week === THIS_MONDAY)).toBe(true);
    expect(visible.map((s) => s.bucketValue).sort()).toEqual([12, 45]);
  });

  it('an UNLINKED user sees zero snapshots, opted in or not', () => {
    expect(visibleSnapshots(world(), VIEWER)).toEqual([]);
    // And the helper it fails through returns the empty set, not a null to be coerced.
    expect(activeFriendIds(world(), VIEWER)).toEqual([]);
  });

  it('a PENDING invite is not a friendship — zero snapshots until it is accepted', () => {
    const pending: Link = {
      inviterId: OWNER, acceptedBy: null, acceptedAt: null, revokedAt: null,
    };
    expect(visibleSnapshots(world({ links: [pending] }), VIEWER)).toEqual([]);
  });

  it('a LINKED but NOT OPTED-IN friend sees zero snapshots', () => {
    const noShares = world({ links: [acceptedLink], shares: [] });
    expect(activeFriendIds(noShares, VIEWER)).toEqual([OWNER]);
    expect(visibleSnapshots(noShares, VIEWER)).toEqual([]);

    // Explicitly opted OUT is the same answer, and indistinguishable from never having
    // opened the feature.
    const optedOut = world({
      links: [acceptedLink],
      shares: METRICS.map((metric) => ({ userId: OWNER, metric, enabled: false })),
    });
    expect(visibleSnapshots(optedOut, VIEWER)).toEqual([]);
  });

  it('opting one metric in shares that metric and no other', () => {
    const oneMetric = world({
      links: [acceptedLink],
      shares: [{ userId: OWNER, metric: 'goal_progress', enabled: true }],
    });
    expect(visibleSnapshots(oneMetric, VIEWER).map((s) => s.metric)).toEqual(['goal_progress']);
  });

  it('a REVOKED link sees zero snapshots, on the next statement, with no cache to wait for', () => {
    const revoked = world({
      links: [{ ...acceptedLink, revokedAt: '2026-08-26T00:00:00Z' }],
    });
    expect(activeFriendIds(revoked, VIEWER)).toEqual([]);
    expect(visibleSnapshots(revoked, VIEWER)).toEqual([]);
  });

  it('revocation by EITHER side is enough — the row is one friendship, not two', () => {
    const inverted: Link = {
      inviterId: VIEWER, acceptedBy: OWNER, acceptedAt: '2026-08-20T00:00:00Z',
      revokedAt: '2026-08-26T00:00:00Z',
    };
    expect(visibleSnapshots(world({ links: [inverted] }), VIEWER)).toEqual([]);
  });

  it('history stays private even from a live, opted-in friend', () => {
    const visible = visibleSnapshots(world({ links: [acceptedLink] }), VIEWER);
    expect(visible.some((s) => s.week === LAST_MONDAY)).toBe(false);
    // A stale week means the leaderboard shows nothing for that person, not last week's number.
    const staleOnly = world({
      links: [acceptedLink],
      snapshots: [{ userId: OWNER, metric: 'goal_progress', bucketValue: 40, week: LAST_MONDAY }],
    });
    expect(visibleSnapshots(staleOnly, VIEWER)).toEqual([]);
  });

  it('the owner still sees their own rows, every week, opted in or not', () => {
    const ownOnly = world({ shares: [] });
    expect(visibleSnapshots(ownOnly, OWNER)).toHaveLength(3);
  });
});

describe('leaderboard_snapshots writes — you may only ever write your own row', () => {
  it('refuses a bucket planted under another user id', () => {
    expect(canWriteSnapshot(VIEWER, {
      userId: OWNER, metric: 'goal_progress', bucketValue: 100, week: THIS_MONDAY,
    })).toBe(false);
  });

  it('allows the owner their own row', () => {
    expect(canWriteSnapshot(OWNER, {
      userId: OWNER, metric: 'goal_progress', bucketValue: 100, week: THIS_MONDAY,
    })).toBe(true);
  });

  it('and a friendship changes none of that — there is no friend write policy anywhere', () => {
    expect(sqlSrc).not.toMatch(/create policy \w+_(insert|update|delete)_friend/);
    const friendPolicies = [...sqlSrc.matchAll(/create policy (\w+_select_friend)/g)].map((m) => m[1]);
    expect(friendPolicies).toEqual(['leaderboard_snapshots_select_friend']);
  });
});

describe('migration: nothing outside the three new tables is touched', () => {
  const policyTables = [...sqlSrc.matchAll(/create policy \w+\s+on public\.(\w+)/g)].map((m) => m[1]);
  const dropPolicyTables = [...sqlSrc.matchAll(/drop policy if exists \w+ on public\.(\w+)/g)]
    .map((m) => m[1]);
  // A grant whose target cannot be parsed falls through as the whole statement, so the
  // assertion below names it rather than silently passing on an unmatched regex.
  const grantTargets = sqlStatements
    .filter((s) => s.startsWith('grant') || s.startsWith('revoke'))
    .map((s) => s.match(/on (?:function )?public\.(\w+)/)?.[1] ?? s);

  it('creates policies only on the three new tables', () => {
    expect(policyTables.length).toBeGreaterThan(0);
    expect([...new Set(policyTables)].sort()).toEqual([...NEW_TABLES].sort());
    expect([...new Set(dropPolicyTables)].sort()).toEqual([...NEW_TABLES].sort());
  });

  it('grants and revokes only on the three new tables and the two new functions', () => {
    const allowed = new Set<string>([...NEW_TABLES, ...NEW_FUNCTIONS]);
    for (const target of grantTargets) {
      expect(allowed.has(target), `unexpected grant/revoke target: ${target}`).toBe(true);
    }
  });

  it('names no financial table in any executable statement', () => {
    for (const table of NEVER_TOUCHED) {
      const offenders = sqlStatements.filter((s) => new RegExp(`\\b${table}\\b`).test(s));
      expect(offenders, `${table}: ${offenders.join(' | ')}`).toEqual([]);
    }
  });

  it('alters no pre-existing table', () => {
    const alters = sqlStatements.filter((s) => s.startsWith('alter table'));
    expect(alters).toHaveLength(NEW_TABLES.length);
    for (const a of alters) {
      expect(a).toMatch(/^alter table public\.(friend_links|leaderboard_shares|leaderboard_snapshots) enable row level security$/);
    }
  });

  it('drops nothing but its own policies — no drop table, no drop function, no drop index', () => {
    const drops = sqlStatements.filter((s) => s.startsWith('drop'));
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(d, d).toMatch(/^drop policy if exists /);
    }
  });
});
