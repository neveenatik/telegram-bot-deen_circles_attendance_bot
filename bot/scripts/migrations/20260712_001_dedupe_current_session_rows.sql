-- Remove duplicate "current" session rows left behind by the old stop flow.
--
-- Before this fix, stopping a session created a separate archived snapshot
-- (legacy_key `archive-live:<gid>:<type>:<startedAt>`) but only *deactivated* the
-- live `current:<gid>:<type>` row instead of deleting it. Because there is one
-- `current:<type>` slot per (group, type), the most recent stopped session of
-- each type ended up stored twice: once as the lingering current row and once as
-- its archive-live snapshot — each carrying a full copy of session_participants.
--
-- This deletes each non-archived current-slot row that has a matching archived
-- snapshot (same group, type and started_at). Genuinely live sessions have no
-- snapshot yet, so they are NOT matched and remain untouched. The
-- session_participants on-delete-cascade removes the duplicate participant rows.
--
-- Idempotent: re-running finds no further duplicates. Run once in the Supabase
-- SQL editor.

begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from schema_migrations
    where version = '20260712_001_dedupe_current_session_rows'
  ) then
    delete from sessions c
    using sessions a
    where c.archived = false
      and a.archived = true
      and c.group_id = a.group_id
      and c.session_type = a.session_type
      and c.started_at = a.started_at;

    insert into schema_migrations (version)
    values ('20260712_001_dedupe_current_session_rows');
  end if;
end $$;

commit;
