# AGENTS.md

Guidance for AI agents working in this repository. Read this first, then the
relevant `docs/` file for deeper context.

## What this is

A Telegram attendance bot (Telegraf) for a women's Qur'an study circle. The UI
is **Arabic**. It tracks attendance for both **live** group sessions (bot is in
a Telegram group) and **offline** classes (DM-only; the teacher manages a class
privately and students never touch the bot). State lives in **Supabase
(Postgres)**. It deploys as a **Vercel serverless webhook** (`api/telegram.js`).

## Commands

Node **22** is required (`.nvmrc`). Always load nvm first in a fresh shell.

```bash
# Validate every change (lint + tests):
source ~/.nvm/nvm.sh && nvm use >/dev/null && npm run lint && npm test

# When you touch a .ts file, also run:
npm run typecheck        # tsc --noEmit

# Other:
npm start                # node --import tsx index.js (local polling)
npm run set-webhook -- <url|delete>
```

Tests run under `tsx` (`node --import tsx --test "test/**/*.test.{js,ts}"`), so
`.ts` sources are resolved at runtime — import them with a `.js` specifier
(e.g. `import { createHandlers } from '../lib/handlers/actions/timetable.js'`).

**Definition of done for any change: lint clean, `typecheck` clean (if TS
touched), and all tests pass.** Run them before proposing or making a commit.

## Layout

```
index.js                     # bot bootstrap + handler registration
api/telegram.js              # Vercel webhook entrypoint
lib/
  sessionTypes.js            # SESSION_TYPES + type predicates (single source of truth)
  storage.js                 # ALL Supabase access (the only DB layer)
  text.js                    # ALL user-facing Arabic strings (TEXT.*)
  widgets.js                 # live session message rendering + keyboards
  helpers.js                 # escapeTelegramMarkdown, replyEphemeral, beginForceReplyAwaiting, ...
  sessionParticipants.js     # participant read/write choke point (name-keyed)
  guards.js / confirmations.js / historyUtils.js / sessionSync.js
  handlers/
    commands/                # /start, /stop, /history, ...
    actions/                 # callback-query handlers, one file per surface
      hub.js                 # online admin /manage hub
      offline.js             # offline (DM) class management
      timetable.ts           # weekly roster / schedule
      history.js             # shared session editor (live + offline)
      members.js manage.js attendance.js materials.ts homework.ts ...
scripts/
  supabase_v2.sql            # full fresh-install schema
  migrations/                # incremental migrations (see below)
docs/                        # architecture + migration plans
eslint-rules/                # custom lint rules
test/                        # node:test suites + test/mocks.js
```

## Conventions that matter

### Telegraf callback actions
- Callback data must stay **≤64 bytes**. Tokens are colon-delimited and use
  compact numeric ids (e.g. the offline `groups.id` "gref", not the full key).
- Register actions with **anchored regex** (`^...$`) so prefixes never collide
  (e.g. `o:tg:` vs `o:tgs:` vs `o:tgstu:`).
- Middleware must call `next()` — enforced by the custom ESLint rule
  `eslint-rules/require-next-in-telegraf-middleware.js`.

### Session types
- `lib/sessionTypes.js` exports **`SESSION_TYPES`** (the canonical list) plus
  `requiresRegistrationApproval`, `usesCallStatus`, `isActiveSessionType`,
  `getActiveSessionType`. Derive from `SESSION_TYPES` rather than hardcoding
  type lists, so new types propagate automatically (offline creation, the
  weekly roster, history browsing all do this).

### Text / rendering
- Never hardcode user-facing strings in handlers — add them to `lib/text.js`
  (`TEXT`, with sub-objects like `TEXT.manageHub`, `TEXT.offline`,
  `TEXT.timetable`). Strings are Arabic; keep buttons short (they get clamped).
- When rendering a member/student **name inside a Markdown body**, wrap it in
  `escapeTelegramMarkdown` (from `lib/helpers.js`).

### Storage & migrations
- `lib/storage.js` is the **only** place that talks to Supabase. Handlers get
  storage functions injected via `createHandlers({ storage, telegram })`.
- Schema changes: add an idempotent migration under `scripts/migrations/` named
  `YYYYMMDD_NNN_short_description.sql`, guarded by a `schema_migrations` version
  row and `... if not exists`. Also update `scripts/supabase_v2.sql` (the fresh
  install schema) to match. Migrations are applied **manually** (no migrate npm
  script) and must run **before/with** the code deploy. Prefer additive,
  backward-compatible changes (nullable columns) for zero-downtime.

### TypeScript migration (in progress)
- New handler files may be `.ts`; existing `.js` stays until migrated (see
  `docs/typescript-migration-plan.md`). Keep `npm run typecheck` green.

### Tests
- `node:test` + `node:assert`. `test/mocks.js` provides `makeCtx`,
  `makeStorage`, `makeTelegram`. Tests use these mocks — they do **not** hit the
  DB. Add a default to `makeStorage` when you add a widely-used storage fn.
- Prefer one behavior per test; assert on emitted `callback_data` / message
  text rather than internals.

## Working style (how the maintainer likes to collaborate)

- **Implement, then validate.** Make the change and run lint/typecheck/tests
  before reporting. Report the pass count.
- **Small, logical commits** with Conventional-Commit messages
  (`feat(offline): ...`, `feat(timetable): ...`). Split by concern when the
  changes are cleanly separable; use one commit when they are genuinely
  entangled — explain briefly which you chose.
- **Only stage what you changed.** Leave unrelated modified/untracked files
  alone (e.g. in-progress `docs/*` plans). Show `git status -sb` after
  committing. **Do not `git push`** unless explicitly asked.
- Keep responses concise. Don't create docs/markdown to describe changes unless
  requested.

## Deploy checklist

1. Lint + typecheck + tests green.
2. Apply any new `scripts/migrations/*.sql` to production Supabase **first**
   (additive migrations are safe to run ahead of the deploy).
3. `git push` → Vercel auto-deploys `api/telegram.js`.
4. Re-run `set-webhook` only if the deployment URL changed.
5. Smoke-test the affected flow in Telegram.
