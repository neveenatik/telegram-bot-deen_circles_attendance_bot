-- Add parent_group_id to groups: links a training group to the main group that
-- owns it (1:1 from the training side). Used, on teacher approval of a walk-in
-- pending registration, to backfill the student from a training list into the
-- main group's roster so they appear in the main group's reports.
--
-- The column add is idempotent (`if not exists`), but we still register it in
-- schema_migrations for consistency with the other tracked migrations. Run once
-- in the Supabase SQL editor.

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
    where version = '20260711_005_add_parent_group_id_to_groups'
  ) then
    alter table groups
      add column if not exists parent_group_id bigint references groups(id) on delete set null;

    insert into schema_migrations (version)
    values ('20260711_005_add_parent_group_id_to_groups');
  end if;
end $$;

commit;
