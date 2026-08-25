// WARNING: what this protects. Phase 0 of docs/partner-linking-design.md is a security surface
// with no UI, which means nothing in the app will visibly break if one of these properties is
// quietly removed — the first symptom would be somebody reading someone else's money.
//
// Three of the properties below cannot be re-derived by reading the code casually:
//
//   1. The migration's FIRST act on public.partner_links is a revoke. Verified on this project
//      2026-08-19: the default ACLs on schema public grant ALL to anon AND authenticated for every
//      new table, so a grant-only migration leaves the table world-writable.
//   2. `invite_code_hash` is absent from the SELECT column grant. A code that can be read back is
//      the 2026-06-15 `share_token` enumeration hole (20260615_fix_public_rls.sql).
//   3. Revocation is one-way. Membership alone in the UPDATE policy would let the other member set
//      `revoked_at` back to null and resurrect a link the first member severed.
//
// The Edge Function itself needs Deno and cannot execute here, so its disciplines are locked as
// source assertions — the same technique public-pricing.test.ts uses on public-build/index.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INVITE_CODE_LENGTH,
  generateInviteCode,
  hashInviteCode,
  isPlausibleInviteCode,
  normalizeEmail,
} from '../../../supabase/functions/partner-link/invite-code';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');
const fnSrc = read('../../../supabase/functions/partner-link/index.ts');
const sqlSrc = read('../../../supabase/migrations/20260825_partner_links.sql');
const typesSrc = read('../../integrations/supabase/types.ts');
const configSrc = read('../../../supabase/config.toml');

// Executable statements only. This file is deliberately comment-heavy, and prose about what is NOT
// granted reads exactly like a grant to a regex — the first version of the INSERT/DELETE test below
// matched the words "Grants ... NO insert" in a section header and failed on a correct migration.
const sqlStatements = sqlSrc
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim().replace(/\s+/g, ' ').toLowerCase())
  .filter(Boolean);

// The design §2 allowlist, verbatim. Adding a table here without adding the policy fails; adding a
// policy for a table that is not here fails too. Both directions are deliberate.
const ALLOWLIST = [
  'accounts',
  'transactions',
  'recurring_rules',
  'budget_items',
  'debts',
  'assets',
  'liabilities',
  'savings_goals',
  'car_funds',
  'net_worth_snapshots',
  'payment_plans',
  'account_reconciliations',
  'synced_transactions',
  'synced_transaction_reviews',
  'car_builds',
  'car_build_phases',
  'car_build_items',
  'car_maintenance_logs',
  'lump_sum_transfers',
] as const;

// Design §2 "explicitly NOT on the allowlist" + §5 "what must NEVER be shared".
const NEVER_SHARED = [
  'profiles',
  'financial_connections',
  'plaid_items',
  'user_subscriptions',
  'subscriptions',
  'ai_advisor_history',
  'ai_usage_events',
  'email_nudges',
  'oauth_states',
  'rate_limits',
] as const;

describe('the invite code itself', () => {
  it('is 22 base64url characters — 16 random bytes, no padding', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(code).not.toContain('=');
  });

  // Not a strength proof — a cheap tripwire for the failure that matters, which is a code
  // generator that stops being random (a counter, a timestamp, a constant).
  it('never repeats across 2000 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(2000);
  });

  it('accepts what it generates', () => {
    for (let i = 0; i < 50; i++) {
      expect(isPlausibleInviteCode(generateInviteCode())).toBe(true);
    }
  });

  it.each([
    ['empty', ''],
    ['too short', 'abc'],
    ['21 chars — one short of a real code', 'a'.repeat(21)],
    ['too long', 'a'.repeat(65)],
    ['base64 padding', `${'a'.repeat(21)}=`],
    ['non-url-safe base64', `${'a'.repeat(20)}+/`],
    ['a SQL-ish payload', "' or 1=1 --xxxxxxxxxxxxx"],
    ['leading whitespace', ` ${'a'.repeat(22)}`],
  ])('rejects %s before any database round-trip', (_label, candidate) => {
    expect(isPlausibleInviteCode(candidate)).toBe(false);
  });
});

describe('only the hash is ever storable', () => {
  it('matches the published SHA-256 vector for "abc"', async () => {
    expect(await hashInviteCode('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is 64 lowercase hex characters and deterministic', async () => {
    const code = generateInviteCode();
    const first = await hashInviteCode(code);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashInviteCode(code)).toBe(first);
  });

  // The whole point: what lands in the column cannot be replayed as a code.
  it('never returns the code it was given, and differs for a one-character change', async () => {
    const code = generateInviteCode();
    const hash = await hashInviteCode(code);
    expect(hash).not.toBe(code);
    expect(await hashInviteCode(`${code}x`)).not.toBe(hash);
  });

  // A stolen hash is not a credential. It is shape-plausible (64 hex chars sit inside the accept
  // gate's length range, and deliberately so — the gate is a shape check, not the wall), so the
  // property worth pinning is that submitting it hashes to something else and matches no row.
  it('is not itself usable as the code, if the column ever leaked', async () => {
    const hash = await hashInviteCode(generateInviteCode());
    expect(await hashInviteCode(hash)).not.toBe(hash);
  });
});

describe('email normalization — the accept path\'s second wall', () => {
  it('trims and lowercases both sides of the comparison', () => {
    expect(normalizeEmail('  Partner@Example.COM ')).toBe('partner@example.com');
  });

  it('is idempotent, which is what the table CHECK constraint assumes', () => {
    const once = normalizeEmail(' A.B+tag@Example.com ');
    expect(normalizeEmail(once)).toBe(once);
    expect(once).toBe(once.toLowerCase());
  });
});

describe('migration: the default ACLs are killed before anything is granted', () => {
  it('revokes from anon and authenticated', () => {
    expect(sqlSrc).toMatch(/revoke all on public\.partner_links from anon, authenticated;/);
  });

  it('does the revoke BEFORE any grant on the table', () => {
    const revokeAt = sqlSrc.indexOf('revoke all on public.partner_links from anon, authenticated');
    const firstGrantAt = sqlSrc.indexOf('grant select (id, inviter_id');
    expect(revokeAt).toBeGreaterThan(-1);
    expect(firstGrantAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeLessThan(firstGrantAt);
  });

  it('enables row level security', () => {
    expect(sqlSrc).toContain('alter table public.partner_links enable row level security;');
  });
});

describe('migration: the code hash has no client-readable path', () => {
  it('omits invite_code_hash from the SELECT column grant', () => {
    const grant = sqlSrc.match(/grant select \(([^)]*)\)\s*\n?\s*on public\.partner_links/);
    expect(grant).not.toBeNull();
    expect(grant![1]).not.toContain('invite_code_hash');
    // Everything the design does allow, so a future widening is a deliberate edit here.
    for (const col of [
      'id', 'inviter_id', 'invitee_email', 'expires_at',
      'accepted_by', 'accepted_at', 'revoked_at', 'created_at',
    ]) {
      expect(grant![1]).toContain(col);
    }
  });

  it('grants UPDATE on revoked_at and revoked_by only', () => {
    expect(sqlSrc).toContain('grant update (revoked_at, revoked_by) on public.partner_links to authenticated;');
  });

  it('grants no INSERT and no DELETE to a client role — both consents go through the function', () => {
    const grants = sqlStatements.filter(
      (s) => s.startsWith('grant') && s.includes('public.partner_links'),
    );
    // Exactly the two the design allows: the column-limited select, and the revoke-only update.
    expect(grants).toHaveLength(2);
    for (const g of grants) {
      expect(g, g).not.toMatch(/\binsert\b/);
      expect(g, g).not.toMatch(/\bdelete\b/);
      expect(g, g).not.toMatch(/\ball\b/);
      // A bare `grant select on ...` with no column list would re-expose the hash.
      expect(g, g).toMatch(/grant (select \(|update \()/);
    }
  });
});

describe('migration: consent cannot be forged or resurrected', () => {
  it('has both member policies and nothing else on the table', () => {
    const policies = [...sqlSrc.matchAll(/create policy (partner_links_\w+)/g)].map((m) => m[1]);
    expect(policies.sort()).toEqual(['partner_links_revoke_own', 'partner_links_select_own']);
  });

  // The hole a membership-only predicate would leave: A revokes, B un-revokes, B is back in.
  it('makes revocation one-way — USING skips revoked rows, WITH CHECK refuses to write a null', () => {
    const policy = sqlSrc.slice(
      sqlSrc.indexOf('create policy partner_links_revoke_own'),
      sqlSrc.indexOf('-- ── Grants'),
    );
    expect(policy).toContain('and revoked_at is null');
    expect(policy).toContain('and revoked_at is not null');
  });

  it('keeps the self-link and consent-pair CHECK constraints', () => {
    expect(sqlSrc).toContain('check (accepted_by is distinct from inviter_id)');
    expect(sqlSrc).toContain('check ((accepted_by is null) = (accepted_at is null))');
  });

  it('keeps the three partial unique indexes from the design', () => {
    for (const idx of [
      'partner_links_one_active_inviter',
      'partner_links_one_active_acceptor',
      'partner_links_one_pending',
    ]) {
      expect(sqlSrc).toContain(`create unique index if not exists ${idx}`);
    }
  });
});

describe('migration: active_partner_id is hardened the way the 2026-06-21 audit requires', () => {
  const fn = sqlSrc.slice(
    sqlSrc.indexOf('create or replace function public.active_partner_id()'),
    sqlSrc.indexOf('-- ── Partner SELECT policies'),
  );

  it('is STABLE SECURITY DEFINER with an empty search_path', () => {
    expect(fn).toContain('language sql stable security definer set search_path = \'\'');
  });

  it('schema-qualifies everything, because search_path is empty', () => {
    expect(fn).toContain('from public.partner_links pl');
    expect(fn).toContain('auth.uid()');
  });

  it('only ever returns the partner of an ACCEPTED, UNREVOKED link', () => {
    expect(fn).toContain('and pl.accepted_at is not null');
    expect(fn).toContain('and pl.revoked_at is null');
  });

  // A bare `limit 1` in an RLS predicate may return a different row per statement.
  it('is deterministic — ordered, not an arbitrary limit 1', () => {
    expect(fn).toMatch(/order by[^;]*limit 1/s);
  });

  it('revokes EXECUTE from PUBLIC, not merely from anon', () => {
    expect(fn).toContain('revoke all on function public.active_partner_id() from public, anon;');
    expect(fn).toContain('grant execute on function public.active_partner_id() to authenticated;');
  });
});

describe('migration: the partner SELECT policies cover the allowlist and nothing else', () => {
  const policyTables = [...sqlSrc.matchAll(/create policy (\w+)_select_partner on public\.(\w+)/g)]
    .map((m) => m[2]);

  it('adds one policy per allowlisted table — 19 of them', () => {
    expect(policyTables).toHaveLength(ALLOWLIST.length);
    expect([...policyTables].sort()).toEqual([...ALLOWLIST].sort());
  });

  it('adds none to any table the design says is never shared', () => {
    for (const table of NEVER_SHARED) {
      expect(policyTables).not.toContain(table);
      expect(sqlSrc).not.toContain(`on public.${table}\n`);
    }
  });

  it('every allowlisted table still exists in the generated types', () => {
    for (const table of ALLOWLIST) {
      expect(typesSrc).toContain(`      ${table}: {`);
    }
  });

  it('scopes every policy to SELECT for authenticated, via the wrapped STABLE call', () => {
    const partnerPolicies = [...sqlSrc.matchAll(
      /create policy \w+_select_partner on public\.\w+\n(.*)\n(.*)/g,
    )];
    expect(partnerPolicies).toHaveLength(ALLOWLIST.length);
    for (const [, line1, line2] of partnerPolicies) {
      expect(line1.trim()).toBe('for select to authenticated');
      // The subselect is what makes it an InitPlan evaluated once per statement.
      expect(line2.trim()).toBe('using (user_id = (select public.active_partner_id()));');
    }
  });

  it('adds no INSERT, UPDATE or DELETE policy for a partner anywhere', () => {
    expect(sqlSrc).not.toMatch(/create policy \w+_(insert|update|delete)_partner/);
  });

  it('is wrapped in a single transaction — policies reference a function in the same file', () => {
    expect(sqlSrc.trimStart().startsWith('--') || sqlSrc.includes('begin;')).toBe(true);
    expect(sqlSrc).toContain('\nbegin;\n');
    expect(sqlSrc.trimEnd().endsWith('commit;')).toBe(true);
  });
});

describe('edge function: the order of the guards', () => {
  it('rate limits by IP before it looks at the JWT', () => {
    const rateLimitAt = fnSrc.indexOf('await checkRateLimit(supabase, `${ip}:partner-link`');
    const authAt = fnSrc.indexOf('userClient.auth\n      .getUser()');
    expect(rateLimitAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(rateLimitAt).toBeLessThan(authAt);
  });

  it('verifies the JWT server-side rather than trusting the header', () => {
    expect(fnSrc).toContain('getUser()');
    expect(fnSrc).toContain('SUPABASE_ANON_KEY');
  });

  it('takes the user id and email only from the verified user, never from the body', () => {
    expect(fnSrc).toContain('const userId = authUser.id;');
    expect(fnSrc).toContain('const userEmail = authUser.email ?? "";');
    expect(fnSrc).not.toMatch(/body\.(user_id|userId|email_of|inviter)/);
  });

  it('applies a second, per-user limit for every action', () => {
    expect(fnSrc).toContain('`${userId}:partner-link:${body.action}`');
    expect(fnSrc).toContain('INVITE_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 5 }');
    expect(fnSrc).toContain('ACCEPT_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 5 }');
  });
});

describe('edge function: invite is not an account-existence oracle', () => {
  // The strongest form of the property: there is no lookup to branch on.
  it('never queries a table by the invited address', () => {
    expect(fnSrc).not.toMatch(/\.eq\(\s*["']email["']/);
    expect(fnSrc).not.toMatch(/\.eq\(\s*["']invitee_email["']/);
    expect(fnSrc).not.toContain('listUsers');
    expect(fnSrc).not.toContain('getUserByEmail');
    expect(fnSrc).not.toContain('admin.generateLink');
  });

  it('has exactly one success return in the invite handler', () => {
    const invite = fnSrc.slice(
      fnSrc.indexOf('async function handleInvite'),
      fnSrc.indexOf('interface AcceptCandidate'),
    );
    expect([...invite.matchAll(/ok: true/g)]).toHaveLength(1);
  });

  it('checks premium server-side with the SubscriptionContext predicate', () => {
    expect(fnSrc).toContain('.from("user_subscriptions")');
    expect(fnSrc).toContain('row?.plan === "premium"');
    expect(fnSrc).toContain('["active", "trialing"].includes(row?.subscription_status ?? "")');
  });

  // A failed subscription read must not be reported to a paying customer as "not premium".
  it('separates "could not check your subscription" from "you are not premium"', () => {
    expect(fnSrc).toContain('Could not check your subscription. Please try again.');
    expect(fnSrc).toContain('Partner linking is a premium feature.');
  });

  it('refuses a self-invite', () => {
    expect(fnSrc).toContain('inviteeEmail === normalizeEmail(userEmail)');
  });

  // Discipline #4: "sent" must never mean "maybe sent".
  it('revokes the invite row and reports failure when the email does not go out', () => {
    const invite = fnSrc.slice(
      fnSrc.indexOf('async function handleInvite'),
      fnSrc.indexOf('interface AcceptCandidate'),
    );
    expect(invite).toContain('if (!sent) {');
    expect(invite).toContain('Could not send the invite email. Please try again.');
    const rollbackAt = invite.indexOf('rollback of unsent invite failed');
    const successAt = invite.indexOf('ok: true');
    expect(rollbackAt).toBeGreaterThan(-1);
    expect(rollbackAt).toBeLessThan(successAt);
  });
});

describe('edge function: accept answers every failure identically', () => {
  const accept = fnSrc.slice(
    fnSrc.indexOf('async function handleAccept'),
    fnSrc.indexOf('async function handleStatus'),
  );

  it('routes every rejection through one deny() with one body and one status', () => {
    expect([...accept.matchAll(/That invite code isn't valid\./g)]).toHaveLength(1);
    expect([...accept.matchAll(/return json\(/g)]).toHaveLength(2); // deny() + the success
    const denials = [...accept.matchAll(/return deny\(/g)];
    expect(denials.length).toBeGreaterThanOrEqual(10);
  });

  it('distinguishes the reasons in the log, where the caller cannot read them', () => {
    for (const reason of [
      'malformed_code',
      'caller_email_unconfirmed',
      'no_matching_invite',
      'expired',
      'email_mismatch',
      'self_accept',
      'caller_already_linked',
      'accept_race_lost',
    ]) {
      expect(accept).toContain(`deny("${reason}")`);
    }
  });

  it('walls it with an exact hash match on a pending, unrevoked row', () => {
    expect(accept).toContain('.eq("invite_code_hash", inviteCodeHash)');
    expect(accept).toContain('.is("accepted_at", null)');
    expect(accept).toContain('.is("revoked_at", null)');
  });

  it('checks expiry, mailbox ownership and self-accept before writing consent', () => {
    const writeAt = accept.indexOf('.update({ accepted_by: userId');
    for (const guard of [
      'Date.parse(link.expires_at) <= Date.now()',
      'normalizeEmail(userEmail) !== link.invitee_email',
      'link.inviter_id === userId',
      'if (active) return deny("caller_already_linked")',
    ]) {
      const at = accept.indexOf(guard);
      expect(at, guard).toBeGreaterThan(-1);
      expect(at, guard).toBeLessThan(writeAt);
    }
  });

  // Two accepts of one code must not both win.
  it('re-asserts "still pending" inside the UPDATE and denies on a zero-row result', () => {
    const update = accept.slice(accept.indexOf('.update({ accepted_by: userId'));
    expect(update).toContain('.is("accepted_at", null)');
    expect(update).toContain('.is("revoked_at", null)');
    expect(update).toContain('if (!accepted) return deny("accept_race_lost")');
  });
});

describe('edge function: nothing leaks the code, the hash, or an address', () => {
  // NB: the accept failure copy is the words "That invite code isn't valid", so a bare /\bcode\b/
  // over the body flags a correct file. What a leak would actually look like is a `code` KEY or the
  // `code` variable interpolated — that is what is asserted.
  it('never puts the code or its hash in a response body', () => {
    const responses = [...fnSrc.matchAll(/return json\(\s*\{[^}]*\}/gs)].map((m) => m[0]);
    expect(responses.length).toBeGreaterThan(5);
    for (const body of responses) {
      expect(body, body).not.toMatch(/\bcode\s*:/);
      expect(body, body).not.toContain('${code}');
      expect(body, body).not.toContain('inviteCodeHash');
      expect(body, body).not.toContain('invite_code_hash');
    }
  });

  // The code has exactly one destination and it is the invited mailbox. Pinning the wire rather
  // than the identifier: the file talks about "code" in prose all over, but it may only ever put
  // one on the network, once, to Resend.
  it('sends the code over exactly one wire, and that wire is the mailer', () => {
    const fetches = [...fnSrc.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    expect(fetches).toEqual(['https://api.resend.com/emails']);
    // The generated code is produced once and handed straight to the mailer.
    expect([...fnSrc.matchAll(/generateInviteCode\(\)/g)]).toHaveLength(1);
    expect(fnSrc).toContain('const sent = await sendInviteEmail(inviteeEmail, inviterName, code);');
    // Only what the invite handler stores is the hash.
    expect(fnSrc).toContain('invite_code_hash: inviteCodeHash,');
    expect(fnSrc).not.toMatch(/invite_code_hash:\s*code\b/);
  });

  it('never logs the code, the hash or an email address', () => {
    const logLines = fnSrc.split('\n').filter((l) => l.includes('console.'));
    expect(logLines.length).toBeGreaterThan(5);
    for (const line of logLines) {
      expect(line, line).not.toMatch(/\b(code|inviteCodeHash|invite_code_hash|userEmail|inviteeEmail)\b/);
    }
  });

  it('correlates accept denials with a non-reversible hash of the user id', () => {
    expect(fnSrc).toContain('const userTag = await hashId(userId);');
    expect(fnSrc).toContain('user=${userTag}');
  });

  it('does not echo the internal error message back to the caller', () => {
    const tail = fnSrc.slice(fnSrc.lastIndexOf('} catch (error) {'));
    expect(tail).toContain('console.error("partner-link error:", error)');
    expect(tail).not.toContain('error.message');
    expect(tail).toContain('Something went wrong. Please try again.');
  });

  it('never selects the hash column into the function at all', () => {
    expect(fnSrc).not.toMatch(/\.select\([^)]*invite_code_hash/);
  });
});

describe('edge function: status tells you about your own row and nobody else', () => {
  const status = fnSrc.slice(
    fnSrc.indexOf('async function handleStatus'),
    fnSrc.indexOf('// ── Entry point'),
  );

  it('reports pending invites only for invites this caller sent', () => {
    expect(status).toContain('.eq("inviter_id", userId)');
    // Would be an "someone invited you" oracle with no code involved.
    expect(status).not.toContain('invitee_email", ');
    expect(status).not.toMatch(/\.eq\(\s*["']invitee_email["']/);
  });

  it('has no revoke action — unlinking is a direct RLS-scoped UPDATE by design', () => {
    expect(fnSrc).not.toContain('"revoke"');
    expect(fnSrc).not.toContain('handleRevoke');
  });
});

describe('config.toml declares the function, because an undeclared one is silently flipped', () => {
  it('registers partner-link with verify_jwt = true', () => {
    expect(configSrc).toMatch(/\[functions\.partner-link\]\nverify_jwt = true/);
  });
});
