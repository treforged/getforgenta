// Measure the wait after Face ID (ask 98cbf494, Tre: "the cover page lingers with no feedback").
//
// AppDelegate.swift and src/lib/debugLog.ts both write "<epochMillis>|<event>" lines to Preferences
// 'forged:debug_log'. AppLockContext logs JS:FACEID_OK when Face ID resolves and JS:UNLOCK_PAINTED
// two frames after the lock screen is gone; AppDelegate logs BECOME_ACTIVE, COVER_BRANCH and (from
// the build that adds it) COVER_HIDDEN. That log never leaves the phone, so this file turns each
// unlock into one public.client_boot_failures row (path 'unlock-timing') the desk can read with SQL.
//
// Pure: parsing and grouping only. The caller in main.tsx / AppLockContext owns storage and the insert.

export interface UnlockTiming {
  at: string;
  reason: string;
  ts: number;
}

interface Entry {
  ts: number;
  event: string;
}

const FACEID_OK = 'JS:FACEID_OK';
const PAINTED = 'JS:UNLOCK_PAINTED';
const ACTIVE = 'BECOME_ACTIVE';
const BRANCH = 'COVER_BRANCH:';
/** AppDelegate.hideNativeCover logs this exact string; unlock-timing-native.gate.test.ts pins the pair. */
export const COVER_HIDDEN_EVENT = 'COVER_HIDDEN';
const HIDDEN = COVER_HIDDEN_EVENT;
const LOOKBACK_MS = 5_000;
const LOOKAHEAD_MS = 10_000;

function parseLog(log: string): Entry[] {
  return log.split(/\r?\n/).flatMap((line): Entry[] => {
    const sep = line.indexOf('|');
    if (sep === -1) return [];
    const tsPart = line.slice(0, sep).trim();
    // Number('') is 0, so require digits rather than trusting Number().
    if (!/^\d+$/.test(tsPart)) return [];
    return [{ ts: Number(tsPart), event: line.slice(sep + 1).trim() }];
  });
}

const fmt = (ms: number | null) => (ms === null ? 'n/a' : `${ms}ms`);

/** Index of the last entry before `i`, within LOOKBACK_MS, whose event matches; -1 when none. */
function lastBefore(entries: Entry[], i: number, match: (e: string) => boolean): number {
  for (let k = i - 1; k >= 0 && entries[i].ts - entries[k].ts <= LOOKBACK_MS; k--) {
    if (match(entries[k].event)) return k;
  }
  return -1;
}

/**
 * One timing per Face ID unlock newer than `afterTs`, oldest first. An unlock is reported only once
 * it is finished: its paint mark is in the log, or the log already runs past its look-ahead window.
 * A half-finished unlock is left for the next call rather than reported with a missing figure.
 */
export function findUnlockTimings(log: string | null, afterTs: number): UnlockTiming[] {
  if (!log) return [];
  const entries = parseLog(log);
  const lastTs = entries.length ? entries[entries.length - 1].ts : 0;
  const timings: UnlockTiming[] = [];

  entries.forEach((entry, i) => {
    if (entry.event !== FACEID_OK || entry.ts <= afterTs) return;

    const activeIdx = lastBefore(entries, i, e => e.startsWith(ACTIVE));
    const branchIdx = lastBefore(entries, i, e => e.startsWith(BRANCH));
    const branch = branchIdx === -1
      ? 'none'
      : entries[branchIdx].event.slice(BRANCH.length).trim().split(/\s/)[0] || 'none';

    // Forward window: up to LOOKAHEAD_MS, and never past the next unlock.
    let end = i + 1;
    while (end < entries.length && entries[end].ts - entry.ts <= LOOKAHEAD_MS && entries[end].event !== FACEID_OK) end++;

    const painted = entries.slice(i + 1, end).find(e => e.event === PAINTED);
    // The cover can lift BEFORE Face ID resolves, so look from the activation, not from FACEID_OK.
    const hiddenFrom = activeIdx === -1 ? i + 1 : activeIdx + 1;
    const hidden = entries.slice(hiddenFrom, end).find(e => e.event.startsWith(HIDDEN));

    const finished = painted !== undefined || lastTs > entry.ts + LOOKAHEAD_MS || end < entries.length;
    if (!finished) return;

    const paintedMs = painted ? painted.ts - entry.ts : null;
    const hiddenMs = hidden ? hidden.ts - entry.ts : null;
    const activeMs = activeIdx === -1 ? null : entry.ts - entries[activeIdx].ts;
    timings.push({
      at: new Date(entry.ts).toISOString(),
      reason: `unlock timing: faceid->painted=${fmt(paintedMs)} | faceid->cover_hidden=${fmt(hiddenMs)} | active->faceid=${fmt(activeMs)} | branch=${branch}`.slice(0, 200),
      ts: entry.ts,
    });
  });
  return timings;
}

export const UNLOCK_REPORTED_KEY = 'forged:unlock_timing_reported_ts';
/** A 200-line log holds few unlocks; this only bounds a pathological one. */
export const MAX_UNLOCK_REPORTS = 5;

export interface UnlockReportIo {
  readLog: () => Promise<string | null>;
  readMark: () => Promise<string | null>;
  writeMark: (ts: string) => Promise<void>;
  send: (t: UnlockTiming) => Promise<boolean>;
}

/** Same watermark contract as reportCoverDeadlines: advance past each ACCEPTED send, stop on a refusal, never throw. */
export async function reportUnlockTimings(io: UnlockReportIo): Promise<{ sent: number; pending: number }> {
  try {
    const markRaw = await io.readMark();
    const mark = markRaw && /^\d+$/.test(markRaw) ? Number(markRaw) : 0;
    const timings = findUnlockTimings(await io.readLog(), mark).slice(-MAX_UNLOCK_REPORTS);
    let sent = 0;
    for (const t of timings) {
      let ok: boolean;
      try { ok = await io.send(t); } catch { ok = false; }
      if (!ok) break;
      await io.writeMark(String(t.ts));
      sent++;
    }
    return { sent, pending: timings.length - sent };
  } catch {
    return { sent: 0, pending: 0 };
  }
}
