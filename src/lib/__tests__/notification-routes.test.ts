// WHERE A NOTIFICATION TAP LANDS.
//
// ⚠️ THE BUG THESE PIN WAS FOUND ON A REAL PHONE, NOT IN A TEST. The first APNs delivery in this
// app's history landed on Tre's phone on 2026-09-05 saying "a 2-minute lesson, and a badge when
// you finish it", and tapping it did nothing — it foregrounded the app where he had left it.
// `grep pushNotificationActionPerformed src/` returned ZERO matches: the payload had always
// carried `key`, and nothing listened for the tap that would consume it.
//
// ⚠️ NO TEST IN THIS FILE PROVES THE TAP WORKS. You cannot tap a notification in jsdom. These pin
// the pure key→route decision only; the listener and the cold-start path have to be proven by
// tapping a real notification on a real device. Today's own lesson: a harness that cannot observe
// the failure will stay green through it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeForNotificationKey, LESSON_PARAM } from '@/lib/notification-routes';

describe('routeForNotificationKey', () => {
  afterEach(() => vi.restoreAllMocks());

  it('⚠️ takes a lesson notification to THAT lesson, which is the tap that failed', () => {
    const r = routeForNotificationKey('learn_lesson:cash-floor');
    expect(r.recognised).toBe(true);
    expect(r.path).toBe(`/dashboard?${LESSON_PARAM}=cash-floor`);
  });

  it('keeps a lesson id containing a colon intact rather than truncating it', () => {
    // Splitting on every colon would route to a DIFFERENT lesson, which is worse than not routing.
    const r = routeForNotificationKey('learn_lesson:money:basics');
    expect(r.path).toBe(`/dashboard?${LESSON_PARAM}=money%3Abasics`);
  });

  it('sends a bill to the ledger, where a bill is acted on', () => {
    expect(routeForNotificationKey('bill_due:2026-09-10:Rent'))
      .toEqual({ path: '/transactions', recognised: true });
  });

  it('sends a stale-account warning to the accounts view, not the dashboard root', () => {
    expect(routeForNotificationKey('stale_accounts:2026-09-05'))
      .toEqual({ path: '/dashboard?tab=accounts', recognised: true });
  });

  it('routes the four dashboard kinds DELIBERATELY, not by falling through', () => {
    for (const key of ['streak_risk:2026-09-05', 'weekly_checkin:2026-09-05',
                       'floor_risk:2026-10', 'milestone:2026-10:debt_free']) {
      const r = routeForNotificationKey(key);
      expect(r.path, key).toBe('/dashboard');
      // `recognised` is what separates "we meant this" from "we had no idea".
      expect(r.recognised, key).toBe(true);
    }
  });

  it('⚠️ never returns nowhere — every kind of rubbish still opens something', () => {
    for (const key of [null, undefined, '', ':', 'nonsense', 'future_kind:whatever']) {
      expect(routeForNotificationKey(key).path).toBe('/dashboard');
    }
  });

  it('⚠️ marks an unknown kind UNRECOGNISED so the caller can shout about it', () => {
    // Silently swallowing an unknown link is the shape that already cost this codebase once, with
    // `DeepLinkHandler` ignoring `plaid-complete`. A future kind added to the sender without a
    // route here must be loud, not invisible.
    expect(routeForNotificationKey('future_kind:whatever').recognised).toBe(false);
    expect(routeForNotificationKey(null).recognised).toBe(false);
  });

  it('does not claim to recognise a lesson key with no id, but still opens the dashboard', () => {
    const r = routeForNotificationKey('learn_lesson:');
    expect(r.path).toBe('/dashboard');
    // The KIND was recognised even though the detail was empty — that is a sender bug, not an
    // unknown kind, and conflating the two would send the wrong person looking.
    expect(r.recognised).toBe(true);
  });

  it('covers every kind the sender can emit', () => {
    // If `notification-policy.ts` grows a kind, this list is what fails first.
    const KINDS = ['bill_due', 'floor_risk', 'milestone', 'weekly_checkin',
                   'stale_accounts', 'learn_lesson', 'streak_risk'];
    for (const kind of KINDS) {
      expect(routeForNotificationKey(`${kind}:x`).recognised, kind).toBe(true);
    }
  });
});
