-- Weekly lesson timetable (the class "roster"/schedule). Each row is a recurring
-- weekly slot: a session type on a weekday at a time, with an optional teacher.
-- Plan/timetable only — it does NOT create attendance sessions. Rows carry a
-- stable id so a future scheduled-actions feature can reference a slot to fire
-- timed reminders relative to its day/time.
--
-- Idempotent and tracked in schema_migrations. Fresh clones get the final shape
-- from scripts/supabase_v2.sql and never need to run this file.

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
    where version = '20260715_005_class_schedule'
  ) then
    create table if not exists class_schedule (
      id bigserial primary key,
      group_id bigint not null references groups(id) on delete cascade,
      session_type text not null,
      day_of_week smallint not null,
      time_of_day text not null,
      teacher_id bigint references teachers(id) on delete set null,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (day_of_week between 0 and 6)
    );

    create index if not exists idx_class_schedule_group
      on class_schedule (group_id, day_of_week, time_of_day)
      where active = true;

    insert into schema_migrations (version)
    values ('20260715_005_class_schedule');
  end if;
end $$;

commit;
