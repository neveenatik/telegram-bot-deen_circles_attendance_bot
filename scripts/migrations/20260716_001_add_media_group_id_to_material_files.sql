-- Add media_group_id to class_material_files so album (multi-file) uploads can
-- share one caption/name reliably. Telegram delivers each album item as a
-- separate webhook call and puts the caption on only one item; tagging every
-- file row with the album's media_group_id lets a captioned item back-fill the
-- name onto its siblings regardless of the order the invocations run in.
-- Run once in the Supabase SQL editor.

alter table class_material_files
  add column if not exists media_group_id text;

create index if not exists idx_class_material_files_album
  on class_material_files (material_id, media_group_id)
  where media_group_id is not null;
