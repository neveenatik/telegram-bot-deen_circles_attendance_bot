-- Track homework resubmissions. A submission may be sent again after a homework
-- teacher's review (e.g. corrections requested); resubmitted marks that state
-- (awaiting re-review) and a fresh review clears it back to reviewed. Adds the
-- two columns to homework_submissions.
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
    where version = '20260715_002_homework_resubmitted'
  ) then
    alter table homework_submissions
      add column if not exists resubmitted boolean not null default false;
    alter table homework_submissions
      add column if not exists resubmitted_at timestamptz;

    insert into schema_migrations (version)
    values ('20260715_002_homework_resubmitted');
  end if;
end $$;

commit;
