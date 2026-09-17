// Pull the single `dump` column out of a persisted Supabase MCP result file.
// The MCP wrapper is: {"result":"<preamble>\n<untrusted-data-UUID>\n<json rows>\n</untrusted-data-UUID>\n<postamble>"}
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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
// ⚠️ ENTRY-POINT GUARD, ADDED 2026-09-17 AFTER THIS BLOCK FIRED ON IMPORT.
// `assemble-raw.mjs` imports this module, so without the guard the CLI ran during that import
// and read assemble-raw's OWN argv[2] - the user id - as a file path, failing with
// "ENOENT: no such file or directory, open '<uuid>'". The documented recapture command in
// docs/forecast-fixture-recapture.md could therefore never have worked as written. The error
// names the uuid, so it reads like a bad argument rather than a module running code it should
// not, which is what makes this worth a comment instead of a silent one-line fix.
if (import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  const d = extractDump(process.argv[2]);
  for (const [k, v] of Object.entries(d)) console.log(k.padEnd(30), Array.isArray(v) ? v.length + ' rows' : (v ? 'object' : String(v)));
}
