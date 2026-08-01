#!/usr/bin/env node
// One-time backfill for issues that were already closed BEFORE the funnel-sync
// workflow existed. Scans closed issues via `gh` and flips each matching funnel
// leaf to [x], reusing mark-funnel-done.mjs so the matching stays identical.
//
//   node scripts/backfill-funnel.mjs                 # preview (dry run)
//   node scripts/backfill-funnel.mjs --yes           # write changes
//   node scripts/backfill-funnel.mjs --file feature-ideas --limit 500
//
// Requires an authenticated `gh` CLI pointed at this repo. Review the dry-run
// output, then re-run with --yes and commit the funnel change yourself.
import { execFileSync } from 'node:child_process';
import { deriveTask, markFunnelDone } from './mark-funnel-done.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const fileIdx = args.indexOf('--file');
const file = fileIdx !== -1 && args[fileIdx + 1] ? args[fileIdx + 1] : 'feature-ideas';
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 && args[limitIdx + 1] ? args[limitIdx + 1] : '500';

const raw = execFileSync(
  'gh',
  ['issue', 'list', '--state', 'closed', '--limit', limit, '--json', 'number,title,body,stateReason'],
  { encoding: 'utf8' },
);

// Skip issues closed as "not planned"; keep completed (and legacy issues whose
// stateReason predates the field). Preview lets you catch any wrong matches.
const issues = JSON.parse(raw).filter((i) => (i.stateReason || '').toUpperCase() !== 'NOT_PLANNED');

if (!issues.length) {
  console.log('No eligible closed issues found.');
  process.exit(0);
}

let marked = 0;
let skipped = 0;
for (const issue of issues) {
  const task = deriveTask({ body: issue.body || '', title: issue.title || '' });
  if (!task) {
    skipped += 1;
    continue;
  }
  const res = markFunnelDone({ file, task, apply });
  if (res.matched) {
    marked += 1;
    console.log(`${apply ? 'Marked' : 'Would mark'} done (#${issue.number}): ${res.line}`);
  } else {
    skipped += 1;
  }
}

console.log(`\n${apply ? 'Marked' : 'Would mark'} ${marked} task(s); ${skipped} issue(s) had no funnel match.`);
if (!apply) console.log('Dry run — re-run with --yes to write changes, then commit the funnel.');
