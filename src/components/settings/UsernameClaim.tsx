// Claiming a handle, so a friend can add you by something you can say out loud.
//
// Tre, 2026-09-13: "maybe we should do usernames instead or or make that an option to add people by
// usernames."
//
// ⚠️ THE RULES LIVE IN `@/lib/username` AND ARE NOT RE-STATED HERE. That module shipped in
// `a787279c` with its migration, its unique index and its tests — and, until this file, with ZERO
// callers anywhere in `src/`. A validator nobody calls is the defect this repo has now found three
// times in one day, so the point of this component is to BE the caller, not to re-derive anything.
//
// ⚠️ THE FORM STARTS EMPTY, NEVER SEEDED FROM AN EMAIL ADDRESS. Pre-filling `tre` from
// `tre@treforged.com` would hand people a public handle derived from their private address, and
// most would accept the default without noticing what they had just published.
//
// ⚠️ "TAKEN" AND "RESERVED" GIVE THE SAME ANSWER. A username is the one field designed to be
// guessable, so a form that distinguishes "nobody has this" from "somebody does" is a tool for
// mapping the user base. Both paths end at `USERNAME_UNAVAILABLE_MESSAGE`. That is not the whole
// defence — attempt counts and timing still leak, and rate limiting belongs at the edge — but this
// component must not be the part that gives it away.
import { useState } from 'react';
import { Loader2, AtSign, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useProfile } from '@/hooks/useSupabaseData';
import {
  normalizeUsername,
  usernameProblem,
  usernameProblemMessage,
  USERNAME_MAX,
  USERNAME_UNAVAILABLE_MESSAGE,
} from '@/lib/username';

/** Postgres unique-violation. The index is on `lower(username)`, so this IS "already taken". */
const UNIQUE_VIOLATION = '23505';

/**
 * The trigger's own message, raised by `enforce_username_change_limit()`.
 *
 * ⚠️ THE LIMIT IS THE DATABASE'S, NOT THIS COMPONENT'S, and that is not a detail. The 2026-09-13
 * migration grants `update (username)` to every authenticated user, so a handle can be changed by
 * a PATCH straight to PostgREST without this screen ever running - a counter here would be a speed
 * bump in front of an open door. This constant only lets the UI RECOGNISE the refusal so it can
 * say when the next change unlocks instead of showing a generic failure.
 */
const CHANGE_LIMIT = 'USERNAME_CHANGE_LIMIT';

/**
 * Turn the refusal's `detail` - an ISO instant - into something a person can act on.
 *
 * ⚠️ A REFUSAL THAT DOES NOT SAY WHEN IS A WALL; ONE THAT DOES IS A WAIT. Tre asked for the
 * limit and for the message to name the unlock, which is the half that decides whether somebody
 * retries blindly for a week. If the instant cannot be parsed the sentence degrades to the rule
 * itself rather than printing "Invalid Date" - a wrong date is worse than no date.
 */
function changeLimitMessage(detail: string | null | undefined): string {
  const when = detail ? new Date(detail) : null;
  if (!when || Number.isNaN(when.getTime())) {
    return 'You can change your username twice every seven days. Try again in a few days.';
  }
  return `You can change your username twice every seven days. The next change unlocks ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`;
}

export function UsernameClaim({ readOnly = false }: { readOnly?: boolean }) {
  const { data: profile, loading, update } = useProfile();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * ⚠️ BEFORE 2026-09-15 THERE WAS NO WAY TO CHANGE A HANDLE AT ALL. Once `current` existed this
   * component returned a read-only line, so "allowing users to edit their username twice every
   * seven days" (Tre) needed the EDIT AFFORDANCE as much as it needed the limit - a limit on an
   * action nobody could perform would have been a gate in front of a wall.
   */
  const [editing, setEditing] = useState(false);

  const current = typeof profile?.username === 'string' ? profile.username : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Loading your username
      </div>
    );
  }

  if (current && !editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <Check size={12} className="text-success shrink-0" />
        <span className="text-muted-foreground">Friends can add you as</span>
        <span className="font-medium truncate">@{current}</span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => { setDraft(current); setError(null); setEditing(true); }}
            className="btn btn-sm btn-secondary shrink-0 ml-auto"
          >
            Change
          </button>
        )}
      </div>
    );
  }

  const submit = async () => {
    const value = normalizeUsername(draft);

    // Local rules first, so an obviously-wrong handle costs no round trip and no rate-limit budget.
    const problem = usernameProblem(value);
    if (problem) {
      setError(usernameProblemMessage(problem));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await update.mutateAsync({ username: value });
      toast.success(`You are @${value}`);
      setDraft('');
      setEditing(false);
    } catch (e) {
      // ⚠️ THE COLLISION IS THE DATABASE'S ANSWER, NOT A PRE-CHECK'S, AND THAT IS DELIBERATE.
      // Asking "is this free?" and then claiming it is two steps with a gap between them, and the
      // gap is where two people claim one handle. The unique index on `lower(username)` is the only
      // thing that can actually decide this, so the write IS the check.
      const code = (e as { code?: string } | null)?.code;
      const message = (e as { message?: string } | null)?.message ?? '';
      const taken = code === UNIQUE_VIOLATION || message.includes(UNIQUE_VIOLATION)
        || /duplicate key|unique constraint/i.test(message);
      // The rate-limit refusal carries its unlock instant in PostgREST's `details`. Checked BEFORE
      // the generic branch, because "could not save that right now" is exactly the unhelpful
      // sentence this feature exists to replace.
      const detail = (e as { details?: string } | null)?.details;
      if (message.includes(CHANGE_LIMIT) || detail?.includes(CHANGE_LIMIT)) {
        setError(changeLimitMessage(detail && !detail.includes(CHANGE_LIMIT) ? detail : null));
      } else {
        setError(taken ? USERNAME_UNAVAILABLE_MESSAGE : 'Could not save that right now. Nothing changed.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {current
          ? 'You can change your username twice every seven days.'
          : 'Pick a username so friends can add you without swapping email addresses.'}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1 min-w-0 bg-secondary border border-border px-2 py-1.5"
          style={{ borderRadius: 'var(--radius)' }}>
          <AtSign size={12} className="text-muted-foreground shrink-0" />
          <input
            value={draft}
            onChange={e => { setDraft(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
            maxLength={USERNAME_MAX}
            disabled={readOnly || saving}
            aria-label="Choose a username"
            placeholder="yourname"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none"
          />
        </div>
        <button
          onClick={() => void submit()}
          disabled={readOnly || saving || draft.trim() === ''}
          className="btn btn-sm btn-primary shrink-0"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : current ? 'Save' : 'Claim'}
        </button>
        {current && (
          <button
            type="button"
            onClick={() => { setEditing(false); setDraft(''); setError(null); }}
            disabled={saving}
            className="btn btn-sm btn-secondary shrink-0"
          >
            Cancel
          </button>
        )}
      </div>
      {/* Said out loud rather than swallowed, and `role="alert"` so it is announced rather than
          only seen — this is the one thing standing between a press and understanding why it did
          nothing. */}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
