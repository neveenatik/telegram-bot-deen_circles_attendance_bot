# Storage V2 Migration Plan

## Goals
- Replace large mutable JSON blobs with member/session/checkpoint row-based records.
- Make student clicks concurrency-safe by default.
- Preserve current behavior, including checkpoint->present policy only for `main` sessions.
- Keep migration reversible and observable.

## Decisions Confirmed
- Use normalized tables (not single KV table) in Supabase.
- Checkpoint confirmation contributes to final attendance for `main` sessions only (configurable later).

## Why This Design
- Concurrent clicks from different students write different rows, avoiding overwrite collisions.
- Unique constraints enforce idempotency for repeated clicks.
- Session close and admin edits can be handled with explicit precedence rules.

## Proposed Precedence Rules
- Student attendance click updates their own `session_participants` row.
- Admin explicit status update wins over student click if both happen nearly together.
- After session is closed (`sessions.active=false`), student writes are rejected.
- Checkpoint confirmations remain append-only and idempotent.

## Phased Rollout

### Phase 0: Safety Baseline (done)
- Fixed type-aware active session retrieval bugs.
- Fixed awaiting tombstones and cleanup gaps in storage adapter.

### Phase 1: Create V2 Tables
- Apply [scripts/supabase_v2.sql](../scripts/supabase_v2.sql).
- Do not switch reads/writes yet.

### Phase 2: Backfill from KV
- Build one-time migrator:
  - KV -> groups, group_settings
  - master -> members
  - teachers -> teachers
  - pendingregistrations -> pending_registrations
  - current/sessions -> sessions + session_participants + checkpoints + session_messages
  - page progress -> member_progress / group_progress
  - await keys -> await_prompts
- Validate row counts and referential integrity.

### Phase 3: Dual-write (Shadow)
- Keep current reads from old adapter.
- On each write path, also write to V2 tables.
- Add write audit logs and mismatch checks.

### Phase 4: Read Switch
- Move read paths to V2 for:
  - active session
  - participants and attendance
  - pending registrations
  - checkpoint confirmation
- Keep old writes disabled but retain old data for rollback window.

### Phase 5: Decommission KV Session Blobs
- Stop writing `current:*` and `sessions:*` blobs.
- Keep only transitional keys if still needed.
- Run cleanup once confidence is high.

## Verification Checklist
- Concurrent attendance clicks from many users keep all updates.
- Duplicate webhook retries do not duplicate confirmations.
- `/stoplist` output matches pre-migration behavior.
- `main` checkpoint policy works and remains isolated from other session types.
- Cleanup scripts remove all group-scoped rows correctly.

## Open Technical Tasks
- Add `processed_updates` handling in webhook pipeline for idempotency.
- Add migration script and dry-run mode.
- Add integrity checks for member name collisions and historical guest rows.
- Add admin observability command for active session diagnostics.
