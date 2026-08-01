#!/usr/bin/env node
// Seed GitHub issues from the feature funnel file. DRY RUN by default — it only
// prints what it would create. Pass --yes to actually create issues via `gh`.
//
//   node scripts/seed-issues-from-funnel.mjs                # preview
//   node scripts/seed-issues-from-funnel.mjs --yes          # create
//   node scripts/seed-issues-from-funnel.mjs --file path    # custom funnel file
//
// Every unchecked leaf task (`- [ ]`) becomes one `needs-triage` issue carrying
// its breadcrumb (parent headers) for context. Checked (`- [x]`) items are
// skipped. Groom priority + `ready`/`agent-ok` labels afterwards.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const fileIdx = args.indexOf('--file');
const file = fileIdx !== -1 && args[fileIdx + 1] ? args[fileIdx + 1] : 'feature-ideas';

const indentOf = (l) => l.match(/^\s*/)[0].length;
const lines = readFileSync(file, 'utf8').split('\n');

const tasks = [];
const stack = []; // breadcrumb of non-checkbox headers/bullets: { indent, text }
for (const raw of lines) {
  if (!raw.trim() || raw.trim().startsWith('#')) continue;
  const indent = indentOf(raw);
  const line = raw.trim();
  const checkbox = line.match(/^- \[( |x)\]\s+(.*)$/i);
  if (checkbox) {
    if (checkbox[1].toLowerCase() !== 'x') {
      const crumbs = stack.filter((s) => s.indent < indent).map((s) => s.text);
      tasks.push({ text: checkbox[2].trim(), crumbs });
    }
    continue;
  }
  const header = line.replace(/^-\s+/, '').replace(/:$/, '').trim();
  while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
  stack.push({ indent, text: header });
}

if (!tasks.length) {
  console.log(`No unchecked tasks found in ${file}.`);
  process.exit(0);
}

console.log(`Found ${tasks.length} unchecked task(s) in ${file}:\n`);
for (const t of tasks) {
  const title = t.text.length > 80 ? `${t.text.slice(0, 77)}...` : t.text;
  const context = t.crumbs.length ? `**Context:** ${t.crumbs.join(' › ')}\n\n` : '';
  const body =
    `${context}From the feature funnel (\`${file}\`).\n\n` +
    `${t.text}\n\n` +
    '### Acceptance criteria\n- [ ] TODO — fill in before adding `ready`/`agent-ok`\n- [ ] Lint, typecheck and tests pass\n\n' +
    '### Scope\nKeep small enough for one PR (agent session cap is 59 min).';

  if (!apply) {
    console.log(`• ${title}${t.crumbs.length ? `   (${t.crumbs.join(' › ')})` : ''}`);
    continue;
  }
  execFileSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', 'needs-triage'], {
    stdio: 'inherit',
  });
}

if (!apply) console.log('\nDry run — re-run with --yes to create these issues.');
