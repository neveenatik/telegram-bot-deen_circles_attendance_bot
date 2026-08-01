# Deen Circles — Attendance Bot

A production Telegram bot that manages attendance for a women's Qur'an study
circle, supporting both **live group sessions** and **offline DM-managed
classes**, with a fully **Arabic (RTL)** interface. It runs as a serverless
webhook backed by managed Postgres, renders attendance summaries as images, and
ships with a companion multilingual marketing site. The entire project was built
through **AI-assisted development**, with me directing architecture, reviewing
every change, and enforcing quality gates.

🌐 **Live site:** [deen-circles-web.vercel.app](https://deen-circles-web.vercel.app)

## Monorepo layout

Two self-contained sub-projects, each deployed as its own **Vercel project**:

| Folder | What it is | Stack | Docs |
|--------|------------|-------|------|
| [`bot/`](bot/) | Telegram attendance bot (serverless webhook) | Node 22, Telegraf, Supabase | [bot/README.md](bot/README.md) (بالعربية) |
| [`web/`](web/) | Marketing / documentation site | Next.js (App Router), next-intl, Tailwind v4 | [web/README.md](web/README.md) |

```
.
├── bot/            # Telegram bot: index.js, api/, lib/, scripts/, test/, assets/, docs/
├── web/            # Next.js marketing site
├── feature-ideas   # planning funnel (used by the agent-dispatch workflow)
├── .nvmrc          # repo-wide Node version (22)
└── .github/        # CI: builds/tests the bot, applies migrations, deploys
```

## Quick start

```bash
# Bot
cd bot && nvm use && npm install && cp .env.example .env && npm start

# Web
cd web && npm install && npm run dev   # http://localhost:3000 → /ar
```

Each sub-project owns its `package.json`, lockfile and lint config. Run bot
commands (`npm run lint`, `npm run typecheck`, `npm test`) from inside `bot/`,
and web commands from inside `web/`. See each sub-project's README and
`AGENTS.md` for details.

## What I built (cross-stack)

- **Backend / bot:** Event-driven **Telegraf** bot on **Node.js 22 (ESM)** with
  a clean, dependency-injected handler architecture (commands and callback
  actions split per surface). Modeled the domain around a single source-of-truth
  session-type system and worked within Telegram's real constraints — ≤64-byte
  callback payloads and collision-safe anchored-regex routing.
- **Data:** **Supabase / Postgres** behind a single storage layer, with a
  **replay-safe migration system** (idempotent DDL tracked in a
  `schema_migrations` ledger, plus a synced fresh-install schema).
- **Image rendering:** Server-side attendance images via **Puppeteer-core +
  @sparticuz/chromium** (headless Chrome sized for serverless), using HTML/CSS
  templating for pixel-accurate Arabic output.
- **Frontend:** A separate **Next.js (App Router)** site with **next-intl**
  (Arabic default/RTL + English) and **Tailwind CSS v4**, deployed independently
  so it never touches the bot webhook.
- **Platform / DevOps:** **Vercel** serverless deployment and a **GitHub
  Actions** pipeline gating lint → typecheck → test → **migrate → deploy**, so
  schema changes always land before code goes live.
- **Quality:** Incremental **JavaScript → TypeScript** migration (`tsc
  --noEmit` kept green), a **custom ESLint rule** enforcing Telegraf middleware
  correctness, and a fast, DB-free **`node:test`** suite using shared mocks.

## Stack decisions & rationale

- **Managed Postgres over NoSQL** — attendance is inherently relational; I
  wanted real SQL, integrity, and migrations.
- **Serverless webhook over an always-on VM** — traffic is bursty and
  low-volume, so near-zero idle cost and no server to maintain.
- **Chromium-in-serverless over canvas** — HTML/CSS templating handles complex
  RTL layout far more maintainably than manual drawing, chosen specifically to
  fit Vercel's size limits.
- **JS first, TypeScript incrementally** — shipped quickly, then added type
  safety only where it paid off, avoiding a big-bang rewrite.
- **Separate Vercel project for the site** — isolates the marketing frontend
  from the bot's serverless function.

**Stack:** Node.js 22 · Telegraf · Supabase/Postgres · TypeScript ·
Puppeteer/Chromium · Next.js · next-intl · Tailwind CSS v4 · ESLint · GitHub
Actions · Vercel.

## Working with an AI assistant

- Drove the build via **prompt-driven pair-programming**, owning architecture,
  code review, and validation while the AI generated implementation.
- Created durable **agent-guidance infrastructure** — an `AGENTS.md` playbook
  codifying conventions (callback limits, migration replay-safety, single
  source-of-truth patterns, definition-of-done) plus a **custom lint rule** and
  CI gates that *mechanically* enforce those standards on every AI-generated
  change.
- Held a strict **implement → validate** loop: no change merged unless lint,
  typecheck, and all tests passed, kept in small Conventional-Commit history —
  pairing AI velocity with engineering discipline.

## Deployment (Vercel)

Two separate Vercel projects, both pointing at this repo:

- **Bot** — set the project's **Root Directory** to `bot`.
- **Web** — set the project's **Root Directory** to `web`.
