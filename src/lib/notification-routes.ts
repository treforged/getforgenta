/**
 * WHERE A NOTIFICATION TAKES YOU WHEN YOU TAP IT.
 *
 * ⚠️ NOTHING LISTENED FOR A TAP AT ALL UNTIL 2026-09-05. The first real APNs delivery in this
 * app's history landed on Tre's phone, said *"a 2-minute lesson, and a badge when you finish it"*,
 * and tapping it did nothing — it foregrounded the app wherever he had left it. Measured, not
 * guessed: `grep pushNotificationActionPerformed src/` returned ZERO matches. The payload has
 * always carried `key` (`sendApns` puts it beside `aps`, `sendFcm` in `data`); no code consumed it.
 *
 * **A notification you cannot act on is worse than no notification**, because it teaches the person
 * that tapping is pointless and every later one inherits that. This is the map that makes the tap
 * mean something, and it covers ALL SEVEN KINDS rather than the one that was noticed — the other
 * six would each have arrived with the same defect.
 *
 * ── KEYS ARE `kind:detail`, AND THE DETAIL MATTERS FOR EXACTLY ONE OF THEM ──
 * `notification-policy.ts` builds them: `bill_due:<date>:<name>`, `floor_risk:<month>`,
 * `milestone:<month>:<event>`, `stale_accounts:<date>`, `weekly_checkin:<date>`,
 * `learn_lesson:<lessonId>`, `streak_risk:<date>`. Only `learn_lesson` carries a detail worth
 * routing on, because only it names a specific thing to open.
 *
 * ⚠️ AN UNRECOGNISED KEY IS NEVER SILENTLY DROPPED. That is the confident-blank shape and it has
 * already cost this codebase once — `DeepLinkHandler` quietly ignoring `plaid-complete`. An
 * unknown kind routes to the dashboard AND says so, so a kind added to the sender without a route
 * here is a line in a log rather than a tap that does nothing.
 */

/** Where a tap should land, as a router path (with any query already attached). */
export interface NotificationRoute {
  path: string;
  /** False when the kind was not recognised — the caller logs it rather than failing silently. */
  recognised: boolean;
}

const DEFAULT_PATH = '/dashboard';

/**
 * The query parameter `LearnCard` reads to open one lesson.
 *
 * A lesson has no URL of its own: it is local state (`openLessonId`) inside a dashboard card. A
 * param is the smallest honest way to address one from outside, and it makes lessons linkable in
 * general rather than only from a notification.
 */
export const LESSON_PARAM = 'lesson';

/**
 * ⚠️ KNOWN HOLE, MEASURED 2026-09-05 AND NOT YET CLOSED. `?lesson=` is consumed by `LearnCard`,
 * which is a CUSTOMISABLE DASHBOARD WIDGET (`dashboard-widgets.ts`, id `learn`). It is on by
 * default and last in the default order — but a person who removes it from their dashboard makes
 * the param unconsumable, and the tap then lands on `/dashboard` and does nothing visible.
 *
 * Verified in the browser rather than assumed: on `/demo` the Learn card is not rendered at all,
 * `?lesson=what-a-cash-floor-is` was NOT consumed and no lesson opened. That is the same
 * silently-does-nothing shape this file exists to fix, so it is written down rather than left for
 * a user to find. **The fix is to consume the param where it is guaranteed to be mounted — the
 * Dashboard page itself — and have it ensure the Learn card is shown.** Not done here because it
 * could not be verified end to end in this session, and shipping an unverified claim about a
 * notification tap is the exact failure this whole batch is about.
 */

/**
 * Route for a notification key.
 *
 * ⚠️ TOTAL BY CONSTRUCTION. Every branch returns a path, so there is no input — malformed, empty,
 * or from a future version of the sender — that produces "nowhere". Opening the dashboard is a
 * defensible outcome for a tap; doing nothing is not.
 */
export function routeForNotificationKey(key: string | null | undefined): NotificationRoute {
  if (!key) return { path: DEFAULT_PATH, recognised: false };

  const [kind, ...rest] = key.split(':');
  switch (kind) {
    case 'learn_lesson': {
      // The lesson id is the remainder, rejoined: an id containing a colon would otherwise be
      // truncated into a different lesson, which is worse than not routing at all.
      const lessonId = rest.join(':');
      return {
        path: lessonId
          ? `${DEFAULT_PATH}?${LESSON_PARAM}=${encodeURIComponent(lessonId)}`
          : DEFAULT_PATH,
        recognised: true,
      };
    }
    // The streak lives on the same card as the lessons, so the dashboard IS the destination —
    // deliberately, not by falling through to the default.
    case 'streak_risk':
    case 'weekly_checkin':
    case 'floor_risk':
    case 'milestone':
      return { path: DEFAULT_PATH, recognised: true };

    // A bill is a transaction-shaped obligation, and the ledger is where it is acted on.
    case 'bill_due':
      return { path: '/transactions', recognised: true };

    // "Your accounts have not synced" is only actionable where the connections live.
    case 'stale_accounts':
      return { path: '/dashboard?tab=accounts', recognised: true };

    default:
      return { path: DEFAULT_PATH, recognised: false };
  }
}
