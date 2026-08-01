-- Incremental migration: per-user display preferences for the weekly timetable.
--   • timezone   — IANA zone the viewer wants times converted to (null = follow
--                  each class's own timezone, i.e. no conversion).
--   • week_start — weekday the viewer's week view starts on (0=Sun..6=Sat).
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
    where version = '20260715_007_user_prefs'
  ) then
    create table if not exists user_prefs (
      user_id text primary key,
      timezone text,
      week_start smallint not null default 6,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (week_start between 0 and 6)
    );

    insert into schema_migrations (version)
    values ('20260715_007_user_prefs');
  end if;
end $$;

commit;
