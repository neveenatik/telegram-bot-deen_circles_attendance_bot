-- Add class_materials: teaching materials (documents/photos/videos/audio) an
-- admin or operator uploads for a class. We store only Telegram's file_id
-- (Telegram hosts the bytes); the same file_id is reused to resend the file to
-- the group (live) or back to the uploader's DM (offline). Scoped to a class and
-- cascades on class delete.
--
-- Idempotent (`if not exists`) and tracked in schema_migrations. Fresh clones get
-- this table from scripts/supabase_v2.sql and never need to run this file.

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
    where version = '20260714_003_add_class_materials'
  ) then
    create table if not exists class_materials (
      id bigserial primary key,
      group_id bigint not null references groups(id) on delete cascade,
      title text not null,
      file_id text not null,
      file_type text not null,
      file_name text,
      added_by text,
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (file_type in ('document', 'photo', 'video', 'audio'))
    );

    create index if not exists idx_class_materials_group_active
      on class_materials (group_id, created_at)
      where active = true;

    drop trigger if exists trg_class_materials_updated_at on class_materials;
    create trigger trg_class_materials_updated_at
    before update on class_materials
    for each row execute function touch_updated_at();

    alter table class_materials enable row level security;

    insert into schema_migrations (version)
    values ('20260714_003_add_class_materials');
  end if;
end $$;

commit;
