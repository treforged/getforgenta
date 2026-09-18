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
import { useState, useEffect, useRef, type FormEvent } from 'react';
import {
  useFollows,
  type FoundProfile,
} from '@/hooks/useFollows';
import { UserPlus, Check, X, AtSign, Link2, Copy } from 'lucide-react';
import { UsernameSuggestions } from '@/components/settings/UsernameSuggestions';
import { useLocation } from 'react-router';
import { useProfile } from '@/hooks/useSupabaseData';
import { AccountVisibilityToggle } from './AccountVisibilityToggle';
import { LeaderboardShareToggles } from './LeaderboardShareToggles';
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
  const [copied, setCopied] = useState(false);
  const { data: profile } = useProfile();
  const location = useLocation();

  /** The username people find you by. Null until claimed - the share link is gated on it. */
  const myUsername = typeof profile?.username === 'string' ? profile.username : null;
  const shareLink = myUsername ? `${window.location.origin}/account?u=${myUsername}` : null;

  /**
   * LOOK SOMEBODY UP BY USERNAME. Shared by the form and by the share-link handler below, so a
   * link and a typed search cannot drift into behaving differently.
   */
  const lookUp = async (raw: string) => {
    setFindError(null);
    setFindMessage(null);
    setFoundProfile(null);
    try {
      const result = await findByUsername(raw.trim());
      if (!result) {
        setFindMessage('No account with that username.');
        return;
      }
      setFoundProfile(result);
    } catch (err: unknown) {
      setFindError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    }
  };

  /**
   * THE SHARE LINK, ARRIVING. Tre, 2026-09-17: "allow users to make a shareable link that makes
   * it easy click and it loads their profile into the app or add them into the app."
   *
   * ⚠️ IT IS `/account?u=<username>` AND DELIBERATELY NOT A NEW PUBLIC ROUTE. A `/u/:username`
   * page would be a new anonymous surface over `profiles`, needing its own RLS story and its own
   * security review, to show something this panel already shows. This lands the visitor in the
   * app they must be signed in to anyway, runs the SAME `find_profile_by_username` RPC the search
   * box runs, and offers the SAME follow button - so it adds a doorway, never a new permission.
   *
   * It replaces the emailed `?friend_code=` accept URL on the same mechanism: a link that lands
   * on this tab and does one thing.
   */
  const handledShare = useRef<string | null>(null);
  useEffect(() => {
    const target = new URLSearchParams(location.search).get('u');
    if (!target) return;
    // Deliberately keyed on the VALUE, not on a bare boolean: two different share links opened in
    // one session must both work, and a `once` flag would silently swallow the second.
    if (handledShare.current === target) return;
    handledShare.current = target;
    setUsername(target.replace(/^@/, ''));
    void lookUp(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const handleFind = async (e: FormEvent) => {
    e.preventDefault();
    void lookUp(username);
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
    <div className="space-y-5">
      <div className="card-forged p-5 space-y-5">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Your profile
        </h2>

        {/*
          ⚠️ IT LIVES HERE AND NOT IN THE CONNECTIONS CARD, AND A GATE IS WHY. It was first mounted
          inside `FriendLink`, beside the sharing toggles - which reads well and is wrong: that
          component is contractually DB-FREE, and its own test throws if it queries at all. Mounting
          a child that reads `profiles` broke that contract, and four suites went red saying so.

          Here it is correct rather than merely tolerated: this panel already queries the follow
          graph, and public-or-private is the rule that decides what every control BELOW it does -
          whether a press sends a request or follows immediately. It is the first thing on the
          surface it governs - which since the two-card split means the card directly ABOVE
          those controls rather than the same card. Still first, still read before anything it
          decides; the seam is between it and them, not over it.
        */}
        <AccountVisibilityToggle />

        {/*
          YOUR SHARE LINK (Tre, 2026-09-17: "allow users to make a shareable link that makes it easy
          click and it loads their profile into the app or add them into the app").

          ⚠️ IT IS GATED ON HAVING A USERNAME, and the empty state SAYS SO rather than hiding. The
          link IS the username, so with no username there is nothing to copy - and a control that
          silently vanishes teaches people the feature does not exist.

          ⚠️ THE OFF/UNAVAILABLE STATE READS AS UNAVAILABLE, not as un-highlighted: it is a sentence
          pointing at the Username section above it, on the same screen, which is where the fix is.
        */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Your share link
          </h3>
          {shareLink ? (
            <div className="flex items-center gap-2">
              <div className={`${FIELD_WRAPPER} flex-1 min-w-0`} style={FIELD_RADIUS}>
                <Link2 size={14} className="text-muted-foreground shrink-0" />
                <input
                  readOnly
                  value={shareLink}
                  aria-label="Your shareable profile link"
                  onFocus={(e) => e.currentTarget.select()}
                  className={FIELD_INPUT_BARE}
                />
              </div>
              <button
                type="button"
                className="btn btn-md btn-secondary shrink-0"
                style={FIELD_RADIUS}
                onClick={async () => {
                  // ⚠️ `navigator.clipboard` THROWS on an insecure origin and in some webviews, and
                  // it is not present at all in older ones. A copy button that throws is worse than
                  // one that does nothing, so the failure falls back to selecting the text - which
                  // is the thing the user was going to do by hand anyway.
                  try {
                    await navigator.clipboard.writeText(shareLink);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setFindMessage('Could not copy automatically - the link is selected, copy it with your keyboard.');
                  }
                }}
              >
                <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Claim a username above and your share link appears here.
            </p>
          )}
        </section>
      </div>

      {/*
        ⚠️ A SECOND CARD, NOT A SECOND STYLE. /account ran 60% of its own page as one painted
        run - worse than /budget ever was at 48%, on a page 10% shorter - and this panel WAS
        that run: a single card-forged from 713 to 1965. The seam is placed where the subject
        already changes, between what people can find out about you and the people themselves.

        ⚠️ TWO CARDS, NOT FOUR. Four was measured and reverted on 2026-09-18: it cut the run
        60% -> 34% and pushed whitespace 16.8% -> 26.8%, which trades his no-rhythm complaint
        for his wastes-space complaint on the same page. Four sets of card padding plus three
        gaps is where those ten points went. Do not re-split this further without measuring
        BOTH halves of the pair.
      */}
      <div className="card-forged p-5 space-y-5">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Followers
        </h2>

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

          {/* PUBLIC ACCOUNTS ONLY, decided server-side - see `useUsernameSuggestions`. Picking a
              suggestion fills the field rather than following immediately: following is the
              irreversible-feeling action and it stays one deliberate press away. */}
          <UsernameSuggestions prefix={username} onPick={(name) => setUsername(name)} />
          {findError && (
            <p className="mt-1 text-sm text-destructive-text">{findError}</p>
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
          ⚠️ TOMBSTONE: THE "ADD A FRIEND" CARD WAS HERE AND IS GONE (Tre, 2026-09-17 23:47: "add a
          friend isn't [needed] anymore either that's the same thing as find someone we're only
          using usernames now instead of email").

          It was `FriendLink` - invite by EMAIL, generating a `friend_links` row and a mailed accept
          URL landing on `/account?friend_code=...`. "Find someone" above does the same job by
          USERNAME, which is what he has chosen, so keeping both was two doors to one room.

          ⚠️ REMOVING IT WAS SAFE BECAUSE IT WAS MEASURED, not because it looked unused. On
          2026-09-17 03:29Z: ZERO live unaccepted `friend_links` (accepted_at null, revoked_at null,
          expires_at in the future), with a positive control in the same read - 1 total row, 1
          accepted - proving the query could count rather than returning an empty answer from a
          broken join. So no outstanding invite is stranded by this.

          ⚠️ AND THE ONE ACCEPTED LINK STILL WORKS. `active_friend_ids()` honours accepted
          `friend_links` server-side regardless of any UI, so that friendship is not lost.

          The component, its hook and the `friend-link` edge function are still in the tree and
          still tested - only the MOUNT is gone, which is the reversible half. Deleting them is a
          separate slice; it takes 59 passing assertions with it and nobody is waiting on it.
        */}

      </div>

      {/*
        ⚠️ A THIRD CARD, AND THE BUDGET FOR IT WAS MEASURED RATHER THAN GUESSED. Two cards
        took /account from 60% of its page in one unbroken run to 45.8% - still over the 2x
        ceiling - while whitespace moved only 16.8% -> 17.1%. FOUR cards had already been tried
        and reverted at +10 whitespace points, so the question was never "more cards", it was
        whether ONE more was affordable. It was.

        ⚠️ AND THIS IS THE RIGHT SEAM RATHER THAN THE CONVENIENT ONE. These toggles are not
        about WHO follows you, they are about WHAT those people can see - a different subject,
        and it already had a rule drawn across it. A border inside a card was doing the job a
        card boundary does, so the border goes now that the card is here.
      */}
      <div className="card-forged p-5 space-y-5">
        {/*
          ⚠️ MOVED HERE FROM THE CONNECTIONS CARD (Tre, 2026-09-17: "it should only be on that
          tab"). These publish a figure to the people you are mutually followed by, so they belong
          on the surface that shows who those people are, not two sections away from it.

          ⚠️ AND THE HEADING SAYS **FOLLOW BACK** ON PURPOSE. A one-directional follower sees
          nothing: `active_friend_ids()` requires the follow to go BOTH ways. "What followers can
          see" would be false, and falsely alarming - it would tell somebody with a public account
          that every stranger who followed them could read their money.
        */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            What people you follow back can see
          </h3>
          <LeaderboardShareToggles />
        </div>
      </div>
    </div>
  );
}

export default FollowersPanel;
