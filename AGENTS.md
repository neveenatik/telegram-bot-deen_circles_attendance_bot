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
