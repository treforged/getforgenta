// @vitest-environment jsdom
//
// DIAGNOSTIC, NOT A GATE - what his Robinhood row actually pays, read through the REAL projection
// hook on HIS OWN rows, under BOTH payment preferences he has had today.
//
// Tre, 2026-09-17 ~03:00: "I saw on dashboard that in the deck recommended this month section
// Robinhood is showing next payment zero dollars. This is most likely due to the issue we already
// having but just know that in case it doesn't fix."
//
// ⚠️ THIS DOES NOT CLOSE ASK `48a185d1`, AND IT MUST NOT BE READ AS DOING SO. That ask is open on
// "verify on his screen", and the reason recorded there is right: minting a session for his
// account to take a screenshot is impersonation, not verification. A number that is correct in
// the model can still be drawn wrong, and only he can see the drawing.
//
// WHAT IT ADDS over the synthetic unit test already on file: HIS ROWS, through the real
// `useCardProjection`, so a disagreement between the engine and the wiring is visible - which a
// hand-built card shape cannot show.
//
// ⚠️ TWO CAPTURES, AND WHICH IS WHICH IS LOAD-BEARING. He changed the card's preference at
// 14:19:47Z today, so the captures straddle it:
//     FRESH-2026-09-17      13:50Z   payment_preference = 'full'        (what he reported on)
//     STATEMENT-2026-09-17  14:54Z   payment_preference = 'statement'   (what he has now)
// Both assertions were read back out of the files rather than assumed - an earlier draft of this
// file claimed FRESH was the statement-era capture and was simply wrong.
//
// NEITHER IS THE GOLDEN FIXTURE, deliberately. `forecast-inputs.real.json` is still the 08-31
// golden that every pinned assertion in this repo is measured against; adopting a newer one is
// its own task. Nothing here swaps a file.
//
// WHAT IT READ, 2026-09-17, on commit fa896f1a - and it ANSWERS what he asked:
//   'full'      m0 pay 0, end 554.27  |  m1 pay 554, end 280  |  m2 pay 280, end 280
//   'statement' m0 pay 0, end 554.27  |  m1 pay 554, end 0    |  m2 pay 280, end 0
//
// HIS "$0 NEXT PAYMENT" IS CORRECT AND IS NOT THE BUG HE FEARED. His due day is the 10th and the
// capture is the 17th, so September is already billed and paid; the card is not billed again
// until October, which pays 554 - the whole balance. Interest is 0 in every month under both
// preferences, which is the grace fix still holding.
//
// AND THE 'full' ROW IS DIRECT EVIDENCE OF THE DUE-DATE FIX ON HIS OWN DATA: month 1 pays 554,
// which is the start balance, NOT 834. The 280 of October purchases lands after the 10th, so it
// is not in the payment made on the 10th - which is exactly what he said should happen.
//
// SKIPS when a fixture is absent, the way every real-data test here does - gitignored financial
// data that CI never has.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const ROBINHOOD = 'Robinhood Credit Card';
const fixture = (name: string) => join(__dirname, 'fixtures', `forecast-inputs.real.${name}.json`);

const CASES = [
  { label: "as he reported it ('full')", file: 'FRESH-2026-09-17', expectPreference: 'full' },
  { label: "as it stands now ('statement')", file: 'STATEMENT-2026-09-17', expectPreference: 'statement' },
];

afterEach(() => vi.useRealTimers());

for (const c of CASES) {
  const maybe = existsSync(fixture(c.file)) ? describe : describe.skip;

  maybe(`his Robinhood row, ${c.label}`, () => {
    it('reads months 0-2 through the real hook, and is not silently absent', () => {
      const capture = reviveForecastCapture(readFileSync(fixture(c.file), 'utf8'));
      // `capture.clock`, never `new Date(capturedAt)` - the io module's own doc records that
      // pinning the raw instant is what produced a $799 phantom divergence.
      vi.setSystemTime(capture.clock);

      // CAPTURE the engine's own reconciliation warnings for this run. `projectCardVariable`
      // emits them on console.warn, and vitest SUPPRESSES stderr on a PASSING file - which is
      // exactly how a run that looked clean hid 277 of them from me earlier today.
      const warned: string[] = [];
      const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
        warned.push(a.map(String).join(' '));
      });

      let proj;
      try {
        proj = renderProjectionFromFixture(capture.inputs);
      } finally {
        spy.mockRestore(); // a spy left installed silences every later test in the file
      }

      // POSITIVE CONTROL FIRST. A zero read off a card the harness never found and a zero read
      // off a card that genuinely pays nothing are the same zero.
      const names = proj.perCardPayments.map(p => p.name);
      expect(names.length).toBeGreaterThan(0);
      const pay = proj.perCardPayments.find(p => p.name === ROBINHOOD);
      expect(pay, `no card named "${ROBINHOOD}" among: ${names.join(', ')}`).toBeTruthy();

      const card = proj.simCards.find(x => x.id === pay!.id)!;
      // The capture is the subject, so assert it really is the era this case claims. Otherwise a
      // renamed or mis-copied file silently makes both cases the same reading.
      expect(card.paymentPreference).toBe(c.expectPreference);

      const bals = proj.monthlyBalances.get(pay!.id)!;
      const ints = proj.monthlyInterest.get(pay!.id)!;
      const months = [0, 1, 2].map(i => ({
        m: i,
        payment: Math.round((pay!.payments[i] ?? 0) * 100) / 100,
        interest: Math.round((ints[i] ?? 0) * 100) / 100,
        endBalance: Math.round((bals[i] ?? 0) * 100) / 100,
      }));
      // The reading IS the output of this file. (No eslint-disable: `no-console` is not enabled
      // for tests here, and a directive for a rule nobody turned on is its own small lie.)
      console.log(
        `[${ROBINHOOD}] ${c.label} preference=${card.paymentPreference} dueDay=${card.dueDay} `
        + `startBalance=${card.balance} capturedAt=${capture.capturedAt} `
        + JSON.stringify(months),
      );

      // Deliberately no pinned figure. This is a diagnostic; a number pinned here goes stale the
      // next time he spends money and then reads as a regression.
      expect(bals.length).toBeGreaterThan(2);
      expect(pay!.payments.length).toBeGreaterThan(2);

      // ── THE ROW MUST ADD UP ─────────────────────────────────────────────────────────────
      // This IS an assertion, not a reading. `projectCardVariable` warns whenever a displayed
      // row breaks End = Start + purchases + interest - payment, which is precisely the defect
      // he reported this morning ("Start 262, purchases 280, payment 542, End 280").
      //
      // ⚠️ THE GOLDEN 08-31 FIXTURE PRODUCES 80 OF THESE FOR THIS SAME ACCOUNT - under its old
      // name, "Robinhood Gold Card" (same id 7b1e9a44, renamed since). In that snapshot the card
      // has balance 0, due day 12 and NO `first_payment_due_date`, because the first-due-date
      // feature shipped 2026-09-05, after the capture. So this assertion is the thing that tells
      // a STALE-FIXTURE ARTEFACT apart from a live defect: if his CURRENT rows are clean, those
      // 80 are about the fixture, not about the app.
      const mine = warned.filter(w => w.includes(ROBINHOOD) && w.includes('does not reconcile'));
      expect(mine, 'rows that do not add up: ' + mine.join(' | ')).toEqual([]);

      // The POSITIVE CONTROL for that empty array is a separate case below, against the golden
      // fixture, which is KNOWN to warn for this same account. An empty array here and a spy that
      // never attached are otherwise the same result.
    });
  });
}

/**
 * POSITIVE CONTROL FOR THE ASSERTION ABOVE, and it is the whole reason that assertion means
 * anything. The golden 08-31 capture holds the SAME ACCOUNT (id 7b1e9a44) under its former name,
 * "Robinhood Gold Card", in a state that predates the first-due-date feature: balance 0, due day
 * 12, no `first_payment_due_date`. It produces reconciliation warnings, and this requires them.
 *
 * So the pair reads: the instrument CAN see a non-reconciling row (here), and does NOT see one on
 * his current rows (above). Without this half, "no warnings" is equally satisfied by a spy that
 * never attached, a filter that matches nothing, and an engine that stopped checking.
 *
 * ⚠️ IF THIS EVER GOES GREEN, DO NOT DELETE IT - it means the golden fixture was replaced, and
 * the control needs re-aiming at whatever the new known-bad case is. A silently removed control
 * is how the assertion above quietly stops being evidence.
 */
const GOLDEN = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const goldenMaybe = existsSync(GOLDEN) ? describe : describe.skip;

goldenMaybe('POSITIVE CONTROL - the golden 08-31 capture DOES produce non-reconciling rows', () => {
  it('warns for the same account under its old name, so the silence above is meaningful', () => {
    const capture = reviveForecastCapture(readFileSync(GOLDEN, 'utf8'));
    vi.setSystemTime(capture.clock);

    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warned.push(a.map(String).join(' '));
    });
    try {
      renderProjectionFromFixture(capture.inputs);
    } finally {
      spy.mockRestore();
    }

    const golden = warned.filter(w => w.includes('does not reconcile'));
    expect(golden.length).toBeGreaterThan(0);
  });
});
