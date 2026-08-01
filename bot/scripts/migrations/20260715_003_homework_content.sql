-- Add teacher-authored content to homework items. A homework item can carry a
-- text body (homework.content) and/or attached media files (homework_files:
-- photo, voice/audio, video, document) that students view/hear in the offline
-- self-service flow. Mirrors the teaching-materials file model.
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
    where version = '20260715_003_homework_content'
  ) then
    alter table homework
      add column if not exists content text;

    create table if not exists homework_files (
      id bigserial primary key,
      homework_id bigint not null references homework(id) on delete cascade,
      file_id text not null,
      file_type text not null,
      file_name text,
      position integer not null default 1,
      created_at timestamptz not null default now(),
      check (file_type in ('document', 'photo', 'video', 'audio'))
    );

    create index if not exists idx_homework_files_homework
      on homework_files (homework_id, position);

    insert into schema_migrations (version)
    values ('20260715_003_homework_content');
  end if;
end $$;

commit;
