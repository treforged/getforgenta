import { describe, it, expect } from 'vitest';
import {
  backLoadedMonthlyCeiling,
  levelMonthlyCeiling,
  runPaceToDeadline,
} from '../back-loaded-pace';

/**
 * TESTING THE HYPOTHESIS THAT STOPPED BACK-LOADED PACING SHIPPING.
 *
 * `447d57ad` reverted the wiring on a measured regression and recorded a hypothesis for it,
 * LABELLED AS UNTESTED in the source: that the ramp is PATH-DEPENDENT in a way the level pace
 * is not, and that late in the run it "soaks up the surplus exactly during the card's endgame".
 * That commit also says, correctly, not to re-attempt the wiring as a slice.
 *
 * So this file does not re-attempt the wiring. It tests the HYPOTHESIS, on the pure functions,
 * because a recorded cause nobody re-tests is what stops the next session looking - and this
 * one blocks a feature Tre has actually asked for.
 *
 * ⚠️ WHAT THIS CANNOT SETTLE, said first so nothing here is over-read. These are the pacers in
 * isolation. The regression was measured inside the forecast engine WITH convergence, which
 * re-runs the projection and moves the remainders these functions read. A property proved here
 * is a property of the pacer; whether it survives contact with the engine is a separate
 * question and needs the engine. Nothing below claims otherwise.
 */

const NEED = 5730;      // Tre's real goal target
const MONTHS = 11;      // payments INCLUDING this one, per the revert's finding (1)

describe('hypothesis part 1 - is the ramp PATH-DEPENDENT where the level pace is not?', () => {
  /**
   * The claim needs a definition to be testable. Path-dependence here means: perturb ONE month
   * and see whether the schedule that follows is changed. Both pacers recompute from whatever
   * is REMAINING, so both respond to a perturbation - the question is by how much, and whether
   * either one recovers.
   */
  const shortMonth = (idx: number) => (i: number) => (i === idx ? 0 : Number.POSITIVE_INFINITY);

  it('POSITIVE CONTROL: unperturbed, both pacers finish and owe nothing', () => {
    const level = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling);
    const ramp = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling);
    expect(level.stillOwed).toBe(0);
    expect(ramp.stillOwed).toBe(0);
    expect(level.paid).toBeCloseTo(NEED, 2);
    expect(ramp.paid).toBeCloseTo(NEED, 2);
  });

  it('BOTH pacers absorb a lost month and still land the date - neither is fragile', () => {
    for (const idx of [0, 3, 7]) {
      const level = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling, shortMonth(idx));
      const ramp = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling, shortMonth(idx));
      expect(level.stillOwed, `level, month ${idx} lost`).toBe(0);
      expect(ramp.stillOwed, `ramp, month ${idx} lost`).toBe(0);
    }
  });

  /**
   * THE MEASUREMENT THE HYPOTHESIS ACTUALLY NEEDS. A perturbation changes the schedule that
   * follows under BOTH pacers, so "the ramp is path-dependent" is only interesting if the ramp
   * is MORE sensitive. Sensitivity is measured as the total absolute change across the
   * remaining months, in money.
   */
  it('MEASURES which pacer is more disturbed by a lost month', () => {
    const rows: string[] = [];
    let rampWorse = 0;
    let levelWorse = 0;

    for (const idx of [0, 2, 5, 8]) {
      const baseL = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling).perMonth;
      const baseR = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling).perMonth;
      const pertL = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling, shortMonth(idx)).perMonth;
      const pertR = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling, shortMonth(idx)).perMonth;

      // Only the months AFTER the perturbation - the perturbed month itself is 0 by construction
      // under both, so including it would add the same number to each and flatter neither.
      const drift = (a: number[], b: number[]) =>
        a.slice(idx + 1).reduce((s, v, i) => s + Math.abs(v - b.slice(idx + 1)[i]), 0);

      const dL = drift(pertL, baseL);
      const dR = drift(pertR, baseR);
      if (dR > dL) rampWorse += 1; else levelWorse += 1;
      rows.push(`  month ${idx} lost -> level drifts $${dL.toFixed(2)}, ramp drifts $${dR.toFixed(2)}`);
    }

    console.log('\nPATH SENSITIVITY (total absolute change in the months that follow):');
    for (const r of rows) console.log(r);
    console.log(`  ramp more disturbed in ${rampWorse} of 4 cases; level in ${levelWorse}`);

    // ⚠️ `rampWorse + levelWorse === 4` WAS THE FIRST ASSERTION HERE AND IT CANNOT FAIL - it is
    // the count of cases summed back to the number of cases. A check that cannot go red is not
    // a check. What follows pins the MEASURED FACTS instead, so a future change to either pacer
    // that alters this picture goes red and the hypothesis gets rewritten deliberately.
    expect(rampWorse).toBe(1);
    expect(levelWorse).toBe(3);
  });

  /**
   * 🚨 THE RECORDED HYPOTHESIS IS REFUTED AS STATED, AND THE TRUTH IS MORE USEFUL.
   *
   * `back-loaded-pace.ts` says the ramp is "PATH-DEPENDENT in a way the level pace is not".
   * Measured: BOTH are path-dependent, and the ramp is markedly LESS sensitive than the level
   * pace for most of the run - it only overtakes near the deadline.
   *
   * The level pace's drift is CONSTANT wherever the loss lands, because it simply re-divides
   * what is left over the months that remain. The ramp's drift RISES steeply toward the
   * deadline, because its claim on what remains rises steeply too.
   */
  it('REFUTES "path-dependent where the level pace is not" - it is less so early, more so late', () => {
    const shortAt = (idx: number) => {
      const baseL = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling).perMonth;
      const baseR = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling).perMonth;
      const pertL = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling, shortMonth(idx)).perMonth;
      const pertR = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling, shortMonth(idx)).perMonth;
      const drift = (a: number[], b: number[]) =>
        a.slice(idx + 1).reduce((s, v, i) => s + Math.abs(v - b.slice(idx + 1)[i]), 0);
      return { level: drift(pertL, baseL), ramp: drift(pertR, baseR) };
    };

    // Early and mid run: the ramp is the STEADIER of the two, by a wide margin.
    for (const idx of [0, 2, 5]) {
      const d = shortAt(idx);
      expect(d.ramp, `month ${idx}`).toBeLessThan(d.level);
    }
    // Late: it overtakes. This is the half of the hypothesis that survives.
    const late = shortAt(8);
    expect(late.ramp).toBeGreaterThan(late.level);

    // And the level pace's drift does not depend on WHEN the month was lost.
    expect(shortAt(0).level).toBeCloseTo(shortAt(5).level, 2);
  });

  /**
   * ⚠️ PINS THE EXACT FIGURES QUOTED IN `back-loaded-pace.ts`.
   *
   * The refutation recorded there carries a table of measured drifts. Mutation showed the
   * comparison assertions above survive a ramp twice as steep - so those numbers could have
   * drifted out of true with nothing going red, and a stale table beside a correct mechanism is
   * exactly the failure this file was written to fix. If a pacer changes, this goes red and the
   * table gets rewritten deliberately rather than quietly becoming fiction.
   */
  it('pins the drift figures the source docstring quotes', () => {
    const drifts = [0, 2, 5, 8].map((idx) => {
      const baseL = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling).perMonth;
      const baseR = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling).perMonth;
      const pertL = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling, shortMonth(idx)).perMonth;
      const pertR = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling, shortMonth(idx)).perMonth;
      const drift = (a: number[], b: number[]) =>
        a.slice(idx + 1).reduce((s, v, i) => s + Math.abs(v - b.slice(idx + 1)[i]), 0);
      return { idx, level: drift(pertL, baseL), ramp: drift(pertR, baseR) };
    });

    for (const d of drifts) expect(d.level, `level @${d.idx}`).toBeCloseTo(520.91, 2);
    expect(drifts[0].ramp).toBeCloseTo(86.82, 2);
    expect(drifts[1].ramp).toBeCloseTo(123.12, 2);
    expect(drifts[2].ramp).toBeCloseTo(241.85, 2);
    expect(drifts[3].ramp).toBeCloseTo(677.18, 2);

    // The endgame figures the docstring also quotes.
    const level = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling).perMonth;
    const ramp = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling).perMonth;
    const first3 = (a: number[]) => a.slice(0, 3).reduce((s, v) => s + v, 0);
    const last3 = (a: number[]) => a.slice(-3).reduce((s, v) => s + v, 0);
    expect(first3(level) - first3(ramp)).toBeCloseTo(1250.18, 2);
    expect(last3(ramp) - last3(level)).toBeCloseTo(2500.36, 2);
  });
});

describe('hypothesis part 2 - does the ramp take more during the ENDGAME?', () => {
  /**
   * The revert says the ramp "soaks up the surplus exactly during the card's endgame". That is
   * not really a hypothesis - it is the feature's DEFINING PROPERTY, and an existing test
   * already asserts the ramp takes more in the last months. What was never quantified is HOW
   * MUCH, which is the number that decides whether a payoff month can slip.
   */
  it('QUANTIFIES the money moved from the early months into the late ones', () => {
    const level = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling).perMonth;
    const ramp = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling).perMonth;

    const first = (a: number[], k: number) => a.slice(0, k).reduce((s, v) => s + v, 0);
    const last = (a: number[], k: number) => a.slice(-k).reduce((s, v) => s + v, 0);

    const freedEarly = first(level, 3) - first(ramp, 3);
    const extraLate = last(ramp, 3) - last(level, 3);

    console.log('\nENDGAME LOAD:');
    console.log(`  first 3 months  level $${first(level, 3).toFixed(2)}  ramp $${first(ramp, 3).toFixed(2)}  freed $${freedEarly.toFixed(2)}`);
    console.log(`  last  3 months  level $${last(level, 3).toFixed(2)}  ramp $${last(ramp, 3).toFixed(2)}  extra $${extraLate.toFixed(2)}`);

    // Both directions must hold, or the ramp is not doing what it says on the tin.
    expect(freedEarly).toBeGreaterThan(0);
    expect(extraLate).toBeGreaterThan(0);
  });

  /**
   * 🚨 THE FINDING THAT ACTUALLY EXPLAINS THE REGRESSION, and it is arithmetic rather than a
   * guess about convergence.
   *
   * Back-loading is CASH-NEUTRAL over the horizon by construction - both pacers pay exactly
   * `need`. So it cannot, on its own, save a penny of card interest. All it does is MOVE the
   * goal's draw later. The card only gains if the money freed early is APPLIED TO THE CARD, and
   * the goal only costs the card nothing extra if the card is already clear by the late months.
   *
   * The reverted wiring deferred the goal's draw and left the freed cash as ordinary surplus for
   * the engine to allocate by its own rules. If that surplus does not go to the card, the trade
   * is: nothing gained early, and MORE taken late - which is precisely a payoff month slipping
   * from Sep to Oct 2028.
   *
   * So the missing half is REDIRECTION, not a better ramp, and that matches Tre's own words -
   * "the goals is to save on interest when there is credit card debt" names the destination of
   * the freed money, which the wiring never implemented.
   */
  it('proves back-loading is CASH-NEUTRAL, so it cannot save interest without redirection', () => {
    const level = runPaceToDeadline(NEED, MONTHS, levelMonthlyCeiling);
    const ramp = runPaceToDeadline(NEED, MONTHS, backLoadedMonthlyCeiling);

    expect(ramp.paid).toBeCloseTo(level.paid, 2);
    expect(ramp.paid).toBeCloseTo(NEED, 2);

    console.log('\nCASH NEUTRALITY:');
    console.log(`  level total $${level.paid.toFixed(2)}   ramp total $${ramp.paid.toFixed(2)}`);
    console.log('  => the ramp MOVES money in time; it does not create any. Interest is saved');
    console.log('     only if what is freed early is APPLIED TO THE CARD.');
  });

  /**
   * And the fraction of what REMAINS that the ramp claims rises steeply as the deadline nears.
   * At n=1 it is the whole remaining need by definition. This is why a late-clearing card and a
   * dated goal compete: the goal's claim is largest exactly when the card is finishing.
   */
  it('shows the ramp claiming a rising share of what remains as the deadline nears', () => {
    const rows = [12, 6, 3, 2, 1].map((n) => ({
      monthsLeft: n,
      rampShare: backLoadedMonthlyCeiling(1000, n) / 1000,
      levelShare: levelMonthlyCeiling(1000, n) / 1000,
    }));
    console.log('\nSHARE OF WHAT REMAINS:');
    for (const r of rows) {
      console.log(`  ${String(r.monthsLeft).padStart(2)} months left  ramp ${(r.rampShare * 100).toFixed(1)}%  level ${(r.levelShare * 100).toFixed(1)}%`);
    }

    // Rising toward the deadline under both.
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].rampShare).toBeGreaterThan(rows[i - 1].rampShare);
    }

    // ⚠️ AND THE COMPARISON GOES THE OTHER WAY FROM THE OBVIOUS READING: at the SAME months-left
    // and the SAME remaining need, the ramp claims LESS than the level pace, never more. The
    // ramp only ends up taking more late because it has DEFERRED more to still be owed by then.
    // A point comparison would have suggested the opposite, which is why the trajectory above is
    // the honest instrument and this is asserted rather than assumed.
    for (const r of rows.filter((x) => x.monthsLeft > 1)) {
      expect(r.rampShare).toBeLessThan(r.levelShare);
    }
  });
});
