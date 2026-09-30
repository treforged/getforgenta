// Preload for `npm run check:time-bombs`: moves the REAL clock to FAKE_NOW (an ISO date) for the
// whole process, keeping it ticking. A test that pins the clock with vi.useFakeTimers/setSystemTime
// replaces Date again and is unaffected - so only tests that read the real date can change result.
// Loaded with --import; does nothing when FAKE_NOW is unset.
const target = process.env.FAKE_NOW;
if (target) {
  const RealDate = Date;
  const offset = new RealDate(target).getTime() - RealDate.now();
  if (Number.isNaN(offset)) throw new Error(`shift-clock: FAKE_NOW is not a date: ${target}`);
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = ShiftedDate;
}
