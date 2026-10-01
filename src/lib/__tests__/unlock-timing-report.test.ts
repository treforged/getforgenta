// Ask 98cbf494: each Face ID unlock becomes one 'unlock-timing' row, so the wait after Face ID is measurable.
import { describe, it, expect } from "vitest";
import { findUnlockTimings, reportUnlockTimings, MAX_UNLOCK_REPORTS } from "@/lib/unlock-timing-report";

const lines = (...l: string[]) => l.join("\n");

describe("findUnlockTimings", () => {
  it("measures a real resume: activation, Face ID, cover lift, paint", () => {
    const log = lines(
      "1000|RESIGN fromBg=false",
      "1200|BECOME_ACTIVE oauth=false fromBg=false firstLaunch=false wvKilled=false",
      "1201|COVER_BRANCH:brief → schedule 0.3s",
      "1450|JS:FACEID_OK",
      "1540|JS:UNLOCK_PERSISTED",
      "2000|COVER_HIDDEN",
      "2130|JS:UNLOCK_PAINTED",
    );
    const [t, ...rest] = findUnlockTimings(log, 0);
    expect(rest).toHaveLength(0);
    expect(t.ts).toBe(1450);
    expect(t.at).toBe(new Date(1450).toISOString());
    expect(t.reason).toBe("unlock timing: faceid->painted=680ms | faceid->cover_hidden=550ms | active->faceid=250ms | branch=brief | faceid->persisted=90ms");
  });

  it("RESUME: an activation that FOLLOWS Face ID is named as after=<branch>@<ms>", () => {
    // Build 1201, 2026-10-01: the Face ID sheet resigns the app, so BECOME_ACTIVE and the branch land AFTER FACEID_OK.
    const log = lines(
      "1000|JS:FACEID_OK", "1003|JS:UNLOCK_PAINTED", "1800|BECOME_ACTIVE fromBg=false",
      "1801|COVER_BRANCH:brief → schedule 0.15s", "2236|COVER_HIDDEN",
    );
    expect(findUnlockTimings(log, 0)[0].reason).toBe(
      "unlock timing: faceid->painted=3ms | faceid->cover_hidden=1236ms | active->faceid=n/a | branch=none | faceid->persisted=n/a | after=brief@801ms",
    );
  });

  it("an activation that follows with no branch line still reports when it came", () => {
    const log = lines("1000|JS:FACEID_OK", "1003|JS:UNLOCK_PAINTED", "1500|BECOME_ACTIVE x");
    expect(findUnlockTimings(log, 0)[0].reason).toContain("| after=none@500ms");
  });

  it("a cover that lifted BEFORE Face ID resolved reads negative, not missing", () => {
    const log = lines("1000|BECOME_ACTIVE x", "1100|COVER_HIDDEN", "1500|JS:FACEID_OK", "1600|JS:UNLOCK_PAINTED");
    expect(findUnlockTimings(log, 0)[0].reason).toContain("faceid->cover_hidden=-400ms");
  });

  it("older builds without COVER_HIDDEN and no activation read n/a and branch=none", () => {
    const log = lines("1500|JS:FACEID_OK", "1600|JS:UNLOCK_PAINTED");
    expect(findUnlockTimings(log, 0)[0].reason).toBe(
      "unlock timing: faceid->painted=100ms | faceid->cover_hidden=n/a | active->faceid=n/a | branch=none | faceid->persisted=n/a",
    );
  });

  it("an activation more than 5 s before Face ID is not this unlock's", () => {
    const log = lines("1000|BECOME_ACTIVE x", "1001|COVER_BRANCH:bg_poll → poll 20", "7000|JS:FACEID_OK", "7100|JS:UNLOCK_PAINTED");
    expect(findUnlockTimings(log, 0)[0].reason).toContain("active->faceid=n/a | branch=none");
  });

  it("holds back an unfinished unlock, then reports it once the log runs past its window", () => {
    const pending = lines("1000|BECOME_ACTIVE x", "1500|JS:FACEID_OK", "1600|COVER_HIDDEN");
    expect(findUnlockTimings(pending, 0)).toHaveLength(0);
    const later = lines(pending, "20000|RESIGN fromBg=false");
    expect(findUnlockTimings(later, 0)[0].reason).toContain("faceid->painted=n/a | faceid->cover_hidden=100ms");
  });

  it("never borrows the next unlock's marks", () => {
    const log = lines("1000|JS:FACEID_OK", "3000|JS:FACEID_OK", "3200|JS:UNLOCK_PAINTED");
    const ts = findUnlockTimings(log, 0);
    expect(ts.map(t => t.ts)).toEqual([1000, 3000]);
    expect(ts[0].reason).toContain("faceid->painted=n/a");
    expect(ts[1].reason).toContain("faceid->painted=200ms");
  });

  it("respects the watermark and ignores junk lines", () => {
    const log = lines("garbage", "|JS:FACEID_OK", "1000|JS:FACEID_OK", "1100|JS:UNLOCK_PAINTED");
    expect(findUnlockTimings(log, 1000)).toHaveLength(0);
    expect(findUnlockTimings(log, 999)).toHaveLength(1);
    expect(findUnlockTimings(null, 0)).toEqual([]);
  });
});

describe("reportUnlockTimings", () => {
  const log = lines(
    ...Array.from({ length: MAX_UNLOCK_REPORTS + 2 }, (_, k) => `${(k + 1) * 1000}|JS:FACEID_OK\n${(k + 1) * 1000 + 50}|JS:UNLOCK_PAINTED`),
  );

  it("sends the newest MAX, oldest first, and advances the mark past each accepted send", async () => {
    const sent: number[] = [];
    let mark: string | null = null;
    const r = await reportUnlockTimings({
      readLog: async () => log,
      readMark: async () => mark,
      writeMark: async ts => { mark = ts; },
      send: async t => { sent.push(t.ts); return true; },
    });
    expect(r).toEqual({ sent: MAX_UNLOCK_REPORTS, pending: 0 });
    expect(sent).toEqual([3000, 4000, 5000, 6000, 7000]);
    expect(mark).toBe("7000");
  });

  it("stops at a refused send and keeps the mark on the last success", async () => {
    let mark: string | null = "4500";
    let calls = 0;
    const r = await reportUnlockTimings({
      readLog: async () => log,
      readMark: async () => mark,
      writeMark: async ts => { mark = ts; },
      send: async () => ++calls === 1,
    });
    expect(r).toEqual({ sent: 1, pending: 2 });
    expect(mark).toBe("5000");
  });

  it("never throws when storage does", async () => {
    const r = await reportUnlockTimings({
      readLog: async () => { throw new Error("x"); },
      readMark: async () => null,
      writeMark: async () => {},
      send: async () => true,
    });
    expect(r).toEqual({ sent: 0, pending: 0 });
  });
});
