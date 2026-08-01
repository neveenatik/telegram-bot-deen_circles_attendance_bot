-- Add media_group_id to class_materials so a brand-new lesson uploaded as an
-- album (several files at once) resolves to ONE lesson. Telegram delivers each
-- album item as a separate, possibly concurrent webhook call, so without a
-- shared key the items race to create duplicate lessons (or drop the ones that
-- arrive before the captioned item). Tagging the lesson with the album's
-- media_group_id + a unique index lets the concurrent inserts collapse onto a
-- single row (upsert on conflict). Run once in the Supabase SQL editor.

alter table class_materials
  add column if not exists media_group_id text;

create unique index if not exists uq_class_materials_album
  on class_materials (media_group_id)
  where media_group_id is not null;
