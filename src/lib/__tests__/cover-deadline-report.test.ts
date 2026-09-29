// Ask e7d28de3: the native cover's COVER_DEADLINE lines become client_boot_failures rows.
import { describe, it, expect } from "vitest";
import {
  findCoverDeadlineIncidents,
  reportCoverDeadlines,
  MAX_REPORTS_PER_BOOT,
  type CoverDeadlineIncident,
} from "@/lib/cover-deadline-report";

describe("findCoverDeadlineIncidents", () => {
  it("real episode case", () => {
    const log = `1000|COVER_BRANCH:bg_poll → poll 20\n2000|RELOAD_TRIGGERED bgReload=true\n5000|COVER_DEADLINE → reload\n6000|RELOAD_TRIGGERED bgReload=true\n9000|COVER_DEADLINE → force hide`;
    const incidents = findCoverDeadlineIncidents(log, 0);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].ts).toBe(9000);
    expect(incidents[0].at).toBe(new Date(9000).toISOString());
    expect(incidents[0].reason).toBe("native cover deadline: → reload + → force hide | branch=bg_poll → poll 20 | reloads=2");
  });

  it("afterTs=9000 returns empty, afterTs=8999 returns one", () => {
    const log = `5000|COVER_DEADLINE → reload\n9000|COVER_DEADLINE → force hide`;
    expect(findCoverDeadlineIncidents(log, 9000)).toHaveLength(0);
    expect(findCoverDeadlineIncidents(log, 8999)).toHaveLength(1);
  });

  it("two episodes separated by a new COVER_BRANCH line", () => {
    const log = `1000|COVER_BRANCH:bg_poll → poll 20\n5000|COVER_DEADLINE → reload\n6000|RELOAD_TRIGGERED bgReload=true\n9000|COVER_DEADLINE → force hide\n10000|COVER_BRANCH:bg_reload → poll 30\n11000|COVER_DEADLINE → reload`;
    const incidents = findCoverDeadlineIncidents(log, 0);
    expect(incidents.map(i => i.ts)).toEqual([9000, 11000]);
    expect(incidents[0].reason).toContain("branch=bg_poll → poll 20");
    expect(incidents[1].reason).toContain("branch=bg_reload → poll 30");
  });

  it("deadline gap over 120000ms with no branch between", () => {
    const log = `1000|COVER_DEADLINE → reload\n121001|COVER_DEADLINE → force hide`;
    expect(findCoverDeadlineIncidents(log, 0).map(i => i.ts)).toEqual([1000, 121001]);
    // Exactly 120000 ms is still inside the window: one incident.
    const edge = `1000|COVER_DEADLINE → reload\n121000|COVER_DEADLINE → force hide`;
    expect(findCoverDeadlineIncidents(edge, 0).map(i => i.ts)).toEqual([121000]);
  });

  it("no branch before deadline", () => {
    const log = `5000|COVER_DEADLINE → reload\n6000|RELOAD_TRIGGERED bgReload=true\n9000|COVER_DEADLINE → force hide`;
    const incidents = findCoverDeadlineIncidents(log, 0);
    expect(incidents[0].reason).toContain("branch=unknown");
  });

  it("malformed lines are skipped", () => {
    const log = `garbage\n|COVER_DEADLINE → reload\nabc|COVER_DEADLINE → reload`;
    const incidents = findCoverDeadlineIncidents(log, 0);
    expect(incidents).toHaveLength(0);
    expect(findCoverDeadlineIncidents(null, 0)).toEqual([]);
    expect(findCoverDeadlineIncidents("", 0)).toEqual([]);
  });

  it("reason truncated to 200 chars", () => {
    const branch = "a".repeat(500);
    const log = `1000|COVER_BRANCH:${branch}\n5000|COVER_DEADLINE → reload`;
    const incidents = findCoverDeadlineIncidents(log, 0);
    expect(incidents[0].reason.length).toBe(200);
  });
});

/** One episode per ts: a branch line then a deadline, so every ts is its own incident. */
const episodes = (tss: number[]) =>
  tss.map(ts => `${ts - 1}|COVER_BRANCH:bg_poll → poll 20\n${ts}|COVER_DEADLINE → force hide`).join("\n");

function fakeIo(log: string | null, sendResults: boolean[]) {
  const store: { mark: string | null } = { mark: null };
  const sent: CoverDeadlineIncident[] = [];
  const marks: string[] = [];
  const results = [...sendResults];
  return {
    store, sent, marks,
    io: {
      readLog: async () => log,
      readMark: async () => store.mark,
      writeMark: async (ts: string) => { store.mark = ts; marks.push(ts); },
      send: async (inc: CoverDeadlineIncident) => { sent.push(inc); return results.length ? results.shift()! : true; },
    },
  };
}

describe("reportCoverDeadlines", () => {
  it("stops at a refused send, keeps the mark on the last success, and retries the rest next boot", async () => {
    const f = fakeIo(episodes([1000, 2000]), [true, false]);
    expect(await reportCoverDeadlines(f.io)).toEqual({ sent: 1, pending: 1 });
    expect(f.marks).toEqual(["1000"]);

    const again = await reportCoverDeadlines(f.io); // same store, send now succeeds
    expect(again).toEqual({ sent: 1, pending: 0 });
    expect(f.sent.map(i => i.ts)).toEqual([1000, 2000, 2000]);
    expect(f.store.mark).toBe("2000");
    expect(await reportCoverDeadlines(f.io)).toEqual({ sent: 0, pending: 0 });
  });

  it("never advances the mark past a refused incident, even when a later one is accepted", async () => {
    const f = fakeIo(episodes([1000, 2000]), [false, true]);
    expect(await reportCoverDeadlines(f.io)).toEqual({ sent: 0, pending: 2 });
    expect(f.store.mark).toBeNull();
    expect(f.sent.map(i => i.ts)).toEqual([1000]);
  });

  it("treats a malformed mark as 0 and never throws when the log read fails", async () => {
    const f = fakeIo(episodes([1000]), []);
    f.store.mark = "abc";
    expect(await reportCoverDeadlines(f.io)).toEqual({ sent: 1, pending: 0 });
    const broken = { ...f.io, readLog: async () => { throw new Error("read error"); } };
    await expect(reportCoverDeadlines(broken)).resolves.toEqual({ sent: 0, pending: 0 });
  });

  it("sends at most MAX_REPORTS_PER_BOOT, the newest", async () => {
    const f = fakeIo(episodes([1000, 2000, 3000, 4000, 5000, 6000, 7000]), []);
    expect(await reportCoverDeadlines(f.io)).toEqual({ sent: MAX_REPORTS_PER_BOOT, pending: 0 });
    expect(f.sent.map(i => i.ts)).toEqual([3000, 4000, 5000, 6000, 7000]);
  });
});
