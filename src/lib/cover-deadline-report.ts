// Report the native cover's deadline to the desk (ask e7d28de3, Tre's iOS black screen).
//
// AppDelegate.swift writes "<epochMillis>|<event>" lines to Preferences 'forged:debug_log'. When the
// black+gold cover never sees the dashboard become ready, handleCoverDeadline() logs
// "COVER_DEADLINE → reload" and then, if that did not help, "COVER_DEADLINE → force hide". Until now
// those lines were only readable through the DBG panel on the device itself. This file turns them
// into public.client_boot_failures rows on the next good boot, so the desk can read them with SQL.
//
// Pure: parsing and grouping only. The caller in main.tsx owns storage and the insert.

export interface CoverDeadlineIncident {
  at: string;
  reason: string;
  ts: number;
}

interface Entry {
  ts: number;
  event: string;
}

const DEADLINE = 'COVER_DEADLINE';
const BRANCH = 'COVER_BRANCH';
const GROUP_WINDOW_MS = 120_000;

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

const isReload = (event: string) =>
  event.startsWith('RELOAD_TRIGGERED') || event.startsWith('PHONE_LOCK_RELOAD_TRIGGERED');

/**
 * Incidents whose last deadline line is newer than `afterTs`, oldest first.
 *
 * One incident = the deadline lines of one cover episode: "→ reload" and the "→ force hide" that
 * follows it belong together, even with a RELOAD_TRIGGERED line in between. A new COVER_BRANCH
 * (a new cover episode) or a gap over two minutes starts a new incident.
 */
export function findCoverDeadlineIncidents(log: string | null, afterTs: number): CoverDeadlineIncident[] {
  if (!log) return [];
  const entries = parseLog(log);
  const incidents: CoverDeadlineIncident[] = [];

  let i = 0;
  while (i < entries.length) {
    if (!entries[i].event.startsWith(DEADLINE)) { i++; continue; }

    const firstIdx = i;
    const firstTs = entries[i].ts;
    const groupIdx = [i];
    let j = i + 1;
    while (j < entries.length) {
      const e = entries[j];
      if (e.event.startsWith(BRANCH) || e.ts - firstTs > GROUP_WINDOW_MS) break;
      if (e.event.startsWith(DEADLINE)) groupIdx.push(j);
      j++;
    }
    const lastIdx = groupIdx[groupIdx.length - 1];
    const last = entries[lastIdx];

    if (last.ts > afterTs) {
      let branchIdx = -1;
      for (let k = firstIdx - 1; k >= 0; k--) {
        if (entries[k].event.startsWith(BRANCH)) { branchIdx = k; break; }
      }
      const branch = branchIdx === -1
        ? 'unknown'
        : entries[branchIdx].event.slice(BRANCH.length).replace(/^:\s*/, '').trim();
      const reloads = entries
        .slice(branchIdx + 1, lastIdx + 1)
        .filter(e => isReload(e.event)).length;
      const steps = groupIdx.map(idx => entries[idx].event.slice(DEADLINE.length).trim()).join(' + ');
      incidents.push({
        at: new Date(last.ts).toISOString(),
        reason: `native cover deadline: ${steps} | branch=${branch} | reloads=${reloads}`.slice(0, 200),
        ts: last.ts,
      });
    }
    // Continue after the last deadline of this group; lines between it and j are not deadlines.
    i = lastIdx + 1;
  }
  return incidents;
}

export const COVER_REPORTED_KEY = 'forged:cover_deadline_reported_ts';
/** A 200-line log holds few episodes; this only bounds a pathological one. */
export const MAX_REPORTS_PER_BOOT = 5;

export interface CoverReportIo {
  readLog: () => Promise<string | null>;
  readMark: () => Promise<string | null>;
  writeMark: (ts: string) => Promise<void>;
  send: (inc: CoverDeadlineIncident) => Promise<boolean>;
}

/**
 * Send each unreported incident, oldest first, and advance the watermark past each one that was
 * ACCEPTED. A refused send stops the loop and leaves the watermark on the last success, so the
 * rest is retried next boot rather than lost. Never throws.
 */
export async function reportCoverDeadlines(io: CoverReportIo): Promise<{ sent: number; pending: number }> {
  try {
    const markRaw = await io.readMark();
    const mark = markRaw && /^\d+$/.test(markRaw) ? Number(markRaw) : 0;
    const incidents = findCoverDeadlineIncidents(await io.readLog(), mark).slice(-MAX_REPORTS_PER_BOOT);
    let sent = 0;
    for (const inc of incidents) {
      let ok: boolean;
      try { ok = await io.send(inc); } catch { ok = false; }
      if (!ok) break;
      await io.writeMark(String(inc.ts));
      sent++;
    }
    return { sent, pending: incidents.length - sent };
  } catch {
    return { sent: 0, pending: 0 };
  }
}
