-- Split teaching materials into a lesson (class_materials) that owns one or more
-- files (class_material_files). Previously each class_materials row carried a
-- single file_id/file_type/file_name; a lesson could hold only one file. This
-- migration:
--   • creates class_material_files (one row per file, ordered by position),
--   • backfills each existing class_materials row's file as its position-1 file,
--   • drops the now-redundant file_id/file_type/file_name columns from
--     class_materials.
--
-- Idempotent and tracked in schema_migrations. Fresh clones get the final shape
-- from scripts/supabase_v2.sql and never need to run this file. Deploy the new
-- bot code first, then run this migration (old code reads the dropped columns).

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
    where version = '20260715_001_material_files'
  ) then
    -- 1. Child table: one row per file attached to a lesson.
    create table if not exists class_material_files (
      id bigserial primary key,
      material_id bigint not null references class_materials(id) on delete cascade,
      file_id text not null,
      file_type text not null,
      file_name text,
      position integer not null default 1,
      created_at timestamptz not null default now(),
      check (file_type in ('document', 'photo', 'video', 'audio'))
    );

    create index if not exists idx_class_material_files_material
      on class_material_files (material_id, position);

    -- 2. Backfill existing single-file lessons into position-1 file rows. Guard
    --    on the column still existing so re-runs after the drop are safe.
    if exists (
      select 1
      from information_schema.columns
      where table_name = 'class_materials'
        and column_name = 'file_id'
    ) then
      insert into class_material_files (material_id, file_id, file_type, file_name, position, created_at)
      select m.id, m.file_id, m.file_type, m.file_name, 1, m.created_at
      from class_materials m
      where m.file_id is not null
        and not exists (
          select 1 from class_material_files f where f.material_id = m.id
        );

      -- 3. Drop the now-redundant per-row file columns.
      alter table class_materials drop column if exists file_id;
      alter table class_materials drop column if exists file_type;
      alter table class_materials drop column if exists file_name;
    end if;

    insert into schema_migrations (version)
    values ('20260715_001_material_files');
  end if;
end $$;

commit;
