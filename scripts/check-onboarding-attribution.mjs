/*
 * check:onboarding-attribution
 *
 * WHY THIS EXISTS. `onboarding_completed` is written by four call sites that mean four
 * different things: finishing the wizard, a legacy display_name bounce, the dashboard
 * checklist auto-completing from real data, and a cache restore. A bare boolean cannot
 * tell them apart, so every metric built on it measured "any of the four" - in practice,
 * HAVING A NAME. `onboarding_completed_via` records which path fired; this gate proves no
 * call site can rejoin the unattributed population.
 *
 * WHAT IT ASSERTS
 *   A. the union parser found the declared vocabulary        (control, exit 2 if not)
 *   B. the call-site matcher found call sites                (control, exit 2 if not)
 *   C. every call site passes a literal member of that union (defect, exit 1)
 *   D. every declared member is used by some call site       (defect, exit 1)
 *
 * A and B are CONTROLS, and they are the point: a zero from a broken matcher and a zero
 * from a clean repo are the same zero. Exit 2 says "the instrument is broken", exit 1 says
 * "the code is wrong", and those must never be confused with each other.
 *
 * TWO WRITER SHAPES, AND THE SECOND IS THE ONE THAT MATTERS. Most paths call
 * markOnboardingComplete(userId, via). The real finish path instead sets
 * `onboarding_completed: true` DIRECTLY in a wider profile update, so completion cannot
 * disagree with the rest of that write. A gate that knew only the function call was blind
 * to exactly the path that means a person walked the wizard - it discovered candidates by a
 * marker only the compliant carry. So direct writes of the flag are matched too, and each
 * must sit beside an `onboarding_completed_via` literal.
 *
 * WHAT IT DOES NOT CATCH. It is line-based, not a TypeScript parser: a call split across
 * lines, or one whose `via` is a variable resolved elsewhere, is invisible to it. It cannot
 * check that a value is the RIGHT one for its call site - only that one was passed. It says
 * nothing about rows already in the database, which carry NULL by design.
 */

import { promises as fs } from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve('src');
const DECLARATION_FILE = path.join(SRC_ROOT, 'lib', 'onboarding-state.ts');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath.includes('node_modules') || fullPath.includes('__tests__')) continue;
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      if (fullPath.includes('node_modules') || fullPath.includes('__tests__')) continue;
      if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function parseDeclaredUnion(content) {
  const declared = new Set();
  const lines = content.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    // Anchored on the whole declaration, not a prefix: `startsWith` also matched
    // `OnboardingCompletionPathX`, so a renamed union kept parsing and the control
    // that should have caught a broken instrument reported PASS.
    if (/^export type OnboardingCompletionPath\s*=/.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return declared;
  // Skip doc comments and blank lines between members rather than stopping at the first
  // non-member line: the union is documented per-member, so a `break` here would have
  // parsed exactly one value and reported a broken instrument on correct source.
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const m = /^\s*\|\s*'([^']*)'/.exec(raw);
    if (m) {
      declared.add(m[1]);
      if (t.endsWith(';')) break;
      continue;
    }
    if (t === '' || t.startsWith('/**') || t.startsWith('*') || t.startsWith('//')) continue;
    break;
  }
  return declared;
}

function extractCallSites(filePath, content) {
  const sites = [];
  const lines = content.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Handle block comment state
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
        line = line.substring(line.indexOf('*/') + 2);
      } else {
        continue;
      }
    }
    if (!inBlockComment && line.includes('/*')) {
      const endIdx = line.indexOf('*/');
      if (endIdx !== -1) {
        // comment starts and ends on same line
        line = line.slice(0, line.indexOf('/*')) + line.slice(endIdx + 2);
      } else {
        inBlockComment = true;
        line = line.slice(0, line.indexOf('/*'));
      }
    }

    if (trimmed.startsWith('import')) continue;
    if (filePath.endsWith('onboarding-state.ts') && trimmed.startsWith('export async function') && trimmed.includes('markOnboardingComplete')) {
      continue;
    }

    // SHAPE 2: a direct write of the flag. Its `via` is on a NEARBY line inside the same
    // object literal, not in an argument list, so it is matched over a small window rather
    // than on one line.
    if (/\bonboarding_completed\s*:\s*true\b/.test(line)) {
      const near = lines.slice(i, i + 12).join(String.fromCharCode(10));
      const viaMatch = /\bonboarding_completed_via\s*:\s*'([^']*)'/.exec(near);
      // THE CANONICAL SINK. markOnboardingComplete writes the CALLER'S `via` through, so its
      // own line carries an identifier rather than a literal. That is legitimate exactly once.
      // Asserting 'exactly one, and here is which' beats forbidding it: a blanket ban would be
      // worked around, and excluding the file BY NAME would be blind to a second sink added
      // anywhere else.
      const sinkMatch = /\bonboarding_completed_via\s*:\s*([A-Za-z_$][\w$]*)/.exec(near);
      if (!viaMatch && sinkMatch) {
        sites.push({ file: filePath, line: i + 1, value: null, error: null, sink: sinkMatch[1] });
        continue;
      }
      if (!viaMatch) {
        sites.push({ file: filePath, line: i + 1, value: null,
          error: 'sets onboarding_completed directly with no onboarding_completed_via beside it' });
      } else {
        sites.push({ file: filePath, line: i + 1, value: `'${viaMatch[1]}'`, error: null });
      }
      continue;
    }

    const regex = /markOnboardingComplete\s*\(([^)]*)\)/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const args = match[1].split(',').map(a => a.trim());
      if (args.length < 2) {
        sites.push({ file: filePath, line: i + 1, value: null, error: 'missing second argument' });
        continue;
      }
      const second = args[1];
      const literalMatch = /^'([^']*)'$/.exec(second);
      if (!literalMatch) {
        sites.push({ file: filePath, line: i + 1, value: second, error: 'second argument not a single-quoted literal' });
        continue;
      }
      sites.push({ file: filePath, line: i + 1, value: `'${literalMatch[1]}'`, error: null });
    }
  }
  return sites;
}

async function main() {
  const allFiles = await walk(SRC_ROOT);
  const filesExamined = allFiles.length;

  // Parse declared paths
  let declaredContent;
  try {
    declaredContent = await fs.readFile(DECLARATION_FILE, 'utf8');
  } catch (e) {
    console.error('Failed to read declaration file');
    process.exitCode = 2;
    process.exit(2);
  }
  const declared = parseDeclaredUnion(declaredContent);

  // Assertion A
  if (declared.size < 2) {
    console.error(`CONTROL FAILED: the union parser found ${declared.size} member(s) in ${DECLARATION_FILE}. The instrument is broken, not the code.`);
    process.exitCode = 2;
    process.exit(2);
  }

  // Find call sites
  const allSites = [];
  for (const file of allFiles) {
    const content = await fs.readFile(file, 'utf8');
    const sites = extractCallSites(file, content);
    allSites.push(...sites);
  }

  // Assertion B
  if (allSites.length < 2) {
    console.error(`CONTROL FAILED: the matcher found ${allSites.length} call site(s) across ${filesExamined} files. A zero here is a broken matcher, not a clean repo.`);
    process.exitCode = 2;
    process.exit(2);
  }

  // Output summary
  console.log(`files examined: ${filesExamined}`);
  console.log(`declared paths: ${declared.size}`);
  console.log(`call sites: ${allSites.length}`);

  // Print each call site
  for (const site of allSites) {
    const val = site.sink ? `(canonical sink, writes '${site.sink}')` : (site.value ?? 'MISSING');
    console.log(`${site.file}:${site.line} -> ${val}`);
  }

  // Assertions C and D. Every failure is collected and named: a gate that stops at the
  // first one costs a run per defect, and "FAIL" with no subject is a wall rather than a
  // decision.
  const failures = [];
  const sinks = allSites.filter(s => s.sink);
  if (sinks.length !== 1) {
    failures.push(`expected exactly 1 canonical sink (a via written from a variable), found ${sinks.length}`);
  }
  for (const site of allSites.filter(s => !s.sink)) {
    if (site.error) {
      failures.push(`${site.file}:${site.line} ${site.error}`);
      continue;
    }
    const inner = site.value.slice(1, -1);
    if (!declared.has(inner)) {
      failures.push(`${site.file}:${site.line} passes '${inner}', which is not a declared OnboardingCompletionPath`);
    }
  }
  const used = new Set(allSites.filter(s => !s.error && !s.sink).map(s => s.value.slice(1, -1)));
  for (const d of declared) {
    if (!used.has(d)) {
      failures.push(`declared path '${d}' is used by no call site (removed, or never wired)`);
    }
  }
  if (failures.length > 0) {
    for (const f of failures) console.log(`FAIL ${f}`);
    console.log(`FAIL ${failures.length} problem(s)`);
    process.exit(1);
  }

  console.log('PASS');
  process.exitCode = 0;
  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exitCode = 2;
  process.exit(2);
});
