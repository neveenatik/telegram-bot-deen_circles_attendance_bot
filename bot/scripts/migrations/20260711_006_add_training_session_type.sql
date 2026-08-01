-- Add 'training' to the sessions.session_type CHECK constraint. Training lists
-- (/starttraininglist) are now a first-class session type instead of reusing
-- 'main'. Behaves like 'main' but allows public registration for walk-ins and
-- renders in registration order; it also gets its own report bucket.
--
-- The inline CHECK constraint declared in supabase_v2.sql is auto-named
-- `sessions_session_type_check`. We drop and re-create it with 'training' added.
-- Run once in the Supabase SQL editor (before deploying the type change, or new
-- 'training' inserts will violate the old constraint).

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
    where version = '20260711_006_add_training_session_type'
  ) then
    alter table sessions
      drop constraint if exists sessions_session_type_check;

    alter table sessions
      add constraint sessions_session_type_check
      check (session_type in ('main', 'training', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation'));

    insert into schema_migrations (version)
    values ('20260711_006_add_training_session_type');
  end if;
end $$;

commit;
