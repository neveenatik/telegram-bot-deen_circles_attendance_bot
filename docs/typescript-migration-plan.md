# TypeScript Migration Plan

Incremental, low-risk migration of the remaining JavaScript to TypeScript. The
directive (already in effect since 2026-07-14) is: **every new feature is TS;
migrate legacy `.js` opportunistically.** This plan turns "opportunistically"
into an ordered, mechanical sequence so the codebase can reach 100% TypeScript
without a big-bang rewrite or a runtime regression.

## Why this is low-risk here

- **No build/emit step.** `tsx` transpiles at runtime (`node --import tsx`) and
  Vercel's `@vercel/node` compiles `/api` entries + their import graph using
  `tsconfig` semantics. `tsc` is used **only** for type-checking (`noEmit`).
  Renaming a file changes nothing at runtime — only what the type-checker sees.
- **`.js` and `.ts` already coexist** (`allowJs: true`, `checkJs: false`). Four
  action modules are already TS (`materials`, `homework`, `studentHomework`,
  `timetable`).
- **Import specifiers already use `.js`** everywhere (NodeNext). They stay `.js`
  even when the target becomes `.ts` — no import churn on rename.

## The one gotcha: strictness flips on at rename

Legacy `.js` is **not** type-checked (`checkJs: false`). The moment a file is
renamed to `.ts` it becomes **fully strict** (`strict`, `noImplicitOverride`,
`noUncheckedIndexedAccess`). So each rename surfaces real type errors that must
be fixed in that same change. Keep each file's migration as its own commit so a
regression is easy to bisect.

## Phase 0 — Foundation: a shared types module (do first)

Today each `.ts` module re-declares a **local subset** of the `Storage`
interface and its own `Ctx`/domain shapes. That duplication will explode as more
files convert. Create a single source of truth:

- `lib/types.ts` exporting:
  - `Ctx` — alias for Telegraf `Context` (plus any custom `ctx.state` fields).
  - `Storage` — the **full** storage contract (every method used across the app,
    derived from `lib/storage.js` + the subsets already in the `.ts` files).
  - Domain records: `Session`, `Participant`, `Member`, `Material`,
    `MaterialFile`, `Homework`, `Group`/`ManageableClass`, `Surface`, etc.
  - Shared callback/handler types: `Handler`, `BotLike`.
- As each module migrates, delete its local duplicate and import from
  `lib/types.ts`. Retro-fit the four existing `.ts` files to use it too.

This module is the **keystone**: it makes every later phase mostly "annotate
params + return types" instead of re-inventing shapes.

## Migration order (bottom-up by dependency)

Convert leaves first so that by the time a dependent file is converted, its
imports are already typed. One file = one commit = one validation run.

### Phase 1 — Pure leaves (no internal deps, trivial types)
1. `lib/text.js` → `.ts` — ~1.2k LOC but almost all string/function constants;
   mechanical, high-confidence, unlocks typed message keys everywhere.
2. `lib/sessionTypes.js` → `.ts` — enums/constants.
3. `lib/historyUtils.js` → `.ts`
4. `lib/guards.js` → `.ts`
5. `lib/confirmations.js` → `.ts`

### Phase 2 — Shared helpers
6. `lib/helpers.js` → `.ts` (imported nearly everywhere; type it against `Ctx`).
7. `lib/widgets.js` → `.ts`

### Phase 3 — Core data service (the big one)
8. `lib/storage.js` → `.ts` (~3.2k LOC). Type the exported object against
   `Storage` from `lib/types.ts`; add narrow types for Supabase
   `select`/`insert` payloads and row shapes (the `map*Row` helpers are natural
   typing boundaries). Biggest single effort — budget it alone. Once done, every
   handler gets real autocomplete + safety on storage calls.

### Phase 4 — Session services
9. `lib/sessionParticipants.js` → `.ts`
10. `lib/sessionSync.js` → `.ts`

### Phase 5 — Command handlers (`lib/handlers/commands/`)
Small, independent files — convert in a batch, one commit each or grouped:
`info`, `sortnames`, `feedback`, `groups`, `history`, `members`, `start`,
`status`, `stop`, `tagstudents`, `teachers`, then `index.js` (aggregator) last.

### Phase 6 — Action handlers (`lib/handlers/actions/`)
Convert remaining `.js`: `confirm`, `groups`, `attendance`, `manage`, `members`,
`hub`, `history`, `text`, `offline` (1.5k LOC — do near the end), then
`index.js` (aggregator) last.

### Phase 7 — Entrypoints
- `index.js` → `index.ts` (already run via `node --import tsx index.js`; update
  `package.json` `start`/`main` to `index.ts`).
- `api/privacy.js` → `.ts`, `api/telegram.js` → `.ts`.
- **Update `vercel.json`**: change the `functions` key from `api/telegram.js` to
  `api/telegram.ts` (the redirect stays `/api/telegram`).

### Phase 8 — Scripts (optional, lowest priority)
`scripts/*.js`, `eslint.config.js`. These are dev/ops tooling; convert last or
leave as JS if not worth it.

### Phase 9 — Tighten the compiler once no `.js` remains
- Remove `allowJs`/`checkJs` (moot once no `.js` left).
- Optionally add `noImplicitReturns`, `exactOptionalPropertyTypes`,
  `noFallthroughCasesInSwitch`.
- Narrow the `tsconfig` `include` (drop `.js` allowances).
- Consider migrating `test/**/*.test.js` → `.ts` (the runner already globs
  `.{js,ts}`); `test/mocks.js` is the shared fixture to type first.

## Per-file checklist (repeat each rename)
1. `git mv path/file.js path/file.ts` (preserves history).
2. Leave all import specifiers as `.js`.
3. Run `tsc --noEmit`; fix every error in that file (annotate params/returns,
   replace local type dupes with `lib/types.ts` imports).
4. Run `eslint` (typescript-eslint rules now apply) + `npm test`.
5. Commit that single file. Never push.

## Validation (run after every file)
```
source ~/.nvm/nvm.sh && nvm use >/dev/null; \
  npx tsc --noEmit && npx eslint lib/ test/ api/ && \
  npm test 2>&1 | grep -E '# (tests|pass|fail)'
```

## Risks & notes
- **`storage.ts` (Phase 3)** is the largest and touches Supabase generics; give
  it a dedicated pass. Everything downstream is easier afterward.
- **`noUncheckedIndexedAccess`** means array/record indexing yields `T |
  undefined` — expect guards/`?.`/non-null assertions when converting loops that
  index by position (e.g. `files[i]`).
- **`verbatimModuleSyntax`** requires `import type { ... }` for type-only imports.
- Keep runtime behavior identical: a migration commit should be a **pure
  rename + annotations**, never a behavior change. Do refactors separately.
