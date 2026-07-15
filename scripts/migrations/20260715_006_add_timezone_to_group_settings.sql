-- Incremental migration: add timezone to group_settings
-- Each class stores its own IANA timezone so weekly timetable times are shown
-- (and later scheduled) in the class's local time. Safe to run multiple times.

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
    where version = '20260715_006_add_timezone_to_group_settings'
  ) then
    alter table group_settings
      add column if not exists timezone text not null default 'Asia/Riyadh';

    insert into schema_migrations (version)
    values ('20260715_006_add_timezone_to_group_settings');
  end if;
end $$;

commit;
