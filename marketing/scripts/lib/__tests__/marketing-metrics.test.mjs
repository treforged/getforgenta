import { describe, it, expect } from 'vitest';
import {
  COUNTS_HEADER,
  TARGETS,
  mondayOf,
  addWeeks,
  campaignWeek,
  parseCounts,
  valueFor,
  summarize,
  renderReport,
  renderHeadline,
  buildCountsLine,
} from '../marketing-metrics.mjs';

const H = COUNTS_HEADER;

describe('mondayOf', () => {
  it('snaps a mid-week date back to its Monday', () => {
    // 2026-08-13 is a Thursday, so its week starts 2026-08-10.
    expect(mondayOf('2026-08-13')).toBe('2026-08-10');
    expect(mondayOf('2026-08-12')).toBe('2026-08-10');
  });

  it('leaves a Monday alone and pulls a Sunday back a full week', () => {
    expect(mondayOf('2026-08-10')).toBe('2026-08-10');
    expect(mondayOf('2026-08-16')).toBe('2026-08-10');
  });

  it('crosses a DST boundary without shifting a day', () => {
    // US DST ends 2026-11-01. Date arithmetic done in local time slips here.
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
  });

  it('rejects anything that is not an ISO date', () => {
    expect(() => mondayOf('08/10/2026')).toThrow(/ISO date/);
  });
});

describe('addWeeks / campaignWeek', () => {
  it('steps whole weeks in both directions', () => {
    expect(addWeeks('2026-08-10', 1)).toBe('2026-08-17');
    expect(addWeeks('2026-08-10', -1)).toBe('2026-08-03');
  });

  it('counts the launch week as week 1', () => {
    expect(campaignWeek('2026-08-10', '2026-08-10')).toBe(1);
    expect(campaignWeek('2026-09-14', '2026-08-10')).toBe(6);
  });
});

describe('parseCounts', () => {
  it('reads rows and ignores blanks and comments', () => {
    const rows = parseCounts([
      '# a note about where these came from',
      H,
      '',
      '2026-08-10,pit-crew,replies_posted,11,reddit profile',
      '2026-08-10,answer-engine,gsc_impressions,140,search console',
    ].join('\n'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ campaign: 'pit-crew', metric: 'replies_posted', value: 11 });
  });

  it('keeps a source containing commas intact', () => {
    const rows = parseCounts([H, '2026-08-10,teardown,median_views,320,YouTube Studio, TikTok analytics'].join('\n'));
    expect(rows[0].source).toBe('YouTube Studio, TikTok analytics');
    expect(rows[0].value).toBe(320);
  });

  it('refuses a week_start that is not a Monday, and says which one to use', () => {
    expect(() => parseCounts([H, '2026-08-12,pit-crew,replies_posted,4,x'].join('\n')))
      .toThrow(/not a Monday \(use 2026-08-10\)/);
  });

  it('refuses an unknown campaign rather than dropping the row', () => {
    expect(() => parseCounts([H, '2026-08-10,tiktok-dances,views,9,x'].join('\n')))
      .toThrow(/unknown campaign/);
  });

  it('refuses a non-numeric or negative value', () => {
    expect(() => parseCounts([H, '2026-08-10,pit-crew,replies_posted,many,x'].join('\n'))).toThrow(/not a number/);
    expect(() => parseCounts([H, '2026-08-10,pit-crew,replies_posted,-2,x'].join('\n'))).toThrow(/negative/);
  });

  it('refuses a wrong header, because a renamed column silently mis-reads every row', () => {
    expect(() => parseCounts(['week,campaign,metric,value,source', '2026-08-10,pit-crew,x,1,y'].join('\n')))
      .toThrow(/expected header/);
  });
});

describe('valueFor', () => {
  const rows = parseCounts([
    H,
    '2026-08-10,pit-crew,replies_posted,8,first count',
    '2026-08-10,pit-crew,replies_posted,11,recount after Sunday',
  ].join('\n'));

  it('lets an appended correction win', () => {
    expect(valueFor(rows, '2026-08-10', 'pit-crew', 'replies_posted')).toBe(11);
  });

  it('returns null — not 0 — when nothing was recorded', () => {
    expect(valueFor(rows, '2026-08-10', 'teardown', 'median_views')).toBeNull();
  });
});

describe('summarize', () => {
  const targets = [
    { campaign: 'pit-crew', metric: 'replies_posted', target: 10, dueWeek: 1, unit: '/wk', source: 'reddit' },
    { campaign: 'answer-engine', metric: 'gsc_impressions', target: 500, dueWeek: 6, unit: '/wk', source: 'gsc' },
    { campaign: 'teardown', metric: 'median_views', target: 500, dueWeek: 6, unit: '/short', source: 'studio' },
  ];
  const rows = parseCounts([
    H,
    '2026-08-03,pit-crew,replies_posted,7,prior week',
    '2026-08-10,pit-crew,replies_posted,11,this week',
    '2026-08-10,answer-engine,gsc_impressions,140,this week',
  ].join('\n'));

  const entries = summarize(rows, '2026-08-12', { targets, launchWeek: '2026-08-10' });

  it('marks a met target on target and carries the week-on-week delta', () => {
    const e = entries.find((x) => x.metric === 'replies_posted');
    expect(e.status).toBe('on target');
    expect(e.value).toBe(11);
    expect(e.prev).toBe(7);
    expect(e.delta).toBe(4);
  });

  it('calls an early under-target number "tracking", not a failure', () => {
    const e = entries.find((x) => x.metric === 'gsc_impressions');
    expect(e.status).toBe('tracking');
    expect(e.due).toBe(false);
  });

  it('calls it "below target" once the target is due', () => {
    const late = summarize(rows, '2026-09-14', { targets, launchWeek: '2026-08-10' });
    const e = late.find((x) => x.metric === 'gsc_impressions');
    expect(e.campaignWeek).toBe(6);
    expect(e.status).toBe('no reading'); // week 6 has no row at all
    const withRow = summarize(
      parseCounts([H, '2026-09-14,answer-engine,gsc_impressions,300,gsc'].join('\n')),
      '2026-09-14',
      { targets, launchWeek: '2026-08-10' },
    ).find((x) => x.metric === 'gsc_impressions');
    expect(withRow.status).toBe('below target');
  });

  it('reports an unmeasured metric as "no reading" with a null value', () => {
    const e = entries.find((x) => x.metric === 'median_views');
    expect(e.status).toBe('no reading');
    expect(e.value).toBeNull();
    expect(e.delta).toBeNull();
  });

  it('accepts any day of the week and reports on that week', () => {
    expect(entries[0].weekStart).toBe('2026-08-10');
  });
});

describe('renderReport', () => {
  const targets = [
    { campaign: 'pit-crew', metric: 'replies_posted', target: 10, dueWeek: 1, unit: '/wk', source: 'reddit profile' },
    { campaign: 'teardown', metric: 'median_views', target: 500, dueWeek: 6, unit: '/short', source: 'YouTube Studio' },
  ];
  const rows = parseCounts([H, '2026-08-10,pit-crew,replies_posted,11,reddit'].join('\n'));
  const md = renderReport(summarize(rows, '2026-08-10', { targets, launchWeek: '2026-08-10' }), {
    weekStart: '2026-08-10',
    launchWeek: '2026-08-10',
  });

  it('never prints a zero for a metric nobody read', () => {
    expect(md).toContain('median_views**: no reading');
    expect(md).not.toMatch(/median_views\*\*: 0\b/);
  });

  it('tells you where to go and get the missing number', () => {
    expect(md).toContain('Numbers nobody read this week');
    expect(md).toContain('YouTube Studio');
  });

  it('headlines the week and the campaign week', () => {
    expect(md).toContain('week of 2026-08-10');
    expect(md).toContain('campaign week 1');
  });

  it('gives a one-line headline for the board', () => {
    const line = renderHeadline(summarize(rows, '2026-08-10', { targets, launchWeek: '2026-08-10' }), '2026-08-10');
    expect(line).toBe('Marketing week of 2026-08-10: 1 on target, 0 tracking, 0 below, 1 with no reading.');
  });
});

describe('buildCountsLine', () => {
  it('snaps the date to its Monday so a Friday entry lands in the right week', () => {
    expect(buildCountsLine({ weekStart: '2026-08-14', campaign: 'pit-crew', metric: 'replies_posted', value: '9', source: 'reddit' }))
      .toBe('2026-08-10,pit-crew,replies_posted,9,reddit');
  });

  it('strips commas out of the source so the row cannot split into a wrong shape', () => {
    const line = buildCountsLine({ weekStart: '2026-08-10', campaign: 'teardown', metric: 'median_views', value: 320, source: 'Studio, TikTok' });
    expect(line.split(',')).toHaveLength(5);
  });

  it('rejects an unknown campaign and lists the real ones', () => {
    expect(() => buildCountsLine({ weekStart: '2026-08-10', campaign: 'nope', metric: 'x', value: 1 }))
      .toThrow(/pit-crew/);
  });
});

describe('TARGETS', () => {
  it('gives every target a source a person can actually open', () => {
    for (const t of TARGETS) {
      expect(t.source, `${t.campaign}/${t.metric}`).toBeTruthy();
      expect(t.target, `${t.campaign}/${t.metric}`).toBeGreaterThan(0);
      expect(t.dueWeek, `${t.campaign}/${t.metric}`).toBeGreaterThan(0);
    }
  });
});
