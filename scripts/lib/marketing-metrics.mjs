/**
 * Pure logic behind the weekly marketing report.
 *
 * Split out from `scripts/marketing-report.mjs` so it can be tested: the report
 * is the only thing that says whether a campaign is working, and a report that
 * silently prints a wrong number is worse than no report at all.
 *
 * The one rule that shapes every function here: **a missing reading is never a
 * zero.** A campaign that was not measured this week and a campaign that got
 * nothing look identical on a dashboard that renders both as 0, and only one of
 * them is a reason to change what you are doing.
 */

/** The campaigns, in report order. Ids are what goes in the counts CSV. */
export const CAMPAIGNS = [
  { id: 'pit-crew', name: 'Pit Crew', channel: 'Reddit (car subs, advice-only)' },
  { id: 'project-ledger', name: 'Project Ledger', channel: 'Reddit build thread + forums' },
  { id: 'teardown', name: '60-Second Teardown', channel: 'YouTube Shorts / TikTok / Reels' },
  { id: 'payment-letter', name: 'The Payment Letter', channel: 'Email (Resend)' },
  { id: 'answer-engine', name: 'Answer Engine', channel: 'getforgenta.com/answers/ (SEO)' },
  { id: 'carousel', name: 'Real Numbers Carousel', channel: 'Instagram / Facebook' },
  { id: 'north-star', name: 'North star', channel: 'All channels' },
];

const CAMPAIGN_IDS = new Set(CAMPAIGNS.map((c) => c.id));

/**
 * Every number the report knows how to read, what it should reach, and by when.
 *
 * `dueWeek` is the campaign week (1-based, counted from the launch week) that
 * the target is expected to be met by. Before that week a metric is reported as
 * "tracking" rather than "below target", because judging a compounding channel
 * in week 1 produces exactly one decision: quit too early.
 */
export const TARGETS = [
  { campaign: 'pit-crew', metric: 'replies_posted', target: 10, dueWeek: 1, unit: '/wk', source: 'reddit.com/user/<handle>/comments — count your own week' },
  { campaign: 'pit-crew', metric: 'replies_positive', target: 5, dueWeek: 4, unit: '/wk', source: 'Same page: comments sitting at +3 or better' },
  { campaign: 'project-ledger', metric: 'thread_views', target: 2000, dueWeek: 6, unit: '/post', source: 'Reddit post → ⋯ → Insights → Views (OP only)' },
  { campaign: 'project-ledger', metric: 'thread_saves', target: 25, dueWeek: 6, unit: '/post', source: 'Same Insights panel → Saves' },
  { campaign: 'teardown', metric: 'shorts_posted', target: 3, dueWeek: 1, unit: '/wk', source: 'Your own upload log — count the files you shipped' },
  { campaign: 'teardown', metric: 'median_views', target: 500, dueWeek: 6, unit: '/short', source: 'YouTube Studio → Content → Shorts; TikTok → Analytics → Content' },
  { campaign: 'payment-letter', metric: 'subscribers_net_new', target: 10, dueWeek: 4, unit: '/wk', source: 'Google Form response count, minus unsubscribes in Resend' },
  { campaign: 'payment-letter', metric: 'open_rate_pct', target: 40, dueWeek: 4, unit: '%', source: 'Resend → Broadcasts → the issue you sent' },
  { campaign: 'answer-engine', metric: 'gsc_impressions', target: 500, dueWeek: 6, unit: '/wk', source: 'Search Console → Performance → filter Page contains /answers/' },
  { campaign: 'answer-engine', metric: 'gsc_clicks', target: 25, dueWeek: 10, unit: '/wk', source: 'Same view, Clicks column' },
  { campaign: 'answer-engine', metric: 'pages_live', target: 3, dueWeek: 1, unit: 'total', source: 'ls public/answers/*.html — count what is deployed, not what is written' },
  { campaign: 'carousel', metric: 'ig_link_taps', target: 10, dueWeek: 6, unit: '/wk', source: 'Instagram → Professional dashboard → Insights → Link taps' },
  { campaign: 'north-star', metric: 'signups', target: 5, dueWeek: 8, unit: '/wk', source: 'GA4 → Reports → Engagement → Events → sign_up (consent-gated, undercounts)' },
];

/** Header the counts file must carry, exactly. */
export const COUNTS_HEADER = 'week_start,campaign,metric,value,source';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days since the epoch for an ISO date, UTC and DST-proof. */
function epochDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromEpochDay(days) {
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The Monday of the week containing `iso`. Weeks are the reporting unit
 * everywhere: a daily marketing number is noise, and a monthly one is too late
 * to act on.
 */
export function mondayOf(iso) {
  if (!ISO_DATE.test(iso)) throw new Error(`not an ISO date: ${iso}`);
  const day = epochDay(iso);
  // 1970-01-01 was a Thursday, so 1970-01-05 (day 4) was the first Monday:
  // days where (day - 4) % 7 === 0 are Mondays.
  const dow = (((day - 4) % 7) + 7) % 7;
  return fromEpochDay(day - dow);
}

/** Shift an ISO date by whole weeks. Negative goes backwards. */
export function addWeeks(iso, n) {
  if (!ISO_DATE.test(iso)) throw new Error(`not an ISO date: ${iso}`);
  return fromEpochDay(epochDay(iso) + n * 7);
}

/** 1-based campaign week number of `weekStart`, counting `launchWeek` as week 1. */
export function campaignWeek(weekStart, launchWeek) {
  const diff = (epochDay(mondayOf(weekStart)) - epochDay(mondayOf(launchWeek))) / 7;
  return diff + 1;
}

/**
 * Parse the counts CSV. Blank lines and `#` comments are skipped; anything else
 * that is malformed throws with its line number, because a silently dropped row
 * is a number that vanishes from a report without saying so.
 */
export function parseCounts(text) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  let seenHeader = false;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    if (!seenHeader) {
      if (line !== COUNTS_HEADER) {
        throw new Error(`line ${lineNo}: expected header "${COUNTS_HEADER}", got "${line}"`);
      }
      seenHeader = true;
      return;
    }

    // Only the first four commas are separators. Everything after them is the
    // source, verbatim — "YouTube Studio, TikTok" is one field, not two.
    const all = line.split(',');
    if (all.length < 4) throw new Error(`line ${lineNo}: expected at least 4 comma-separated fields, got ${all.length}`);
    const [weekStart, campaign, metric, value] = all.slice(0, 4).map((p) => p.trim());
    const source = all.slice(4).join(',').trim();
    if (!ISO_DATE.test(weekStart)) throw new Error(`line ${lineNo}: week_start "${weekStart}" is not YYYY-MM-DD`);
    if (mondayOf(weekStart) !== weekStart) throw new Error(`line ${lineNo}: week_start "${weekStart}" is not a Monday (use ${mondayOf(weekStart)})`);
    if (!CAMPAIGN_IDS.has(campaign)) throw new Error(`line ${lineNo}: unknown campaign "${campaign}"`);
    if (!metric) throw new Error(`line ${lineNo}: metric is empty`);

    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`line ${lineNo}: value "${value}" is not a number`);
    if (n < 0) throw new Error(`line ${lineNo}: value "${value}" is negative`);

    rows.push({ weekStart, campaign, metric, value: n, source, line: lineNo });
  });

  return rows;
}

/** The reading for one metric in one week, or null when nothing was recorded. */
export function valueFor(rows, weekStart, campaign, metric) {
  const hit = rows.filter((r) => r.weekStart === weekStart && r.campaign === campaign && r.metric === metric);
  if (hit.length === 0) return null;
  // Last row wins, so a correction can simply be appended.
  return hit[hit.length - 1].value;
}

/**
 * Build one entry per target for `weekStart`.
 *
 * status is one of:
 *   'no reading'   nothing was recorded — say so, never print 0
 *   'on target'    at or above target
 *   'below target' measured, under target, and the target is due
 *   'tracking'     measured, under target, but the target is not due yet
 */
export function summarize(rows, weekStart, { targets = TARGETS, launchWeek } = {}) {
  const week = mondayOf(weekStart);
  const prevWeek = addWeeks(week, -1);
  const cw = launchWeek ? campaignWeek(week, launchWeek) : null;

  return targets.map((t) => {
    const value = valueFor(rows, week, t.campaign, t.metric);
    const prev = valueFor(rows, prevWeek, t.campaign, t.metric);
    const due = cw === null ? true : cw >= t.dueWeek;

    let status;
    if (value === null) status = 'no reading';
    else if (value >= t.target) status = 'on target';
    else if (due) status = 'below target';
    else status = 'tracking';

    return {
      ...t,
      weekStart: week,
      value,
      prev,
      delta: value === null || prev === null ? null : value - prev,
      due,
      campaignWeek: cw,
      status,
    };
  });
}

const STATUS_MARK = {
  'on target': '🟢',
  tracking: '🟡',
  'below target': '🔴',
  'no reading': '⬜',
};

function fmt(value, unit) {
  if (value === null) return 'no reading';
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit === '%' ? `${n}%` : n;
}

function fmtDelta(delta) {
  if (delta === null) return '';
  if (delta === 0) return ' (flat)';
  const n = Number.isInteger(delta) ? Math.abs(delta) : Math.abs(delta).toFixed(1);
  return delta > 0 ? ` (+${n})` : ` (-${n})`;
}

/** Render the week as markdown. This is what gets posted to the board. */
export function renderReport(entries, { weekStart, launchWeek } = {}) {
  const week = mondayOf(weekStart ?? entries[0]?.weekStart);
  const cw = launchWeek ? campaignWeek(week, launchWeek) : null;
  const out = [];

  out.push(`# Forgenta marketing — week of ${week}${cw ? ` (campaign week ${cw})` : ''}`);
  out.push('');

  const counts = entries.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  out.push(
    `**${counts['on target'] ?? 0} on target · ${counts.tracking ?? 0} tracking · ` +
      `${counts['below target'] ?? 0} below · ${counts['no reading'] ?? 0} unread**`,
  );
  out.push('');

  for (const campaign of CAMPAIGNS) {
    const mine = entries.filter((e) => e.campaign === campaign.id);
    if (mine.length === 0) continue;
    out.push(`## ${campaign.name} — ${campaign.channel}`);
    for (const e of mine) {
      const target = `target ${fmt(e.target, e.unit)}${e.unit === '%' ? '' : ` ${e.unit}`}${e.due ? '' : ` by wk ${e.dueWeek}`}`;
      out.push(`- ${STATUS_MARK[e.status]} **${e.metric}**: ${fmt(e.value, e.unit)}${fmtDelta(e.delta)} — ${target}`);
    }
    out.push('');
  }

  const unread = entries.filter((e) => e.status === 'no reading');
  if (unread.length > 0) {
    out.push('## Numbers nobody read this week');
    out.push('Each line is one place to look, then one `--add` to record it.');
    for (const e of unread) out.push(`- **${e.campaign}/${e.metric}** — ${e.source}`);
    out.push('');
  }

  const below = entries.filter((e) => e.status === 'below target');
  if (below.length > 0) {
    out.push('## Under target, and due');
    for (const e of below) out.push(`- **${e.campaign}/${e.metric}**: ${fmt(e.value, e.unit)} vs ${fmt(e.target, e.unit)}`);
    out.push('');
  }

  return out.join('\n').trimEnd() + '\n';
}

/** One-line summary for `conductor note`, which shows on the board as a headline. */
export function renderHeadline(entries, weekStart) {
  const counts = entries.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  return (
    `Marketing week of ${mondayOf(weekStart)}: ${counts['on target'] ?? 0} on target, ` +
    `${counts.tracking ?? 0} tracking, ${counts['below target'] ?? 0} below, ` +
    `${counts['no reading'] ?? 0} with no reading.`
  );
}

/** Validate a `--add` row before it is appended. Returns the CSV line. */
export function buildCountsLine({ weekStart, campaign, metric, value, source }) {
  const week = mondayOf(weekStart);
  if (!CAMPAIGN_IDS.has(campaign)) {
    throw new Error(`unknown campaign "${campaign}". Known: ${[...CAMPAIGN_IDS].join(', ')}`);
  }
  if (!metric) throw new Error('metric is required');
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`value "${value}" must be a number >= 0`);
  const clean = (source ?? '').replace(/[,\r\n]/g, ' ').trim();
  return `${week},${campaign},${metric},${n},${clean}`;
}
