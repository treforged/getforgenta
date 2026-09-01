// Pull the single `dump` column out of a persisted Supabase MCP result file.
// The MCP wrapper is: {"result":"<preamble>\n<untrusted-data-UUID>\n<json rows>\n</untrusted-data-UUID>\n<postamble>"}
import { readFileSync } from 'node:fs';
export function extractDump(path) {
  const outer = JSON.parse(readFileSync(path, 'utf8'));
  const text = outer.result;
  const m = text.match(/<untrusted-data-[0-9a-f-]+>\n([\s\S]*?)\n<\/untrusted-data-[0-9a-f-]+>/);
  if (!m) throw new Error('no untrusted-data block in ' + path);
  const rows = JSON.parse(m[1]);
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0].dump !== 'string') {
    throw new Error('expected exactly one row with a string `dump` column in ' + path);
  }
  return JSON.parse(rows[0].dump);
}
if (process.argv[2]) {
  const d = extractDump(process.argv[2]);
  for (const [k, v] of Object.entries(d)) console.log(k.padEnd(30), Array.isArray(v) ? v.length + ' rows' : (v ? 'object' : String(v)));
}
