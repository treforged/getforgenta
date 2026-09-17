/**
 * ⚠️ THE ASSERTION THAT MATTERS IS THE SIGNED-OUT ONE, and it is worth saying why a test this
 * small exists at all.
 *
 * Tre, 2026-09-17, iOS 866, with a screenshot: a toast reading "Demo mode" on the app-lock PIN
 * screen, and again after backgrounding the app "for a period of time". He was never in demo
 * mode. He was SIGNED OUT - `ResumeRecovery` had found the session gone and signed him out
 * locally - and the guard's ternary separated only partner view, so `!user` fell through to the
 * literal sentinel `'Demo mode'`, which `onError: toast.error(e.message)` showed him verbatim.
 *
 * On a financial app those two messages lead to OPPOSITE conclusions about whether the numbers
 * on screen are his. That is why this is a correctness test and not a copy test.
 *
 * ⚠️ IT IS A DISCRIMINATING TRIPLE, NOT THREE SEPARATE CHECKS. Asserting only "signed-out does
 * not say Demo mode" is satisfied perfectly by a function that returns one string for
 * everything - so the demo and partner arms are load-bearing controls, not decoration. Each arm
 * must also be checked to NOT carry the other two messages, or a single catch-all sentence
 * passes all three.
 */
import { describe, it, expect } from 'vitest';
import {
  writeBlockedError,
  PARTNER_VIEW_READ_ONLY,
  DEMO_READ_ONLY,
  SIGNED_OUT_READ_ONLY,
} from '../write-guard';

const USER = { id: 'u1' };

describe('writeBlockedError names the CAUSE, never the mode', () => {
  it('a signed-out user is told their session ended - NOT that they are in a demo', () => {
    const msg = writeBlockedError({ isDemo: false, isPartnerView: false, user: null }).message;
    expect(msg).toBe(SIGNED_OUT_READ_ONLY);
    // The exact regression Tre reported. `i` because a future reword must not sneak it back.
    expect(msg).not.toMatch(/demo/i);
  });

  it('an undefined user is the same case as a null one', () => {
    expect(writeBlockedError({ isDemo: false, user: undefined }).message).toBe(SIGNED_OUT_READ_ONLY);
  });

  it('CONTROL: a real demo user still gets a demo message', () => {
    const msg = writeBlockedError({ isDemo: true, isPartnerView: false, user: USER }).message;
    expect(msg).toBe(DEMO_READ_ONLY);
    expect(msg).not.toBe(SIGNED_OUT_READ_ONLY);
  });

  it('CONTROL: partner view keeps the message that already shipped', () => {
    const msg = writeBlockedError({ isDemo: false, isPartnerView: true, user: USER }).message;
    expect(msg).toBe(PARTNER_VIEW_READ_ONLY);
    expect(msg).not.toBe(SIGNED_OUT_READ_ONLY);
    expect(msg).not.toBe(DEMO_READ_ONLY);
  });

  it('PRECEDENCE: partner view wins over demo, which is what shipped before this change', () => {
    expect(writeBlockedError({ isDemo: true, isPartnerView: true, user: USER }).message)
      .toBe(PARTNER_VIEW_READ_ONLY);
  });

  it('a demo session with no user is still told it is the demo, not that it signed out', () => {
    // Demo is entered without signing in, so this pairing is the NORMAL demo state, not an edge
    // case - getting it wrong would tell every demo visitor their session had ended.
    expect(writeBlockedError({ isDemo: true, user: null }).message).toBe(DEMO_READ_ONLY);
  });

  it('the three messages are genuinely distinct', () => {
    const all = [PARTNER_VIEW_READ_ONLY, DEMO_READ_ONLY, SIGNED_OUT_READ_ONLY];
    expect(new Set(all).size).toBe(3);
  });
});
