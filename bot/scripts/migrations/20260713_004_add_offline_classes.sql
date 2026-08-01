-- Offline classes: DM-only classes owned by a single user, not backed by a
-- Telegram group. Reuses the existing groups/members/sessions/teachers tables.
--
-- An offline class is a `groups` row whose telegram_chat_id is a synthetic,
-- stable key (`offline:<ownerId>:<uuid>`), tagged with the owning user and a
-- human class name that must be unique per owner. The name is a mutable label;
-- identity lives in the stable telegram_chat_id so renames never orphan rows.

alter table groups
  add column if not exists owner_user_id text,
  add column if not exists class_name text;

-- One class name per owner (offline rows only; live groups leave these null).
create unique index if not exists uq_groups_owner_class
  on groups (owner_user_id, class_name)
  where owner_user_id is not null;

-- List an owner's offline classes efficiently.
create index if not exists idx_groups_owner_user_id
  on groups (owner_user_id)
  where owner_user_id is not null;

-- A session may be assigned one teacher (offline and live). Nulls out if the
-- teacher is removed, leaving the session intact.
alter table sessions
  add column if not exists teacher_id bigint references teachers(id) on delete set null;
