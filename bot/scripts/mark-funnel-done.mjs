#!/usr/bin/env node
// Flip a funnel leaf task to done ([x]) when its GitHub issue is closed as
// completed. The inverse of seed-issues-from-funnel.mjs. Idempotent: a no-op if
// the task is already checked or no match is found.
//
//   ISSUE_BODY="..." ISSUE_TITLE="..." node scripts/mark-funnel-done.mjs
//   node scripts/mark-funnel-done.mjs --file feature-ideas
//
// Also exports deriveTask + markFunnelDone so backfill-funnel.mjs can reuse the
// exact same matching logic.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Derive the funnel task text an issue was seeded from (most reliable first):
//   1. the `<!-- funnel-task: … -->` marker the seeder embeds in the body,
//   2. the paragraph between the funnel note and the acceptance criteria,
//   3. the issue title (may be truncated by the seeder).
export function deriveTask({ body = '', title = '' }) {
  let task = '';
  const marker = body.match(/<!--\s*funnel-task:\s*([\s\S]*?)\s*-->/);
  if (marker) {
    task = marker[1];
  } else {
    const paragraph = body.match(/From the feature funnel \([^)]*\)\.\s*\n+([\s\S]*?)\n+### /);
    if (paragraph) task = paragraph[1];
  }
  if (!task.trim()) task = title.replace(/\.\.\.$/, '');
  return task.trim();
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const leafRe = /^(\s*)- \[( |x)\]\s+(.*)$/i;

// Flip the first unchecked leaf matching `task` to [x]. Exact match first, then
// prefix match to tolerate the seeder's truncated titles. Writes when apply.
export function markFunnelDone({ file, task, apply = true }) {
  const want = norm(task);
  const lines = readFileSync(file, 'utf8').split('\n');

  const findLeaf = (predicate) => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(leafRe);
      if (!m || m[2].toLowerCase() === 'x') continue;
      if (predicate(norm(m[3]))) return i;
    }
    return -1;
  };

  let idx = findLeaf((text) => text === want);
  if (idx === -1) idx = findLeaf((text) => text.startsWith(want) || want.startsWith(text));
  if (idx === -1) return { matched: false };

  const updated = lines[idx].replace(/- \[ \]/i, '- [x]');
  lines[idx] = updated;
  if (apply) writeFileSync(file, lines.join('\n'));
  return { matched: true, line: updated.trim() };
}

function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const file = fileIdx !== -1 && args[fileIdx + 1] ? args[fileIdx + 1] : 'feature-ideas';

  const task = deriveTask({ body: process.env.ISSUE_BODY || '', title: process.env.ISSUE_TITLE || '' });
  if (!task) {
    console.log('No task text could be derived from the issue; nothing to mark.');
    return;
  }

  const res = markFunnelDone({ file, task });
  if (!res.matched) {
    console.log(`No matching unchecked funnel task for: "${task}"`);
    return;
  }
  console.log(`Marked done in ${file}: ${res.line}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

