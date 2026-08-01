-- Incremental migration: add training_groups to group_settings
-- Safe to run multiple times.

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
    where version = '20260704_001_add_training_groups_to_group_settings'
  ) then
    alter table group_settings
      add column if not exists training_groups jsonb not null default '[]'::jsonb;

    insert into schema_migrations (version)
    values ('20260704_001_add_training_groups_to_group_settings');
  end if;
end $$;

commit;
