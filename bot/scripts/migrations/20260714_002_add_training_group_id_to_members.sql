-- Add training_group_id to members: the offline training group a student is
-- assigned to. Offline classes have no linked Telegram group, so their training
-- groups are labels stored in group_settings.training_groups (see
-- storage.addOfflineTrainingGroup); each student stores the id of the one
-- training group she belongs to (or null when unassigned).
--
-- Nullable text (the synthetic training-group id / uuid). Online rosters leave
-- it null. Idempotent (`if not exists`) and tracked in schema_migrations.

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
    where version = '20260714_002_add_training_group_id_to_members'
  ) then
    alter table members
      add column if not exists training_group_id text;

    insert into schema_migrations (version)
    values ('20260714_002_add_training_group_id_to_members');
  end if;
end $$;

commit;
