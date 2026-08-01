# AGENTS.md

This repository is a **monorepo** with two independent sub-projects. Read the
`AGENTS.md` inside the folder you're working in — that's where the real
conventions live.

| Folder | Project | Agent guide |
|--------|---------|-------------|
| [`bot/`](bot/) | Telegram attendance bot (Node, Telegraf, Supabase, Vercel webhook) | [bot/AGENTS.md](bot/AGENTS.md) |
| [`web/`](web/) | Next.js marketing/documentation site | [web/AGENTS.md](web/AGENTS.md) |

## Ground rules

- Each sub-project has its own `package.json`, lockfile and lint config. **`cd`
  into the folder first**, then run its commands.
- Bot: `cd bot && source ~/.nvm/nvm.sh && nvm use && npm run lint && npm test`
  (add `npm run typecheck` when you touch a `.ts` file). Node **22** is pinned
  by the repo-root `.nvmrc`.
- Web: `cd web && npm install && npm run lint && npm run build`.
- `feature-ideas` (repo root) is the planning funnel used by the
  `agent-dispatch` workflow — keep it at the root.
- Definition of done: the touched sub-project is lint-, typecheck- and
  test-clean.

## Feature funnel round-trip

The `feature-ideas` file is the single source of truth for planned work, wired
into GitHub Actions in both directions:

1. **Seed (funnel → issues):** [bot/scripts/seed-issues-from-funnel.mjs](bot/scripts/seed-issues-from-funnel.mjs)
   turns every unchecked leaf (`- [ ]`) into a `needs-triage` issue. Each issue
   body carries a `<!-- funnel-task: … -->` marker with the exact leaf text so it
   can be matched back later. Dry-run by default; `--yes` creates issues.
2. **Dispatch:** [.github/workflows/agent-dispatch.yml](.github/workflows/agent-dispatch.yml)
   picks the next issue (planner lane for `needs-breakdown`, else builder lane
   for `ready` + `agent-ok`) and assigns the coding agent.
3. **Sync back (issue done → funnel):** [.github/workflows/funnel-sync.yml](.github/workflows/funnel-sync.yml)
   runs on a **merged PR** (reading the issue it `Closes #N`) and on an **issue
   closed as completed** (manual/planner closes), then calls
   [bot/scripts/mark-funnel-done.mjs](bot/scripts/mark-funnel-done.mjs) to flip the
   matching `- [ ]` to `- [x]` and commit. Matching uses the `funnel-task` marker,
   falling back to the issue body/title. Both triggers share one idempotent
   script, so overlap is harmless.

For issues closed *before* this workflow existed, run the one-time backfill
locally (needs an authenticated `gh`): `node bot/scripts/backfill-funnel.mjs`
previews matches, `--yes` writes them. Commit the funnel change yourself.

So: closing an issue as **completed** checks its funnel item automatically.
Closing as **not planned** leaves the funnel untouched.
