// Assembles src/lib/__tests__/fixtures/raw-rows.real.json from the persisted Supabase MCP result
// files produced by the two queries in docs/forecast-fixture-recapture.md.
//
// The rows never pass through an agent session's context: an oversized MCP result is spilled to a
// file and only the path comes back, and this script reads those files directly.
//
//   node scripts/fixture-recapture/assemble-raw.mjs <userId> <resultA.txt> <resultB.txt> <out.json>
import { writeFileSync } from 'node:fs';
import { extractDump } from './extract-mcp.mjs';

const [, , userId, ...rest] = process.argv;
const out = rest.pop();
if (!userId || rest.length === 0 || !out) {
  console.error('usage: assemble-raw.mjs <userId> <resultFile...> <out.json>');
  process.exit(1);
}

const tables = Object.assign({}, ...rest.map(extractDump));
const dump = { dumpedAt: new Date().toISOString(), userId, tables };
writeFileSync(out, JSON.stringify(dump));

for (const [k, v] of Object.entries(tables)) {
  console.log(k.padEnd(30), Array.isArray(v) ? v.length + ' rows' : (v ? 'object' : String(v)));
}
console.log('WROTE', out, JSON.stringify(dump).length, 'bytes at', dump.dumpedAt);
