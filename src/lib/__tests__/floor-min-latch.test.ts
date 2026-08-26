// The latch's pure state machine, testable without the gitignored real fixture (the full-loop
// regression lives in forecast-convergence.floorFlicker.test.ts and self-skips on CI). Sequences
// mirror the measured 2026-08-25 $8,000-shock trace: Discover's m17 reservation alternating
// between the revolving-branch formula minimum (~$47-124) and the cycling-branch static
// min_payment ($253.00) as successive convergence passes paid the card off and un-paid it.

import { describe, it, expect } from 'vitest';
import { createFloorMinLatch } from '@/lib/floor-min-latch';

describe('createFloorMinLatch', () => {
  it('passes amounts through untouched while a pair stays in one regime', () => {
    const latch = createFloorMinLatch();
    expect(latch.observe(17, 'discover', 'rev', 50.15)).toBe(50.15);
    expect(latch.observe(17, 'discover', 'rev', 47.23)).toBe(47.23);
    expect(latch.observe(17, 'discover', 'rev', 46.32)).toBe(46.32);
  });

  it('allows a single regime change — a monotone payoff-date drift is not a flicker', () => {
    const latch = createFloorMinLatch();
    expect(latch.observe(17, 'discover', 'rev', 50.15)).toBe(50.15);
    // Card pays off a pass later; the cycling reservation replaces the formula minimum.
    expect(latch.observe(17, 'discover', 'cyc', 253.0)).toBe(253.0);
    // Stays paid off: natural amounts keep flowing through, no force.
    expect(latch.observe(17, 'discover', 'cyc', 253.0)).toBe(253.0);
  });

  it('latches on the second regime change and forces the largest amount seen from then on', () => {
    const latch = createFloorMinLatch();
    // The measured m17 sequence: rev → cyc → rev is the flicker signature (change #2).
    expect(latch.observe(17, 'discover', 'rev', 50.15)).toBe(50.15);
    expect(latch.observe(17, 'discover', 'cyc', 253.0)).toBe(253.0);
    expect(latch.observe(17, 'discover', 'rev', 123.9)).toBe(253.0);
    // Every later pass is forced up to the max regardless of the natural regime…
    expect(latch.observe(17, 'discover', 'cyc', 253.0)).toBe(253.0);
    expect(latch.observe(17, 'discover', 'rev', 47.23)).toBe(253.0);
    // …and never down: a natural amount above the recorded max wins (floor reads cash LOW).
    expect(latch.observe(17, 'discover', 'cyc', 300.0)).toBe(300.0);
  });

  it('latches a reservation that flickers fully in and out (rev ↔ none)', () => {
    // A card that does not qualify for the cycling branch reserves nothing when paid off.
    const latch = createFloorMinLatch();
    expect(latch.observe(9, 'other-card', 'rev', 25.0)).toBe(25.0);
    expect(latch.observe(9, 'other-card', 'none', 0)).toBe(0);
    expect(latch.observe(9, 'other-card', 'rev', 25.0)).toBe(25.0);
    // Latched now: the reservation can no longer vanish on the next flip.
    expect(latch.observe(9, 'other-card', 'none', 0)).toBe(25.0);
  });

  it('tracks (month, card) pairs independently', () => {
    const latch = createFloorMinLatch();
    // m17 flickers to a latch…
    latch.observe(17, 'discover', 'rev', 50.15);
    latch.observe(17, 'discover', 'cyc', 253.0);
    latch.observe(17, 'discover', 'rev', 123.9);
    // …the same card one month over, and another card in the same month, are untouched.
    expect(latch.observe(16, 'discover', 'rev', 62.28)).toBe(62.28);
    expect(latch.observe(17, 'visa', 'none', 0)).toBe(0);
  });

  it('cannot engage within two observations — 1-pass convergence is provably inert', () => {
    // runDebtCashConvergence performs exactly two engine calls when it converges on pass 1
    // (base + resim); two regime changes need three, so the golden captures cannot move.
    const latch = createFloorMinLatch();
    expect(latch.observe(17, 'discover', 'cyc', 253.0)).toBe(253.0);
    expect(latch.observe(17, 'discover', 'rev', 50.15)).toBe(50.15);
  });
});
