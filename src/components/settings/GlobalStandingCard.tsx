// "How am I doing against everyone else?" — answered as a percentage, or answered honestly as
// "not enough people yet".
//
// ⚠️ THE EMPTY STATE IS THE FEATURE TODAY, NOT A PLACEHOLDER. Measured 2026-09-13: 49 accounts
// exist and exactly ONE has opted any metric in. With a cohort of one, a median IS that person's
// own number and "better than 0%" names them. So this card will say "not enough people yet" for
// everybody until participation grows, and that sentence is the privacy guarantee working rather
// than a feature failing. Saying so plainly is the difference between a user trusting the floor and
// a user thinking the app is broken.
//
// ⚠️ AND THAT GOES DOUBLE FOR THE COUNTRY SCOPE, added 2026-09-14. A country cohort is a SUBSET of
// the global one, so it reaches the floor of 20 strictly later. Expect every country board to read
// "not enough people yet" for a long time. Do not lower the floor to make this screen look busier:
// the floor is the whole reason one person's bucket cannot be read back out of a median.
import { useState } from 'react';
import { Globe, MapPin } from 'lucide-react';
import PanelBar from '@/components/shared/PanelBar';
import { FIELD_INPUT_COMPACT } from '@/components/shared/field-classes';
import { useGlobalLeaderboard, hasEnoughPeople, type LeaderboardScope } from '@/hooks/useGlobalLeaderboard';
import { useProfile } from '@/hooks/useSupabaseData';
import { COUNTRY_OPT_OUT_FLAG } from '@/hooks/useDerivedCountry';
import { isMetricSourced, type LeaderboardMetric } from '@/lib/leaderboard-metrics';

const SCOPES: readonly { key: LeaderboardScope; label: string; icon: typeof Globe }[] = [
  { key: 'global', label: 'Everyone', icon: Globe },
  { key: 'country', label: 'Your country', icon: MapPin },
];

export function GlobalStandingCard({ metric, label }: { metric: LeaderboardMetric; label: string }) {
  const [scope, setScope] = useState<LeaderboardScope>('global');
  const { data, isLoading, error } = useGlobalLeaderboard(metric, scope);
  const { data: profile, update } = useProfile();

  // A metric nothing computes has no standing to report — see `UNSOURCED_METRICS`.
  if (!isMetricSourced(metric)) return null;
  // ⚠️ NOTHING AT ALL WHILE LOADING, INCLUDING THE SCOPE SWITCH. An earlier version of this
  // card moved the check inside the body so the switch appeared first — which puts a control on
  // screen that changes a number nobody can see yet, and offers a press whose effect is
  // invisible. A blank beats a control that does nothing, and the existing test says so.
  if (isLoading) return null;

  const flags = (profile?.tour_flags as Record<string, boolean> | null) ?? {};
  const country = (profile as { country_code?: string | null } | undefined)?.country_code ?? null;
  const optedOut = flags[COUNTRY_OPT_OUT_FLAG] === true;

  /**
   * ⚠️ LEAVING REMOVES YOU FROM THE BOARD; IT DOES NOT HIDE YOU ON IT. Clearing `country_code`
   * takes the row out of every country cohort by construction — the server's join stops matching —
   * rather than filtering out a row that is still being counted. The flag is what stops the
   * derivation hook refilling the field on the next page load, which would make the control look
   * broken while quietly putting the user back.
   */
  const leaveCountryBoard = () => {
    update.mutate({ country_code: null, tour_flags: { ...flags, [COUNTRY_OPT_OUT_FLAG]: true } });
    setScope('global');
  };

  const rejoinCountryBoard = () => {
    update.mutate({ tour_flags: { ...flags, [COUNTRY_OPT_OUT_FLAG]: false } });
  };

  /**
   * ⚠️ A DERIVED VALUE IS A GUESS, SO IT MUST BE CORRECTABLE. Sam, 2026-09-14: "a guess about where
   * someone lives should never be unchangeable." The derivation reads a locale and a time zone,
   * and both are wrong for plenty of real people — an expat keeps their home locale, a corporate
   * laptop ships a fixed one. Without this control those users are silently filed under a country
   * they do not live in and have no way to say so.
   *
   * Typing is normalised and validated to the SAME shape the database CHECK enforces, so the
   * control cannot produce a value the server will reject. An empty box is a no-op rather than an
   * error: leaving is what the `Leave the country board` action is for, and a text field that
   * silently opted you out would be a trap.
   */
  const saveCountry = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || code === country) return;
    update.mutate({ country_code: code, tour_flags: { ...flags, [COUNTRY_OPT_OUT_FLAG]: false } });
  };

  const body = () => {
    if (error) {
      // Said out loud rather than drawn as a zero. A standing that could not be read is not a low one.
      return (
        <p className="text-xs text-muted-foreground italic">Could not load how you compare right now.</p>
      );
    }
    if (!data) return null;

    // ⚠️ THE COUNTRY SCOPE WITH NO COUNTRY IS ITS OWN STATE, and it must not read as "nobody is
    // sharing". The server returns cohort 0 for this case deliberately rather than falling back to
    // the global cohort, so the difference has to be said here or the distinction is lost.
    if (scope === 'country' && !country) {
      return (
        <p className="text-xs text-muted-foreground">
          {optedOut
            ? 'You have left the country board, so there is nothing to compare against here.'
            : 'We could not work out your country from your device, so you are not on a country board. Nothing was sent anywhere.'}
        </p>
      );
    }

    const enough = hasEnoughPeople(data);
    const who = scope === 'country' ? `people in ${country}` : 'people';

    return enough ? (
      <>
        <p className="text-xs text-muted-foreground">
          You are ahead of <span className="text-foreground font-semibold">{data.betterThanPct}%</span>{' '}
          of the {data.cohortSize} {who} sharing {label.toLowerCase()} this week.
        </p>
        {data.medianBucket !== null && (
          <p className="text-xs text-muted-foreground">Half of them are at {data.medianBucket}% or below.</p>
        )}
      </>
    ) : (
      /* ⚠️ NOT RENDERED AS 0%. A null standing means the floor has not been reached; drawing it as
         a score would invent a number and a bad one. The count is shown because it explains the
         wait, and a count of opted-in people is not anybody's financial data. */
      <p className="text-xs text-muted-foreground">
        {data.cohortSize === 0
          ? `Nobody ${scope === 'country' ? `in ${country} ` : ''}is sharing this yet, so there is nothing to compare against.`
          : `Only ${data.cohortSize} ${data.cohortSize === 1 ? 'person is' : 'people are'} sharing this${
              scope === 'country' ? ` in ${country}` : ''
            } so far.`}{' '}
        We wait until {data.minCohort} are taking part before showing where you stand, so that no one
        number can point back at one person.
      </p>
    );
  };

  return (
    <div
      className="bg-secondary/40 border border-border px-3 py-2.5 space-y-2"
      style={{ borderRadius: 'var(--radius)' }}
    >
      {/* ⚠️ THE CARD KEEPS ITS HEADING. Adding the scope switch replaced it at first, and that lost
          the one line telling the reader what the card IS -- a switch labelled "Everyone" says
          which cohort, never which feature. The heading follows the scope so it can never sit
          above a number about a different population. */}
      <div className="flex items-center gap-2">
        {scope === 'country' ? (
          <MapPin size={12} className="text-primary shrink-0" />
        ) : (
          <Globe size={12} className="text-primary shrink-0" />
        )}
        <p className="text-xs font-medium">
          {scope === 'country' ? (country ? `People in ${country}` : 'Your country') : 'Everyone on Forgenta'}
        </p>
      </div>

      {/* The same segmented control this app uses on six other surfaces, rather than a new one.
          `seg-item-active` carries a filled track; an unselected item is visibly OFF rather than
          merely un-highlighted, which is the standard Tre set for the sharing switches. */}
      <PanelBar>
        {SCOPES.map(({ key, label: scopeLabel, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setScope(key)}
            role="tab"
            aria-selected={scope === key}
            className={`seg-item btn-press ${scope === key ? 'seg-item-active' : ''}`}
          >
            <Icon size={13} /> {scopeLabel}
          </button>
        ))}
      </PanelBar>

      <div className="space-y-1">{body()}</div>

      <p className="text-xs text-muted-foreground">
        Nobody sees your name, your amounts or your accounts here — only these percentages.
      </p>

      {/* The country control is only worth showing on the country scope, and its wording states
          what actually happens rather than the softer "hide". */}
      {scope === 'country' && (
        <p className="text-xs text-muted-foreground">
          {country ? (
            <>
              Your country was worked out from your device settings — never from your location or
              your IP address. Change it if we guessed wrong:{' '}
              <input
                type="text"
                defaultValue={country}
                maxLength={2}
                aria-label="Your country code"
                onBlur={e => saveCountry(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className={`w-10 uppercase ${FIELD_INPUT_COMPACT}`}
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
              />{' '}
              <button onClick={leaveCountryBoard} className="underline hover:text-foreground">
                Leave the country board
              </button>
              .
            </>
          ) : optedOut ? (
            <button onClick={rejoinCountryBoard} className="underline hover:text-foreground">
              Rejoin the country board
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}
