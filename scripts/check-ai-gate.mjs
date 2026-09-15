/**
 * check:ai-gate - prove AI_ADVISOR_ENABLED is FALSE in a real production build.
 *
 * WHY A BUILD AND NOT A UNIT TEST. `AI_ADVISOR_ENABLED` is `import.meta.env.DEV`, and mounting
 * `AiAdvisor` reads the user's transactions, debts, goals, accounts and car funds and forwards
 * them to the `ai-advisor` edge function. The flag is what keeps that data flow behind the policy
 * that is supposed to govern it. A vitest can stub `import.meta.env` and prove nothing about what
 * SHIPS; only the bundle vite actually emits can answer that.
 *
 * WHAT IT ASSERTS: the shipped `SECTION_AVAILABLE` literal in `src/pages/Account.tsx` reads
 * `ai:!1`. Measured 2026-09-15: the minifier does NOT fold `SECTION_AVAILABLE.ai` away, so the
 * dead segment and the lazy `AiAdvisor` chunk are still EMITTED - the branch just never runs.
 * That residue is bundle weight, not a data flow, and it is stated rather than implied.
 *
 * WHAT IT DOES NOT CATCH: any other route to the advisor, the `/ai` route's own folding, the edge
 * function's own auth, and anything that turns the flag on at runtime rather than at build time.
 *
 * ⚠️ PROVEN RED BY MUTATION, NOT BY A MODE FLAG. `vite build --mode development` does NOT flip
 * `import.meta.env.DEV` - vite build forces NODE_ENV=production, so that run came back GREEN and
 * discriminated nothing. A non-discriminating red looks exactly like a broken gate, so the real red
 * is `ai: true` in Account.tsx, which produces `ai:!0` and exit 1; source restored byte-exact by
 * sha256 (377d1583...). The CONTROL was proven separately by breaking the matcher: exit 2.
 *
 * Exit codes: 0 pass · 1 the flag ships TRUE (a real finding) · 2 the instrument is broken.
 * Those are kept apart on purpose - an exit-1 defect gets fixed, an exit-2 tooling fault gets
 * re-run and then ignored, so a broken matcher must never wear the defect's exit code.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD = process.env.CHECK_AI_GATE_BUILD_CMD || 'npm run build';

try {
  execSync(BUILD, { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  console.error(`CONTROL FAILED: \`${BUILD}\` did not succeed, so there is no bundle to judge.`);
  console.error(String(e.stdout || '') + String(e.stderr || ''));
  process.exit(2);
}

const assetsDir = join('dist', 'assets');
const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js')).map((f) => join(assetsDir, f));

// The literal is matched by SHAPE, never by a variable name - the minifier renames it every build.
const pattern = /[A-Za-z$_]+=\{profile:(![01]),leaderboard:(![01]),ai:(![01])\}/g;

// Every file is read. Stopping at the first hit would be an inventory by first match, and a second
// chunk carrying a DIFFERENT value is exactly the case worth catching.
const hits = [];
for (const file of jsFiles) {
  const content = readFileSync(file, 'utf8');
  for (const m of content.matchAll(pattern)) {
    hits.push({ file, profile: m[1], leaderboard: m[2], ai: m[3], literal: m[0] });
  }
}

console.log(`examined ${jsFiles.length} shipped js assets in ${assetsDir}; availability literals found: ${hits.length}`);

if (hits.length === 0) {
  console.error(
    'CONTROL FAILED: the SECTION_AVAILABLE literal was found in NO shipped chunk. A zero here is a ' +
    'fact about the MATCHER, not about the bundle - the minifier may have changed shape. Fix the ' +
    'pattern; do not read this as a clean build.',
  );
  process.exit(2);
}

// POSITIVE CONTROL: the two sections that are unconditionally available must read true in the same
// literal. If they do not, the pattern is matching something that is not this object.
const badControl = hits.find((h) => h.profile !== '!0' || h.leaderboard !== '!0');
if (badControl) {
  console.error(
    `CONTROL FAILED: matched \`${badControl.literal}\` in ${badControl.file}, but \`profile\` and ` +
    '`leaderboard` are unconditionally true in the source. The pattern is matching the wrong object.',
  );
  process.exit(2);
}

const shipped = hits.filter((h) => h.ai === '!0');
if (shipped.length > 0) {
  for (const h of shipped) {
    console.error(`FAIL: ${h.file} ships \`${h.literal}\` - the AI section is AVAILABLE in a production build.`);
  }
  console.error(
    'AI_ADVISOR_ENABLED gates a data flow: mounting AiAdvisor forwards transactions, debts, goals, ' +
    'accounts and car funds to the ai-advisor edge function. Do not ship this until the data-sharing ' +
    'policy and the account-level controls exist.',
  );
  process.exit(1);
}

console.log(`PASS: ${hits.length}/${hits.length} availability literal(s) read ai:!1`);
for (const h of hits) console.log(`  ${h.file}  ${h.literal}`);
