#!/usr/bin/env node
/**
 * The weekly marketing report.
 *
 *   node marketing/scripts/marketing-report.mjs                 last completed week, printed
 *   node marketing/scripts/marketing-report.mjs --week 2026-08-10
 *   node marketing/scripts/marketing-report.mjs --this-week
 *   node marketing/scripts/marketing-report.mjs --post          also file it on the Conductor board
 *   node marketing/scripts/marketing-report.mjs --add "2026-08-14,pit-crew,replies_posted,9,reddit profile"
 *   node marketing/scripts/marketing-report.mjs --targets       what each number is and where to read it
 *
 * The counts file is `marketing/metrics/counts.csv` and it is **gitignored on
 * purpose**: this repository is public, and week-by-week signup and subscriber
 * numbers are Tre's business figures, not something to publish. The schema and
 * a worked example live in `counts.example.csv`, which IS committed, so a fresh
 * checkout can still run this.
 *
 * Every number in the report is one a human typed in after reading it off a
 * free dashboard. Nothing here scrapes an API, and nothing here estimates: a
 * metric with no row prints "no reading" rather than a zero.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  COUNTS_HEADER,
  TARGETS,
  CAMPAIGNS,
  mondayOf,
  addWeeks,
  parseCounts,
  summarize,
  renderReport,
  renderHeadline,
  buildCountsLine,
} from './lib/marketing-metrics.mjs';

// This file lives at marketing/scripts/, so the repo root is two levels up.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COUNTS = path.join(REPO, 'marketing', 'metrics', 'counts.csv');
const EXAMPLE = path.join(REPO, 'marketing', 'metrics', 'counts.example.csv');

/** Week 1 of the campaign. Everything "by week N" is counted from here. */
const LAUNCH_WEEK = '2026-08-10';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? '');
}
const has = (flag) => process.argv.includes(flag);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ensureCountsFile() {
  if (fs.existsSync(COUNTS)) return;
  fs.mkdirSync(path.dirname(COUNTS), { recursive: true });
  fs.writeFileSync(
    COUNTS,
    '# Forgenta marketing counts. One row per week, per campaign, per metric.\n' +
      '# Append only; a later row for the same key wins, so corrections just get added.\n' +
      `# Schema and a worked example: ${path.relative(REPO, EXAMPLE).replace(/\\/g, '/')}\n` +
      `${COUNTS_HEADER}\n`,
  );
  console.log(`created ${path.relative(REPO, COUNTS)}`);
}

function printTargets() {
  for (const c of CAMPAIGNS) {
    const mine = TARGETS.filter((t) => t.campaign === c.id);
    if (!mine.length) continue;
    console.log(`\n${c.name} — ${c.channel}`);
    for (const t of mine) {
      console.log(`  ${t.metric.padEnd(20)} target ${String(t.target).padStart(5)}${t.unit} by week ${t.dueWeek}`);
      console.log(`  ${''.padEnd(20)} read from: ${t.source}`);
    }
  }
  console.log('');
}

function main() {
  if (has('--targets')) return printTargets();

  ensureCountsFile();

  if (has('--add')) {
    const spec = arg('--add');
    const parts = String(spec).split(',');
    if (parts.length < 4) {
      console.error('usage: --add "week_start,campaign,metric,value,source"');
      process.exit(1);
    }
    const line = buildCountsLine({
      weekStart: parts[0].trim(),
      campaign: parts[1].trim(),
      metric: parts[2].trim(),
      value: parts[3].trim(),
      source: parts.slice(4).join(',').trim(),
    });
    fs.appendFileSync(COUNTS, `${line}\n`);
    console.log(`recorded: ${line}`);
    return;
  }

  const week = arg('--week')
    ? mondayOf(arg('--week'))
    : has('--this-week')
      ? mondayOf(todayISO())
      : addWeeks(mondayOf(todayISO()), -1);

  const rows = parseCounts(fs.readFileSync(COUNTS, 'utf8'));
  const entries = summarize(rows, week, { targets: TARGETS, launchWeek: LAUNCH_WEEK });
  const md = renderReport(entries, { weekStart: week, launchWeek: LAUNCH_WEEK });

  process.stdout.write(md);

  if (has('--post')) {
    const headline = renderHeadline(entries, week);
    const body = `${headline}\n\n${md}`;
    const res = spawnSync('conductor', ['note', body], { shell: true, encoding: 'utf8' });
    if (res.status === 0) {
      console.log('\nposted to the board.');
    } else {
      // Do not fail the run: the report is still on stdout and in the log. A
      // silent "posted" that did not post is the failure worth avoiding.
      console.error(`\ncould not post to the board (exit ${res.status}). ${(res.stderr || '').trim()}`);
      process.exitCode = 2;
    }
  }
}

main();
