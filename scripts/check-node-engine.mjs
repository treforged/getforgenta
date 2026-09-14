/**
 * check-node-engine.mjs — say which engine a local green was run on.
 *
 * ⚠️ WHY THIS EXISTS. Every CI workflow in this repo pins `node-version: 22`.
 * This machine ran 24.14.0 with ICU 78.2 on 2026-09-13, and there was no
 * `engines` field and nothing that said so out loud — which means NO local gate
 * had ever run on the engine CI uses, and every local green was weaker than it
 * looked without anyone being told.
 *
 * The worked example, because it cost a red main: `formatYAxisTick` used
 * `Intl.NumberFormat` with `notation: 'compact'` and only a MAXIMUM fraction
 * digit. ECMA-402 leaves rounding on the compact default there and ICU builds
 * disagree — Node 24 / ICU 78.2 printed `$3k`, CI's Node 22 printed `$3.0k`.
 * Four tests passed here and failed there.
 *
 * ⚠️ THIS IS A WARNING, NOT A GATE, AND THE DISTINCTION IS DELIBERATE. On a
 * mismatch it prints loudly and still exits 0. A check that refused to run the
 * suite on the wrong major would be red on every ordinary command on this
 * machine, and a gate that is always red is a gate people stop reading. CI
 * remains the binding check.
 *
 * WHAT IT DOES NOT CATCH, stated so nobody trusts it past its reach: a matching
 * node MAJOR can still carry a different ICU build, and that is the variable
 * that actually moved above. It reports the ICU version for exactly that reason
 * — read it, do not assume a matching major means a matching format.
 *
 * `npm run test:tz` does NOT vary ICU; it varies the time zone three ways. So
 * anything locale- or currency-formatted is unguarded locally either way.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const nvmrcPath = join(process.cwd(), '.nvmrc');

const localVersion = process.versions.node;
const localMajor = Number.parseInt(localVersion.split('.')[0], 10);
const icu = process.versions.icu ?? 'none';

console.log(`[node-engine] running node v${localVersion} (ICU ${icu})`);

// ⚠️ READ THE PIN BEFORE ANYTHING ELSE CAN OVERWRITE THE VERDICT. The first
// draft of this file set exitCode = 2 in the catch and then FELL THROUGH into
// the comparison, which printed "CI pins node undefined" and set the code back
// to 0 — the could-not-look branch destroyed by the code after it. Returning
// here is what keeps the refusal a refusal.
let pinned;
try {
  const raw = readFileSync(nvmrcPath, 'utf8').trim();
  pinned = Number.parseInt(raw, 10);
  if (!Number.isInteger(pinned)) throw new Error(`not an integer major: ${JSON.stringify(raw)}`);
} catch (e) {
  console.error(`[node-engine] COULD NOT LOOK - .nvmrc missing or unparseable at ${nvmrcPath} (${e.message})`);
  console.error('[node-engine] This is NOT a match and NOT a pass. Nothing was compared.');
  process.exitCode = 2;
}

if (process.exitCode !== 2) {
  console.log(`[node-engine] CI pins node ${pinned} via .nvmrc`);

  if (localMajor === pinned) {
    console.log('[node-engine] engine matches CI.');
  } else {
    console.error('[node-engine] WARNING - this is a LOCAL-ONLY warning, not a gate. It exits 0 on purpose.');
    console.error(`[node-engine] Local node major ${localMajor} != CI pin ${pinned}. Intl/ICU output can differ between ICU builds, so a green run here is NOT evidence CI will be green.`);
    console.error(`[node-engine] Run: nvm use ${pinned}`);
  }
}
