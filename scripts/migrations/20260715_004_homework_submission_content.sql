-- Student self-service homework loop. A student (a roster member with a linked
-- Telegram user_id) submits homework via DM as text and/or a single media file;
-- the reviewing teacher replies with feedback the student sees back. Adds the
-- submission content + teacher-reply columns to homework_submissions.
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
    where version = '20260715_004_homework_submission_content'
  ) then
    alter table homework_submissions
      add column if not exists content text;
    alter table homework_submissions
      add column if not exists file_id text;
    alter table homework_submissions
      add column if not exists file_type text;
    alter table homework_submissions
      add column if not exists teacher_reply text;
    alter table homework_submissions
      add column if not exists teacher_reply_at timestamptz;

    insert into schema_migrations (version)
    values ('20260715_004_homework_submission_content');
  end if;
end $$;

commit;
