-- Incremental migration: teachers may hold MORE THAN ONE role at once (e.g. a
-- teacher who is both a recitation teacher and a training teacher, or even also
-- the main course teacher). The single `teacher_type` column can only hold one
-- role, so it is replaced by a `teacher_types text[]` set.
--   • adds teacher_types text[],
--   • backfills it from the existing single teacher_type,
--   • constrains it to a non-empty subset of the valid roles,
--   • retires the old teacher_type column (+ its check).
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
    where version = '20260715_008_teacher_roles'
  ) then
    -- 1. New multi-role column.
    alter table teachers
      add column if not exists teacher_types text[];

    -- 2. Backfill from the single role; give any stray null a safe default.
    update teachers
      set teacher_types = array[teacher_type]
      where teacher_types is null and teacher_type is not null;
    update teachers
      set teacher_types = array['recitationteacher']
      where teacher_types is null or array_length(teacher_types, 1) is null;

    -- 3. Constrain: at least one role, all from the valid set.
    alter table teachers
      alter column teacher_types set not null;
    alter table teachers
      drop constraint if exists teachers_teacher_types_check;
    alter table teachers
      add constraint teachers_teacher_types_check
      check (
        array_length(teacher_types, 1) >= 1
        and teacher_types <@ array['courseteacher', 'trainingteacher', 'recitationteacher', 'homeworkteacher']::text[]
      );

    -- 4. Retire the single-role column and its check.
    alter table teachers
      drop constraint if exists teachers_teacher_type_check;
    alter table teachers
      drop column if exists teacher_type;

    insert into schema_migrations (version)
    values ('20260715_008_teacher_roles');
  end if;
end $$;

commit;
