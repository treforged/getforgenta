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
 * A lesson has no URL of its own: it is local state (`openLessonId`) inside the card. A param is
 * the smallest honest way to address one from outside, and it makes lessons linkable in general
 * rather than only from a notification.
 */
export const LESSON_PARAM = 'lesson';

/** Where the Learn card lives as of 2026-09-17 — a SECTION of /account, not a dashboard widget. */
const LEARN_PATH = '/account';

/**
 * ⚠️ THE HOLE THIS BLOCK USED TO DESCRIBE IS GONE BY CONSTRUCTION AS OF 2026-09-17, AND THE
 * HISTORY IS KEPT BECAUSE IT EXPLAINS WHY THE DESTINATION MOVED.
 *
 * It read: `?lesson=` is consumed by `LearnCard`, which was a CUSTOMISABLE DASHBOARD WIDGET, so a
 * person who removed it made the param unconsumable and the tap landed on `/dashboard` and did
 * nothing visible. That was patched on 2026-09-05 by appending the widget for one render — a real
 * fix, and one explicitly labelled REASONED RATHER THAN MEASURED, because `/demo` cannot tell it
 * working from it doing nothing.
 *
 * Tre moved the Learn card into its own section of /account on 2026-09-17 ("not like the whole tab
 * section ... the dashboard is getting to the point where it['s an] overload of information"). A
 * SECTION cannot be removed and cannot be customised away, so there is no longer a layout in which
 * the reader is absent. The append was deleted with the widget.
 *
 * ⚠️ MOVING THE CARD WITHOUT MOVING THIS ROUTE WOULD HAVE SILENTLY RE-OPENED THE ORIGINAL HOLE,
 * for EVERY user rather than only those who had customised — a `learn_lesson` tap landing on a
 * page with nothing to consume the param. That is why the two changes are one commit.
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
          ? `${LEARN_PATH}?${LESSON_PARAM}=${encodeURIComponent(lessonId)}`
          : LEARN_PATH,
        recognised: true,
      };
    }
    // The streak lives on the same card as the lessons, so it follows them to /account —
    // deliberately, not by falling through to the default. A streak notification landing on the
    // dashboard would show the person a page that no longer carries their streak at all.
    case 'streak_risk':
      return { path: LEARN_PATH, recognised: true };

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
