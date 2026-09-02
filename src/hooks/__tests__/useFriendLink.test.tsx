// @vitest-environment jsdom
/**
 * The friend-link lifecycle from the client's side, plus the Edge Function's four
 * disciplines locked as source assertions (docs/friends-leaderboard-plan.md §2, §4).
 *
 * WARNING: what this protects. Most of Phase 1 is a security surface with a very
 * small UI — nothing visible breaks if one of these properties is quietly removed,
 * and the first symptom would be an invite endpoint that tells a stranger which email
 * addresses have Forgenta accounts.
 *
 * What matters here:
 *  - REVOKE is a direct RLS-scoped UPDATE (never the Edge Function — leaving must work
 *    when functions are down), and a revoke the database silently ignored (zero rows) is
 *    a FAILURE, not a success.
 *  - A FRIEND IS NOT A PARTNER: no viewing lens exists, so the hook must never import or
 *    read `viewedUserId`, and the function must never reach a table that holds money.
 *  - The Edge Function being unreachable is a first-class state: the mutation settles with
 *    a clear error instead of hanging or lying, and a name that could not be read falls
 *    back rather than being invented.
 *  - The function body needs Deno and cannot execute here, so its disciplines are locked as
 *    source assertions — the technique partner-link-phase0.test.ts uses — and the parts of
 *    it that are pure (the cap, the supersede rule) were split into link-rules.ts precisely
 *    so they can be executed rather than merely asserted.
 */
import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FREE_TIER_FRIEND_CAP,
  capFor,
  isFriendOf,
  maskEmailLocal,
  summarizeInviteSlots,
  type LiveLinkRow,
} from '../../../supabase/functions/friend-link/link-rules';
import * as friendCode from '../../../supabase/functions/friend-link/invite-code';
import * as partnerCode from '../../../supabase/functions/partner-link/invite-code';

const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

const state = vi.hoisted(() => ({
  updateResult: { data: [{ id: 'link-1' }] as unknown, error: null as unknown },
  updatePayloads: [] as Record<string, unknown>[],
  selectRows: [] as unknown[],
  selectError: null as unknown,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'friend_links') throw new Error(`unexpected table ${table}`);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'or', 'eq', 'is', 'order', 'limit']) {
        b[m] = () => b;
      }
      b.update = (payload: Record<string, unknown>) => {
        state.updatePayloads.push(payload);
        const u: Record<string, unknown> = {};
        for (const m of ['eq', 'is']) u[m] = () => u;
        u.select = async () => state.updateResult;
        return u;
      };
      (b as { then?: unknown }).then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected: (e: unknown) => unknown,
      ) => Promise.resolve({ data: state.selectRows, error: state.selectError })
        .then(onFulfilled, onRejected);
      return b;
    },
  },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-1' }, loading: false }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const tracedInvokeMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tracer', () => ({ tracedInvoke: tracedInvokeMock }));

import { useFriendLink } from '../useFriendLink';
import { FriendLink } from '../../components/settings/FriendLink';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');
const fnSrc = read('../../../supabase/functions/friend-link/index.ts');
const rulesSrc = read('../../../supabase/functions/friend-link/link-rules.ts');
const hookSrc = read('../useFriendLink.ts');
const componentSrc = read('../../components/settings/FriendLink.tsx');
const settingsSrc = read('../../pages/Settings.tsx');
const configSrc = read('../../../supabase/config.toml');

/**
 * Code only. These files are deliberately comment-heavy, and prose about what is NOT
 * read ("never lensed through `viewedUserId`", "never `select('*')`") reads exactly
 * like the thing itself to a substring check — the migration tests strip comments for
 * the same reason.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const hookCode = codeOnly(hookSrc);

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ACCEPTED_LINK = {
  id: 'link-1',
  inviter_id: 'owner-1',
  invitee_email: 'friend@example.com',
  expires_at: '2099-01-01T00:00:00Z',
  accepted_by: 'friend-2',
  accepted_at: '2026-08-20T00:00:00Z',
  revoked_at: null,
  created_at: '2026-08-19T00:00:00Z',
};

// No vitest globals / RTL auto-cleanup in this repo's config: every rendering test file
// calls cleanup itself (see useFormDraft.test.tsx). Without it the "rendered" describe's
// DOM accumulates across tests and stale copy ("No friends yet.") fails later queries.
afterEach(() => { cleanup(); });

beforeEach(() => {
  vi.clearAllMocks();
  state.updateResult = { data: [{ id: 'link-1' }], error: null };
  state.updatePayloads = [];
  state.selectRows = [];
  state.selectError = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('revoke — leaving always works, and leaves nothing behind', () => {
  it('drops every cached query under the ex-friend\'s id and never calls the function', async () => {
    client.setQueryData(['leaderboard', 'friend-2'], []);
    client.setQueryData(['accounts', 'owner-1'], []);

    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await result.current.revoke.mutateAsync({ id: 'link-1', exFriendUserId: 'friend-2', kind: 'link' });

    await waitFor(() => {
      expect(client.getQueryCache().find({ queryKey: ['leaderboard', 'friend-2'] })).toBeUndefined();
    });
    // The owner's own cache survives — only the ex-friend's keys are purged.
    expect(client.getQueryCache().find({ queryKey: ['accounts', 'owner-1'] })).toBeTruthy();
    // The write is the direct RLS update, stamped with who revoked.
    expect(state.updatePayloads[0]).toMatchObject({ revoked_by: 'owner-1' });
    expect(state.updatePayloads[0].revoked_at).toEqual(expect.any(String));
    // And the Edge Function was never involved.
    expect(tracedInvokeMock).not.toHaveBeenCalled();
  });

  it('a zero-row update is a failure, not a silent success', async () => {
    state.updateResult = { data: [], error: null };
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await expect(
      result.current.revoke.mutateAsync({ id: 'link-1', exFriendUserId: 'friend-2', kind: 'link' }),
    ).rejects.toThrow();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});

describe('invite / accept — the Edge Function being down is a first-class state', () => {
  it('an unreachable function surfaces a clear error and the mutation settles', async () => {
    tracedInvokeMock.mockResolvedValue({
      data: null,
      error: new Error('Failed to send a request to the Edge Function'),
    });
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await expect(result.current.invite.mutateAsync('friend@example.com'))
      .rejects.toThrow(/unavailable/i);
    expect(toastError).toHaveBeenCalled();
  });

  // The cap message is the server's, and the number in it lives in exactly one place.
  it('a JSON error body from the function is shown verbatim (the server\'s words, not ours)', async () => {
    tracedInvokeMock.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('http error'), {
        context: {
          json: async () => ({
            error: 'Free accounts can have 5 friends, including invites you have sent. Remove one, or upgrade to Premium.',
          }),
        },
      }),
    });
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await expect(result.current.invite.mutateAsync('friend@example.com'))
      .rejects.toThrow(/Free accounts can have 5 friends/);
  });

  it('accept passes the code through and succeeds on an ok response', async () => {
    tracedInvokeMock.mockResolvedValue({
      data: { ok: true, link_id: 'link-9', friend: { user_id: 'friend-9', display_name: 'Sam' } },
      error: null,
    });
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await result.current.accept.mutateAsync('SOME-CODE');
    expect(tracedInvokeMock).toHaveBeenCalledWith(
      expect.anything(), 'friend-link',
      expect.objectContaining({ body: { action: 'accept', code: 'SOME-CODE' } }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  // The uniform 404 as the CLIENT sees it: every accept failure the server can have is one
  // message, so the hook cannot leak a distinction the function refused to make.
  it('every accept denial reaches the user as one message — the uniform 404', async () => {
    const denial = {
      data: null,
      error: Object.assign(new Error('http error'), {
        context: { json: async () => ({ error: "That invite code isn't valid." }) },
      }),
    };
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    for (const code of ['expired-code-aaaaaaaaaa', 'wrong-mailbox-code-bbbb', 'garbage']) {
      tracedInvokeMock.mockResolvedValue(denial);
      await expect(result.current.accept.mutateAsync(code)).rejects.toThrow("That invite code isn't valid.");
    }
    const messages = new Set(toastError.mock.calls.map((c) => c[0]));
    expect(messages.size).toBe(1);
  });
});

describe('friend names — resolved by the function, never invented here', () => {
  it('labels a friend with the display name the function returned', async () => {
    state.selectRows = [ACCEPTED_LINK];
    tracedInvokeMock.mockResolvedValue({
      data: { friends: [{ link_id: 'link-1', user_id: 'friend-2', display_name: 'Sam' }], pending: [] },
      error: null,
    });
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await waitFor(() => expect(result.current.friends[0]?.label).toBe('Sam'));
    expect(result.current.friends[0]).toMatchObject({ linkId: 'link-1', userId: 'friend-2' });
    expect(result.current.namesUnavailable).toBe(false);
    expect(tracedInvokeMock).toHaveBeenCalledWith(
      expect.anything(), 'friend-link',
      expect.objectContaining({ body: { action: 'status' } }),
    );
  });

  it('falls back to the address THIS user typed when the name read fails, and says so', async () => {
    state.selectRows = [ACCEPTED_LINK];
    tracedInvokeMock.mockResolvedValue({ data: null, error: new Error('down') });
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await waitFor(() => expect(result.current.namesUnavailable).toBe(true));
    expect(result.current.friends[0].label).toBe('friend@example.com');
  });

  // The other direction: `invitee_email` is then the VIEWER's own mailbox, so showing it
  // would label the friend with the viewer's address.
  it('never labels a friend with the viewer\'s own address', async () => {
    state.selectRows = [{
      ...ACCEPTED_LINK,
      inviter_id: 'friend-2',
      accepted_by: 'owner-1',
      invitee_email: 'owner@example.com',
    }];
    tracedInvokeMock.mockResolvedValue({ data: null, error: new Error('down') });
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await waitFor(() => expect(result.current.friends).toHaveLength(1));
    expect(result.current.friends[0].label).toBe('A Forgenta member');
    expect(result.current.friends[0].userId).toBe('friend-2');
  });

  it('makes no status call at all when there are no friends to name', async () => {
    const { result } = renderHook(() => useFriendLink(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.friends).toEqual([]);
    expect(tracedInvokeMock).not.toHaveBeenCalled();
  });
});

// ── The card, actually rendered ──────────────────────────────────────────────
// A green build says it compiled. These say what a person sees in each state.

const PENDING_ROW = {
  id: 'link-p',
  inviter_id: 'owner-1',
  invitee_email: 'invited@example.com',
  expires_at: '2026-09-02T12:00:00Z',
  accepted_by: null,
  accepted_at: null,
  revoked_at: null,
  created_at: '2026-08-26T00:00:00Z',
};

function renderCard(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/settings${search}`]}>
      <QueryClientProvider client={client}><FriendLink /></QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the Settings card, rendered', () => {
  // ⚠️ THIS BLOCK PINS THE CLOCK, AND IT MUST. `PENDING_ROW` carries a FIXED
  // `expires_at`, and the card hides an invite once it has expired - so against the
  // real clock these cases passed until that timestamp and then failed forever. It
  // went off on 2026-09-02 at 12:00Z, three weeks after it was written, in a test
  // that has nothing to do with dates. Freezing the clock is the fix; pushing the
  // date out to 2099 would only reset the fuse.
  // `toFake: ['Date']` and not the timers: testing-library's findBy* waits on real
  // timers, and faking those deadlocks every async assertion in here.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('says plainly that it has no friends yet, and offers both ways in', async () => {
    renderCard();
    expect(await screen.findByText('No friends yet.')).toBeTruthy();
    expect(screen.getByPlaceholderText("Friend's email address")).toBeTruthy();
    expect(screen.getByText('Send Invite')).toBeTruthy();
    expect(screen.getByText('Accept Invite')).toBeTruthy();
    // Free tier: no upgrade wall anywhere on this card.
    expect(screen.queryByText(/Premium/i)).toBeNull();
    expect(screen.queryByText(/Upgrade/i)).toBeNull();
    // And the promise the card makes about what a friend can see.
    expect(screen.getByText(/never see your budget/i)).toBeTruthy();
  });

  it('shows a friend by name and a sent invite with its expiry', async () => {
    state.selectRows = [ACCEPTED_LINK, PENDING_ROW];
    tracedInvokeMock.mockResolvedValue({
      data: { friends: [{ link_id: 'link-1', user_id: 'friend-2', display_name: 'Sam' }], pending: [] },
      error: null,
    });
    renderCard();
    expect(await screen.findByText('Sam')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
    expect(screen.getByText('Invite sent to invited@example.com')).toBeTruthy();
    expect(screen.getByText(/Expires Sep \d, 2026/)).toBeTruthy();
    expect(screen.getByText('Cancel invite')).toBeTruthy();
    expect(screen.queryByText('No friends yet.')).toBeNull();
  });

  it('pre-fills the code from the invite email\'s link', async () => {
    renderCard('?friend_code=ABC123abc123ABC123abc1');
    const field = await screen.findByPlaceholderText(/Have a friend invite code/) as HTMLInputElement;
    expect(field.value).toBe('ABC123abc123ABC123abc1');
  });

  // A card that could not read the list must say so, not render the empty state over
  // an unknown truth.
  it('says it could not load rather than showing an empty friends list', async () => {
    state.selectError = { message: 'permission denied' };
    renderCard();
    expect(await screen.findByText('Could not load your friends.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('No friends yet.')).toBeNull();
    expect(screen.queryByText('Send Invite')).toBeNull();
  });
});

describe('the hook is never lensed — a friend is not a partner', () => {
  it('reads the authed user and nothing else', () => {
    expect(hookCode).not.toContain('viewedUserId');
    expect(hookCode).not.toContain('ViewedProfile');
    expect(hookCode).not.toContain('switchBack');
    expect(hookCode).toContain("useAuth();");
    // Both reads are keyed by the authed user's id.
    expect(hookCode).toContain("`inviter_id.eq.${user.id},accepted_by.eq.${user.id}`");
    // And the component that renders it has no lens either.
    expect(codeOnly(componentSrc)).not.toContain('viewedUserId');
  });

  it('selects explicit columns, never the hash and never a star', () => {
    expect(hookCode).not.toContain("select('*')");
    expect(hookCode).not.toContain('invite_code_hash');
    expect(hookSrc).toContain(
      "'id, inviter_id, invitee_email, expires_at, accepted_by, accepted_at, revoked_at, created_at'",
    );
  });

  it('is mounted in Settings beside the partner card, and the card is free-tier', () => {
    expect(settingsSrc).toContain("import { FriendLink } from '@/components/settings/FriendLink';");
    expect(settingsSrc).toContain('<FriendLink />');
    // No premium gate on the card: the cap is the function's, so the number lives once.
    expect(componentSrc).not.toContain('useSubscription');
    expect(componentSrc).not.toContain('isPremium');
  });
});

// ── The pure half of the Edge Function, executed ─────────────────────────────

const NOW = Date.parse('2026-08-26T12:00:00Z');
const LIVE = '2026-09-01T00:00:00Z';
const DEAD = '2026-08-01T00:00:00Z';

function pending(id: string, email: string, expires = LIVE, inviter = 'owner-1'): LiveLinkRow {
  return {
    id, inviter_id: inviter, invitee_email: email,
    accepted_at: null, accepted_by: null, expires_at: expires,
  };
}
function friend(id: string, email: string, other = 'friend-2', inviter = 'owner-1'): LiveLinkRow {
  return {
    id, inviter_id: inviter, invitee_email: email,
    accepted_at: '2026-08-20T00:00:00Z',
    accepted_by: inviter === 'owner-1' ? other : 'owner-1',
    expires_at: DEAD,
  };
}

describe('the free-tier cap (plan §4)', () => {
  it('is five, and premium is uncapped', () => {
    expect(FREE_TIER_FRIEND_CAP).toBe(5);
    expect(capFor(false)).toBe(5);
    expect(capFor(true)).toBe(Infinity);
    expect(rulesSrc).toContain('export const FREE_TIER_FRIEND_CAP = 5;');
  });

  it('counts friendships and outstanding invites together', () => {
    const rows = [
      friend('a', 'a@example.com', 'u-a'),
      friend('b', 'b@example.com', 'u-b'),
      pending('c', 'c@example.com'),
    ];
    const slots = summarizeInviteSlots(rows, 'owner-1', 'new@example.com', NOW);
    expect(slots).toMatchObject({ activeFriends: 2, outstandingInvites: 1, used: 3 });
    expect(slots.used < capFor(false)).toBe(true);
  });

  it('blocks the sixth and lets premium through', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((k) => friend(k, `${k}@example.com`, `u-${k}`));
    const slots = summarizeInviteSlots(rows, 'owner-1', 'new@example.com', NOW);
    expect(slots.used).toBe(5);
    expect(slots.used >= capFor(false)).toBe(true);
    expect(slots.used >= capFor(true)).toBe(false);
  });

  it('counts a friendship somebody else started — the cap is friendships, not invites sent', () => {
    const inbound: LiveLinkRow = {
      id: 'x', inviter_id: 'friend-2', invitee_email: 'owner@example.com',
      accepted_at: '2026-08-20T00:00:00Z', accepted_by: 'owner-1', expires_at: DEAD,
    };
    expect(summarizeInviteSlots([inbound], 'owner-1', 'new@example.com', NOW).used).toBe(1);
  });

  it('does not charge a slot for an invite somebody else sent to somebody else', () => {
    // Not reachable through RLS, but the summary must not count a row it does not own.
    const foreign = pending('f', 'other@example.com', LIVE, 'stranger-9');
    expect(summarizeInviteSlots([foreign], 'owner-1', 'new@example.com', NOW).used).toBe(0);
  });

  it('does not count an EXPIRED invite — it is neither a friend nor a live invite', () => {
    const rows = [pending('a', 'a@example.com', DEAD), pending('b', 'b@example.com', LIVE)];
    expect(summarizeInviteSlots(rows, 'owner-1', 'new@example.com', NOW).used).toBe(1);
  });
});

describe('supersede — one outstanding invite per (inviter, mailbox)', () => {
  it('supersedes this caller\'s own pending row for this mailbox, and only that one', () => {
    const rows = [
      pending('same', 'Friend@Example.com'),
      pending('other', 'other@example.com'),
      pending('theirs', 'friend@example.com', LIVE, 'stranger-9'),
    ];
    const slots = summarizeInviteSlots(rows, 'owner-1', 'friend@example.com', NOW);
    // Case-insensitive on both sides — the column has a lowercase CHECK, the caller does not.
    expect(slots.supersedeIds).toEqual(['same']);
    // And re-inviting the same address does not consume a second slot.
    expect(slots.used).toBe(1);
  });

  it('supersedes an EXPIRED row too — it still holds the unique pending slot', () => {
    const slots = summarizeInviteSlots(
      [pending('old', 'friend@example.com', DEAD)], 'owner-1', 'friend@example.com', NOW,
    );
    expect(slots.supersedeIds).toEqual(['old']);
    expect(slots.used).toBe(0);
  });

  it('reports an existing friendship with that mailbox instead of inviting again', () => {
    const slots = summarizeInviteSlots(
      [friend('a', 'friend@example.com')], 'owner-1', 'FRIEND@example.com', NOW,
    );
    expect(slots.alreadyFriends).toBe(true);
    expect(slots.supersedeIds).toEqual([]);
  });

  it('knows an existing friendship by user id, from either direction', () => {
    expect(isFriendOf([friend('a', 'f@example.com', 'friend-2')], 'owner-1', 'friend-2')).toBe(true);
    const inbound: LiveLinkRow = {
      id: 'x', inviter_id: 'friend-2', invitee_email: 'owner@example.com',
      accepted_at: '2026-08-20T00:00:00Z', accepted_by: 'owner-1', expires_at: DEAD,
    };
    expect(isFriendOf([inbound], 'owner-1', 'friend-2')).toBe(true);
    expect(isFriendOf([inbound], 'owner-1', 'stranger-9')).toBe(false);
    // A pending invite is not a friendship.
    expect(isFriendOf([pending('p', 'f@example.com')], 'owner-1', 'friend-2')).toBe(false);
  });
});

describe('the masked-name fallback', () => {
  it('keeps the first and last character of the local part only', () => {
    expect(maskEmailLocal('tre@example.com')).toBe('t***e');
    expect(maskEmailLocal('Tre.Forged@Example.com')).toBe('t***d');
  });

  it('never reveals a short local part in full, and never the domain', () => {
    expect(maskEmailLocal('ab@example.com')).toBe('a***');
    expect(maskEmailLocal('a@example.com')).toBe('a***');
    for (const email of ['tre@example.com', 'ab@example.com', '@example.com']) {
      expect(maskEmailLocal(email)).not.toContain('@');
      expect(maskEmailLocal(email)).not.toContain('example.com');
    }
  });
});

// ── The Edge Function's disciplines, locked as source ────────────────────────

const inviteSrc = fnSrc.slice(
  fnSrc.indexOf('async function handleInvite'),
  fnSrc.indexOf('interface AcceptCandidate'),
);
const acceptSrc = fnSrc.slice(
  fnSrc.indexOf('async function handleAccept'),
  fnSrc.indexOf('interface FriendSummary'),
);
const statusSrc = fnSrc.slice(
  fnSrc.indexOf('async function handleStatus'),
  fnSrc.indexOf('// ── Entry point'),
);

describe('edge function: invite is not an account-existence oracle', () => {
  // The strongest form of the property: there is no lookup to branch on. Every decision
  // the invite handler makes comes from THIS CALLER'S OWN rows, filtered in memory.
  it('never queries a table by the invited address', () => {
    expect(fnSrc).not.toMatch(/\.eq\(\s*["']email["']/);
    expect(fnSrc).not.toMatch(/\.eq\(\s*["']invitee_email["']/);
    expect(fnSrc).not.toMatch(/\.ilike\(/);
    expect(fnSrc).not.toContain('listUsers');
    expect(fnSrc).not.toContain('getUserByEmail');
    expect(fnSrc).not.toContain('admin.generateLink');
  });

  it('has exactly one success return in the invite handler', () => {
    expect([...inviteSrc.matchAll(/ok: true/g)]).toHaveLength(1);
  });

  it('refuses a self-invite', () => {
    expect(inviteSrc).toContain('inviteeEmail === normalizeEmail(userEmail)');
  });

  // Discipline #4: "sent" must never mean "maybe sent".
  it('revokes the invite row and reports failure when the email does not go out', () => {
    expect(inviteSrc).toContain('if (!sent) {');
    expect(inviteSrc).toContain('Could not send the invite email. Please try again.');
    const rollbackAt = inviteSrc.indexOf('rollback of unsent invite failed');
    const successAt = inviteSrc.indexOf('ok: true');
    expect(rollbackAt).toBeGreaterThan(-1);
    expect(rollbackAt).toBeLessThan(successAt);
  });

  // A DB error must never read as "no friends, no invites" and let the cap through.
  it('treats a failed link read as an error, not as an empty list', () => {
    expect(fnSrc).toContain('if (live === undefined) {');
    expect(inviteSrc).toContain('Something went wrong. Please try again.');
    expect(rulesSrc).toContain('export function summarizeInviteSlots(');
  });
});

describe('edge function: the free-tier cap is enforced in the invite handler', () => {
  it('checks the cap before it writes anything', () => {
    const capAt = inviteSrc.indexOf('slots.used >= FREE_TIER_FRIEND_CAP');
    const insertAt = inviteSrc.indexOf('.insert({');
    const supersedeAt = inviteSrc.indexOf('.in("id", slots.supersedeIds)');
    expect(capAt).toBeGreaterThan(-1);
    expect(supersedeAt).toBeGreaterThan(capAt);
    expect(insertAt).toBeGreaterThan(supersedeAt);
    expect(inviteSrc).toContain('capFor(isPremium)');
  });

  // A subscription read that fell over must not be reported as "you are not premium" —
  // and it is only read AT the cap, so a free invite never fails for that reason.
  it('separates "could not check your subscription" from the cap message', () => {
    expect(inviteSrc).toContain('Could not check your subscription. Please try again.');
    expect(inviteSrc).toContain(
      'Free accounts can have ${FREE_TIER_FRIEND_CAP} friends',
    );
    expect(inviteSrc.indexOf('readIsPremium(')).toBeGreaterThan(
      inviteSrc.indexOf('slots.used >= FREE_TIER_FRIEND_CAP'),
    );
  });

  it('refuses a duplicate friendship at invite time rather than at accept time', () => {
    expect(inviteSrc).toContain('if (slots.alreadyFriends) {');
    expect(inviteSrc).toContain("You're already friends with them.");
  });
});

describe('edge function: accept answers every failure identically', () => {
  it('routes every rejection through one deny() with one body and one status', () => {
    expect([...acceptSrc.matchAll(/That invite code isn't valid\./g)]).toHaveLength(1);
    expect([...acceptSrc.matchAll(/return json\(/g)]).toHaveLength(2); // deny() + the success
    expect(acceptSrc).toContain('return json({ error: "That invite code isn\'t valid." }, 404, corsHeaders);');
    const denials = [...acceptSrc.matchAll(/return deny\(/g)];
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
      'already_friends',
      'accept_race_lost',
    ]) {
      expect(acceptSrc).toContain(`deny("${reason}")`);
    }
  });

  it('walls it with an exact hash match on a pending, unrevoked row', () => {
    expect(acceptSrc).toContain('.eq("invite_code_hash", inviteCodeHash)');
    expect(acceptSrc).toContain('.is("accepted_at", null)');
    expect(acceptSrc).toContain('.is("revoked_at", null)');
  });

  it('checks expiry, mailbox ownership, self-accept and duplication before writing consent', () => {
    const writeAt = acceptSrc.indexOf('.update({ accepted_by: userId');
    for (const guard of [
      'Date.parse(link.expires_at) <= Date.now()',
      'normalizeEmail(userEmail) !== link.invitee_email',
      'link.inviter_id === userId',
      'if (isFriendOf(live, userId, link.inviter_id)) return deny("already_friends")',
    ]) {
      const at = acceptSrc.indexOf(guard);
      expect(at, guard).toBeGreaterThan(-1);
      expect(at, guard).toBeLessThan(writeAt);
    }
  });

  // Two accepts of one code must not both win.
  it('re-asserts "still pending" inside the UPDATE and denies on a zero-row result', () => {
    const update = acceptSrc.slice(acceptSrc.indexOf('.update({ accepted_by: userId'));
    expect(update).toContain('.is("accepted_at", null)');
    expect(update).toContain('.is("revoked_at", null)');
    expect(update).toContain('if (!accepted) return deny("accept_race_lost")');
  });
});

describe('edge function: nothing leaks the code, the hash, or an address', () => {
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

  it('sends the code over exactly one wire, and that wire is the mailer', () => {
    const fetches = [...fnSrc.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    expect(fetches).toEqual(['https://api.resend.com/emails']);
    expect([...fnSrc.matchAll(/generateInviteCode\(\)/g)]).toHaveLength(1);
    expect(fnSrc).toContain('const sent = await sendInviteEmail(inviteeEmail, inviterName, code);');
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
    expect(tail).toContain('console.error("friend-link error:", error)');
    expect(tail).not.toContain('error.message');
    expect(tail).toContain('Something went wrong. Please try again.');
  });

  it('never selects the hash column into the function at all', () => {
    expect(fnSrc).not.toMatch(/\.select\([^)]*invite_code_hash/);
  });

  // invite-code.ts is a COPY of partner-link's, not an import of it, so the two can drift.
  // What must never drift is behaviour: same entropy, same shape gate, same hash, same
  // email normalization. A code minted by one must be a code the other would recognise.
  it('mints and hashes codes identically to the partner-link primitives', async () => {
    expect(friendCode.INVITE_CODE_BYTES).toBe(partnerCode.INVITE_CODE_BYTES);
    expect(friendCode.INVITE_CODE_LENGTH).toBe(partnerCode.INVITE_CODE_LENGTH);

    const minted = friendCode.generateInviteCode();
    expect(minted).toHaveLength(22);
    expect(minted).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(friendCode.isPlausibleInviteCode(minted)).toBe(true);
    expect(partnerCode.isPlausibleInviteCode(minted)).toBe(true);
    for (const bad of ['', 'abc', 'a'.repeat(21), `${'a'.repeat(21)}=`, "' or 1=1 --xxxxxxxxxxxxx"]) {
      expect(friendCode.isPlausibleInviteCode(bad), bad).toBe(false);
      expect(partnerCode.isPlausibleInviteCode(bad), bad).toBe(false);
    }

    // The published SHA-256 vector for "abc", from both.
    expect(await friendCode.hashInviteCode('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await friendCode.hashInviteCode(minted)).toBe(await partnerCode.hashInviteCode(minted));
    expect(await friendCode.hashInviteCode(minted)).not.toBe(minted);

    expect(friendCode.normalizeEmail('  Friend@Example.COM '))
      .toBe(partnerCode.normalizeEmail('  Friend@Example.COM '));
  });

  // A cheap tripwire for the failure that matters: a generator that stops being random.
  it('never repeats a code across 2000 draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(friendCode.generateInviteCode());
    expect(seen.size).toBe(2000);
  });
});

describe('edge function: the guards, the reach, and the lens that does not exist', () => {
  it('rate limits by IP before it looks at the JWT, then per user per action', () => {
    const rateLimitAt = fnSrc.indexOf('await checkRateLimit(supabase, `${ip}:friend-link`');
    const authAt = fnSrc.indexOf('userClient.auth\n      .getUser()');
    expect(rateLimitAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(rateLimitAt).toBeLessThan(authAt);
    expect(fnSrc).toContain('`${userId}:friend-link:${body.action}`');
    expect(fnSrc).toContain('INVITE_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 5 }');
    expect(fnSrc).toContain('ACCEPT_RATE_LIMIT: RateLimitConfig = { windowMs: HOUR_MS, max: 5 }');
  });

  it('takes the user id and email only from the verified user, never from the body', () => {
    expect(fnSrc).toContain('const userId = authUser.id;');
    expect(fnSrc).toContain('const userEmail = authUser.email ?? "";');
    expect(fnSrc).not.toMatch(/body\.(user_id|userId|email_of|inviter)/);
  });

  // Plan §2: there is no path from a friendship to a table that holds money, and this is
  // where a future refactor would most plausibly open one.
  it('reads only friend_links, profiles and user_subscriptions', () => {
    const tables = [...fnSrc.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(3);
    expect([...new Set(tables)].sort()).toEqual(['friend_links', 'profiles', 'user_subscriptions']);
  });

  it('has no revoke action — unfriending is a direct RLS-scoped UPDATE by design', () => {
    expect(fnSrc).not.toContain('"revoke"');
    expect(fnSrc).not.toContain('handleRevoke');
  });

  it('reports pending invites only for invites this caller sent', () => {
    expect(statusSrc).toContain('row.inviter_id === userId');
    expect(statusSrc).not.toMatch(/\.eq\(\s*["']invitee_email["']/);
  });

  it('imports exactly the shared modules partner-link does, and they exist', () => {
    const specifiers = [...fnSrc.matchAll(/from "(\.\.?\/[^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.sort()).toEqual([
      '../_shared/cors.ts',
      '../_shared/rate-limit.ts',
      '../_shared/tracer.ts',
      './invite-code.ts',
      './link-rules.ts',
    ]);
    for (const spec of specifiers) {
      const abs = resolve(here, '../../../supabase/functions/friend-link', spec);
      expect(existsSync(abs), abs).toBe(true);
    }
  });

  it('is declared in config.toml with verify_jwt = true — an undeclared function is silently flipped', () => {
    expect(configSrc).toMatch(/\[functions\.friend-link\]\r?\nverify_jwt = true/);
  });
});
