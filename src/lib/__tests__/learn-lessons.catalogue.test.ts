/**
 * THE LESSON CATALOGUE, VALIDATED — because a malformed lesson renders blank to a user.
 *
 * Lessons are bundled TypeScript, by an explicit decision at learn-lessons.ts:1-17: *"content is
 * code, not rows... a lessons table would be a public read surface to get the grants wrong on."*
 * That decision stands, and this file is the cheap thing that makes it safe rather than the
 * expensive thing (an authoring pipeline) that would replace it.
 *
 * The authoring risk is not the format. It is that a hand-written object with a missing field, a
 * duplicated id or an empty body compiles perfectly and then renders a blank card, an unearnable
 * badge, or a notification whose title is `undefined`. TypeScript catches a missing PROPERTY; it
 * catches none of the above, because every one of them is a well-typed empty string.
 *
 * ⚠️ The id is load-bearing beyond display: `notification-policy.ts` keys a lesson notification
 * as `learn_lesson:<id>` and refuses to resend a key it has already sent. Two lessons sharing an
 * id means the second one can NEVER be sent to anyone who has seen the first.
 *
 * Revisit the content-as-code decision at about THIRTY lessons. There are twelve, so an authoring
 * pipeline would be optimising a step that has run twelve times.
 */
import { describe, it, expect } from 'vitest';
import { LEARN_LESSONS, type LearnLesson, type LearnTrack } from '@/lib/learn-lessons';

const TRACKS: readonly LearnTrack[] = ['Foundations', 'Debt', 'Saving', 'Investing'];

/** Named in the failure message, so a broken lesson says WHICH lesson without counting rows. */
const describeLesson = (l: LearnLesson, i: number) => `lesson ${i} (${l.id || 'NO ID'})`;

describe('the learn lesson catalogue', () => {
  it('is not empty, and every entry is an object', () => {
    expect(LEARN_LESSONS.length).toBeGreaterThan(0);
    for (const lesson of LEARN_LESSONS) expect(typeof lesson).toBe('object');
  });

  it('gives every lesson a unique, url-safe id', () => {
    const ids = LEARN_LESSONS.map(l => l.id);
    // A duplicate id is worse than a missing one: notification-policy keys on it, so the second
    // lesson silently becomes unsendable to anyone who has already seen the first.
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('gives every lesson real, non-empty text in every field a user reads', () => {
    for (const [i, l] of LEARN_LESSONS.entries()) {
      const where = describeLesson(l, i);
      // `.trim()` matters: a whitespace-only string is a well-typed blank card.
      expect(l.title.trim(), `${where} title`).not.toBe('');
      expect(l.summary.trim(), `${where} summary`).not.toBe('');
      expect(l.takeaway.trim(), `${where} takeaway`).not.toBe('');
      expect(l.body.length, `${where} body`).toBeGreaterThan(0);
      for (const [j, para] of l.body.entries()) {
        expect(para.trim(), `${where} body paragraph ${j}`).not.toBe('');
      }
    }
  });

  it('puts every lesson on a real track', () => {
    for (const [i, l] of LEARN_LESSONS.entries()) {
      expect(TRACKS, describeLesson(l, i)).toContain(l.track);
    }
  });

  it('states an honest reading time — it is printed on the card', () => {
    for (const [i, l] of LEARN_LESSONS.entries()) {
      const where = describeLesson(l, i);
      expect(Number.isInteger(l.minutes), `${where} minutes is a whole number`).toBe(true);
      expect(l.minutes, `${where} minutes`).toBeGreaterThan(0);
      // "a two-minute read on a phone, not an article" — the module's own words. Anything
      // claiming more than ten minutes is either wrong or is no longer this kind of content.
      expect(l.minutes, `${where} minutes`).toBeLessThanOrEqual(10);
    }
  });

  it('gives every lesson its own named badge, so none is unearnable or anonymous', () => {
    const badgeNames = LEARN_LESSONS.map(l => l.achievement.name);
    for (const [i, l] of LEARN_LESSONS.entries()) {
      const where = describeLesson(l, i);
      expect(l.achievement.name.trim(), `${where} badge name`).not.toBe('');
      expect(l.achievement.description.trim(), `${where} badge description`).not.toBe('');
    }
    // "One lesson, one badge, no compound achievements" — so two lessons must not award the
    // same-looking badge, which would read to the user as having earned it twice.
    expect(new Set(badgeNames).size).toBe(badgeNames.length);
  });

  it('keeps a title short enough to survive a notification', () => {
    // notification-policy truncates a title it is given. A lesson whose title only ever appears
    // ellipsised is a lesson nobody can identify from the notification that offered it.
    for (const [i, l] of LEARN_LESSONS.entries()) {
      expect(l.title.length, describeLesson(l, i)).toBeLessThanOrEqual(60);
    }
  });
});
