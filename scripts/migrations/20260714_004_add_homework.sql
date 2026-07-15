-- Add homework tracking. An admin or homework teacher posts an assignment
-- (tagged #التكليف) in a linked homework group; registered members reply to
-- submit; homework teachers reply to a submission to mark it reviewed. Offline
-- classes have no group thread, so items and per-student status are managed by
-- hand from the class hub. This migration:
--   • adds group_settings.homework_group_id (Telegram chat id of the hw group),
--   • widens the teachers.teacher_type check to include 'homeworkteacher',
--   • creates the homework + homework_submissions tables (+ indexes, triggers,
--     RLS).
--
-- Idempotent (`if not exists`) and tracked in schema_migrations. Fresh clones
-- get all of this from scripts/supabase_v2.sql and never need to run this file.

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
    where version = '20260714_004_add_homework'
  ) then
    -- 1. Link column for the dedicated homework group.
    alter table group_settings
      add column if not exists homework_group_id text;

    -- 2. Allow the new homework teacher type.
    alter table teachers
      drop constraint if exists teachers_teacher_type_check;
    alter table teachers
      add constraint teachers_teacher_type_check
      check (teacher_type in ('courseteacher', 'trainingteacher', 'recitationteacher', 'homeworkteacher'));

    -- 3. Homework items (group_id = main / offline class).
    create table if not exists homework (
      id bigserial primary key,
      group_id bigint not null references groups(id) on delete cascade,
      title text not null,
      source_message_id bigint,
      posted_by text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists idx_homework_group_active
      on homework (group_id, created_at)
      where active = true;

    -- One row per (homework, member); reviewed flips true on teacher reply.
    create table if not exists homework_submissions (
      id bigserial primary key,
      homework_id bigint not null references homework(id) on delete cascade,
      member_id bigint references members(id) on delete set null,
      submission_message_id bigint,
      submitted_at timestamptz not null default now(),
      reviewed boolean not null default false,
      reviewed_by text,
      reviewed_at timestamptz,
      updated_at timestamptz not null default now(),
      unique (homework_id, member_id)
    );

    create index if not exists idx_homework_submissions_homework
      on homework_submissions (homework_id);

    drop trigger if exists trg_homework_updated_at on homework;
    create trigger trg_homework_updated_at
    before update on homework
    for each row execute function touch_updated_at();

    drop trigger if exists trg_homework_submissions_updated_at on homework_submissions;
    create trigger trg_homework_submissions_updated_at
    before update on homework_submissions
    for each row execute function touch_updated_at();

    alter table homework enable row level security;
    alter table homework_submissions enable row level security;

    insert into schema_migrations (version)
    values ('20260714_004_add_homework');
  end if;
end $$;

commit;
