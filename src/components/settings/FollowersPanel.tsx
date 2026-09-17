/**
 * FollowersPanel – UI for managing followers and followings.
 *
 * This component shows:
 *  • A search box to find a user by username and request to follow them.
 *  • Incoming follow requests (approve/decline).
 *  • Current followers (remove).
 *  • Users you follow and outgoing requests (unfollow/cancel).
 *
 * NAMES come from `follow_profiles()` - a SECURITY DEFINER RPC that returns a name only for
 * somebody you already have a `follows` row with, so it adds a name to an id you can already
 * see and cannot be used to enumerate anyone. Where no name exists the row falls back to
 * "A Forgenta member #<8 chars>", which is honest; a bare uuid or an invented name would both
 * be worse.
 */
import { useState, type FormEvent } from 'react';
import {
  useFollows,
  type FoundProfile,
} from '@/hooks/useFollows';
import { UserPlus, Check, X, AtSign } from 'lucide-react';
import { AccountVisibilityToggle } from './AccountVisibilityToggle';
import { LeaderboardShareToggles } from './LeaderboardShareToggles';
import { FriendLink } from './FriendLink';
import { FIELD_WRAPPER, FIELD_INPUT_BARE, FIELD_RADIUS } from '@/components/shared/field-classes';

interface FollowersPanelProps {
  /** The signed‑in user's id, so a self‑follow can be refused before the server has to. */
  currentUserId: string | undefined;
}

/*
 * There is deliberately NO getOtherId(row, listName) helper. One was written and never called:
 * each section already reads the correct field directly - `follower_id` where I am the followee
 * (followers, requests) and `followee_id` where I am the follower (following, requested) - and a
 * helper keyed on a list-NAME string is less clear than the field, not more, because it moves the
 * fact you need to check one level away from where you read it.
 */

export function FollowersPanel({ currentUserId }: FollowersPanelProps) {
  const {
    following,
    followers,
    incomingRequests,
    outgoingRequests,
    isLoading,
    requestFollow,
    approveRequest,
    removeFollow,
    findByUsername,
    labelFor,
  } = useFollows();

  const [username, setUsername] = useState('');
  const [foundProfile, setFoundProfile] = useState<FoundProfile | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [findMessage, setFindMessage] = useState<string | null>(null);

  const handleFind = async (e: FormEvent) => {
    e.preventDefault();
    setFindError(null);
    setFindMessage(null);
    setFoundProfile(null);
    try {
      const result = await findByUsername(username.trim());
      if (!result) {
        setFindMessage('No account with that username.');
        return;
      }
      setFoundProfile(result);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setFindError(msg);
    }
  };

  /** Determine if a profile is already followed, pending, or is the current user. */
  const getFollowState = (profile: FoundProfile) => {
    if (currentUserId && profile.user_id === currentUserId) {
      return { disabled: true, reason: 'You cannot follow yourself.' };
    }
    if (following.some((r) => r.followee_id === profile.user_id)) {
      return { disabled: true, reason: 'Already following.' };
    }
    if (
      outgoingRequests.some((r) => r.followee_id === profile.user_id)
    ) {
      return { disabled: true, reason: 'Follow request pending.' };
    }
    return { disabled: false, reason: '' };
  };

  return (
    <div className="card-forged p-5 space-y-5">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Followers
      </h2>

      {/*
        ⚠️ IT LIVES HERE AND NOT IN THE CONNECTIONS CARD, AND A GATE IS WHY. It was first mounted
        inside `FriendLink`, beside the sharing toggles - which reads well and is wrong: that
        component is contractually DB-FREE, and its own test throws if it queries at all. Mounting
        a child that reads `profiles` broke that contract, and four suites went red saying so.

        Here it is correct rather than merely tolerated: this panel already queries the follow
        graph, and public-or-private is the rule that decides what every control BELOW it does -
        whether a press sends a request or follows immediately. It is the first thing on the
        surface it governs.
      */}
      <AccountVisibilityToggle />

      {/* Find someone */}
      <section>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Find someone
        </h3>
        <form onSubmit={handleFind} className="flex items-center gap-2">
          {/*
            ⚠️ THE SAME SHAPE AS `UsernameClaim`'s FIELD, DELIBERATELY - wrapper plus a bare input,
            both from `field-classes.ts`. It IS a username field, so it should look like the one
            the user has already met, and this reuses two existing surface signatures rather than
            inventing a third.

            THE STYLE RATCHET IS WHAT FOUND THIS, and the way it found it is worth recording: a
            first attempt used the canonical constant as `className={FIELD_INPUT}`, which is the
            right STYLE, and the gate still counted a 37th surface. It signs a call site by the
            EXPRESSION FORM (`VAR:FIELD_INPUT`), so a shared constant used in a syntactic form no
            other call site uses reads as a new style. That is a real blind spot in the gate -
            written down here rather than worked around by raising the ceiling, which is the one
            thing a ratchet must never absorb quietly.
          */}
          <div className={`${FIELD_WRAPPER} px-2 py-1.5`} style={FIELD_RADIUS}>
            <AtSign size={12} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              placeholder="username"
              aria-label="Find someone by username"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={FIELD_INPUT_BARE}
            />
          </div>
          <button
            type="submit"
            className="btn btn-sm btn-primary shrink-0"
            style={FIELD_RADIUS}
          >
            Find
          </button>
        </form>
        {findError && (
          <p className="mt-1 text-sm text-destructive">{findError}</p>
        )}
        {findMessage && (
          <p className="mt-1 text-sm text-muted-foreground">{findMessage}</p>
        )}
        {foundProfile && (
          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap min-w-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-medium">{foundProfile.username}</span>
              {foundProfile.display_name && (
                <span className="text-muted-foreground">
                  ({foundProfile.display_name})
                </span>
              )}
              <span className="px-1 py-0.5 text-xs bg-muted text-muted-foreground rounded">
                {foundProfile.visibility === 'public' ? 'Public' : 'Private'}
              </span>
            </div>
            <button
              className="btn btn-sm btn-primary"
              style={{ borderRadius: 'var(--radius)' }}
              onClick={() => requestFollow(foundProfile.user_id)}
              disabled={getFollowState(foundProfile).disabled}
            >
              <UserPlus size={13} />
              Follow
            </button>
            {getFollowState(foundProfile).disabled && (
              <p className="text-sm text-muted-foreground">
                {getFollowState(foundProfile).reason}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Loading state */}
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <>
          {/* Requests */}
          {incomingRequests.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Requests
              </h3>
              {incomingRequests.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 flex-wrap min-w-0"
                >
                  <span className="truncate">
                    {labelFor(row.follower_id)}
                  </span>
                  <div className="flex gap-1">
                    <button
                      className="btn btn-sm btn-primary"
                      style={{ borderRadius: 'var(--radius)' }}
                      onClick={() => approveRequest(row.id)}
                    >
                      <Check size={13} />
                      Approve
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ borderRadius: 'var(--radius)' }}
                      onClick={() => removeFollow(row.id)}
                    >
                      <X size={13} />
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Followers */}
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Followers
            </h3>
            {followers.length === 0 ? (
              <p className="text-muted-foreground">
                Nobody is following you yet.
              </p>
            ) : (
              followers.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 flex-wrap min-w-0"
                >
                  <span className="truncate">
                    {labelFor(row.follower_id)}
                  </span>
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ borderRadius: 'var(--radius)' }}
                    onClick={() => removeFollow(row.id)}
                  >
                    <X size={13} />
                    Remove
                  </button>
                </div>
              ))
            )}
          </section>

          {/* Following */}
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Following
            </h3>
            {following.length === 0 && outgoingRequests.length === 0 ? (
              <p className="text-muted-foreground">
                You are not following anyone yet.
              </p>
            ) : (
              <>
                {following.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 flex-wrap min-w-0"
                  >
                    <span className="truncate">
                      {labelFor(row.followee_id)}
                    </span>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ borderRadius: 'var(--radius)' }}
                      onClick={() => removeFollow(row.id)}
                    >
                      <X size={13} />
                      Unfollow
                    </button>
                  </div>
                ))}
                {outgoingRequests.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 flex-wrap min-w-0 opacity-50"
                  >
                    <span className="truncate">
                      {labelFor(row.followee_id)} (Requested)
                    </span>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ borderRadius: 'var(--radius)' }}
                      onClick={() => removeFollow(row.id)}
                    >
                      <X size={13} />
                      Cancel
                    </button>
                  </div>
                ))}
              </>
            )}
          </section>
        </>
      )}
      {/*
        ⚠️ THE LEGACY FRIEND-INVITE PATH, KEPT REACHABLE ON PURPOSE - AND ON THIS TAB, which is
        what "it should only be on that tab" asks for.

        Tre, 2026-09-17: "friends should be followers and following just like instagram." Follows
        are now the social graph and `active_friend_ids()` reads MUTUAL FOLLOWS, so nothing new
        needs this. But the `friend-link` function emails an accept URL that lands on
        `/account?friend_code=...`, and `FriendLink` is the component that READS that parameter.
        Unmounting it would make every outstanding invite silently do nothing - a link that
        looks fine and is dead, which is the failure mode this repo refuses everywhere else.

        ⚠️ I COULD NOT MEASURE HOW MANY INVITES ARE OUTSTANDING - the query was blocked mid-task -
        so this is the CONSERVATIVE reading rather than a measured one, and it is cheap to undo.
        Invites expire after 7 days. Once the newest outstanding one has expired, this mount and
        the whole friend-link flow can go; `active_friend_ids()` keeps honouring already-accepted
        links server-side either way, so no existing friendship is lost by removing it.
      */}
      <div className="space-y-2 pt-1 border-t border-border/60">
        <FriendLink />
      </div>

      {/*
        ⚠️ MOVED HERE FROM THE CONNECTIONS CARD (Tre, 2026-09-17: "it should only be on that
        tab"). These publish a figure to the people you are mutually followed by, so they belong
        on the surface that shows who those people are, not two sections away from it.

        ⚠️ AND THE HEADING SAYS **FOLLOW BACK** ON PURPOSE. A one-directional follower sees
        nothing: `active_friend_ids()` requires the follow to go BOTH ways. "What followers can
        see" would be false, and falsely alarming - it would tell somebody with a public account
        that every stranger who followed them could read their money.
      */}
      <div className="space-y-2 pt-1 border-t border-border/60">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          What people you follow back can see
        </h3>
        <LeaderboardShareToggles />
      </div>

    </div>
  );
}

export default FollowersPanel;
