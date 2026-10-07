import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PostgREST calls EVERY rpc with POST, reads included, so blocking by method alone starved pages of
 * data: the first guarded run enumerated 249 controls against 315 and pressed 75 against 147, and
 * still printed PASS. A function declared STABLE or IMMUTABLE cannot write, so those are let
 * through. The set is DERIVED from supabase/migrations (the last definition of a name wins), and
 * the volatility word is read only OUTSIDE the dollar-quoted body, so a comment cannot flip it.
 */
export function readOnlyRpcs() {
  const out = new Map();
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join('supabase/migrations', f), 'utf8');
    const head = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi;
    let h;
    while ((h = head.exec(sql)) !== null) {
      const open = /\$(\w*)\$/.exec(sql.slice(h.index));
      if (!open) continue;
      const bodyStart = h.index + open.index;
      const closeAt = sql.indexOf(open[0], bodyStart + open[0].length);
      if (closeAt < 0) continue;
      const tailEnd = sql.indexOf(';', closeAt);
      const outside = sql.slice(h.index, bodyStart) + sql.slice(closeAt + open[0].length, tailEnd < 0 ? undefined : tailEnd);
      out.set(h[1].toLowerCase(), /\b(stable|immutable)\b/i.test(outside));
    }
  }
  return new Set([...out].filter(([, ro]) => ro).map(([n]) => n));
}
