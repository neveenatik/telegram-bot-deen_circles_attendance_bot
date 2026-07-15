-- Supabase relational schema v2 for telegram attendance bot
-- Bootstrap schema for new environments. For changes to existing databases,
-- add an ordered migration under scripts/migrations/ instead.

create extension if not exists pgcrypto;

-- Groups and settings
create table if not exists groups (
  id bigserial primary key,
  telegram_chat_id text not null unique,
  title text,
  -- Offline classes: owner (Telegram user id) + human class name, unique per
  -- owner. Null for live, group-backed rows. telegram_chat_id stays the stable
  -- identity (`offline:<ownerId>:<uuid>`) so a rename never orphans child rows.
  owner_user_id text,
  class_name text,
  current_series integer not null default 1,
  last_activity_at timestamptz,
  parent_group_id bigint references groups(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_series > 0)
);

-- One class name per owner (offline rows only) + fast owner listing.
create unique index if not exists uq_groups_owner_class
  on groups (owner_user_id, class_name)
  where owner_user_id is not null;

create index if not exists idx_groups_owner_user_id
  on groups (owner_user_id)
  where owner_user_id is not null;

create table if not exists group_settings (
  group_id bigint primary key references groups(id) on delete cascade,
  training_groups jsonb not null default '[]'::jsonb,
  -- Telegram chat id of the dedicated homework group linked to this main group
  -- (null when none). The homework group's own row also sets parent_group_id to
  -- this group, mirroring how training groups are linked.
  homework_group_id text,
  retention_days integer not null default 90,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (retention_days > 0)
);

-- Registered members
create table if not exists members (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  telegram_user_id text not null,
  name text not null,
  active boolean not null default true,
  list_number integer,
  welcomed_at timestamptz,
  created_at timestamptz not null default now(),
  training_group_id text,
  updated_at timestamptz not null default now(),
  unique (group_id, telegram_user_id)
);

-- Keep active names unique to reduce collisions in attendance/reporting
create unique index if not exists uq_members_group_name_active
  on members (group_id, name)
  where active = true;

-- Sequential roster number students use to reach teachers. Unique per group
-- among assigned (non-null) values; nulls may repeat.
create unique index if not exists uq_members_group_list_number
  on members (group_id, list_number)
  where list_number is not null;

-- Teachers
create table if not exists teachers (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  telegram_user_id text not null,
  name text not null,
  teacher_type text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, telegram_user_id),
  check (teacher_type in ('courseteacher', 'trainingteacher', 'recitationteacher', 'homeworkteacher'))
);

create unique index if not exists uq_teachers_group_name_active
  on teachers (group_id, name)
  where active = true;

-- Delegation for offline classes: an owner (groups.owner_user_id) can share a
-- class with other users, each with a per-person role, so they can help manage
-- it from their own DMs. Rows are scoped to a class and cascade on class delete.
--   operator  = full operational access EXCEPT rename/delete class + managers.
--   assistant = attendance editing in existing sessions + reports only.
create table if not exists class_managers (
  group_id bigint not null references groups(id) on delete cascade,
  user_id text not null,
  manager_role text not null default 'operator',
  display_name text,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id),
  check (manager_role in ('operator', 'assistant'))
);

create index if not exists idx_class_managers_user_id
  on class_managers (user_id);

-- Teaching materials: a "material" is a lesson (a title) that owns one or more
-- files (documents/photos/videos/audio) an admin or operator uploads for a
-- class. The lesson lives here; its files live in class_material_files. We store
-- only Telegram's file_id (Telegram hosts the bytes); the same file_id is reused
-- to resend the files to the group (live) or back to the uploader's DM (offline).
-- Scoped to a class and cascades on delete.
create table if not exists class_materials (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  title text not null,
  added_by text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_class_materials_group_active
  on class_materials (group_id, created_at)
  where active = true;

-- One row per file attached to a lesson. position orders files within a lesson
-- (1-based). Hard-deleted with the lesson (cascade); the lesson itself is
-- soft-deleted via class_materials.active.
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

-- Homework tracking. An admin or homework teacher posts an assignment (tagged
-- #التكليف) in the linked homework group; registered members reply to submit;
-- homework teachers reply to a submission to mark it reviewed. Offline classes
-- have no group thread, so items and per-student status are managed by hand from
-- the class hub (source_message_id / submission_message_id stay null there).
-- group_id is the MAIN (or offline) class; cascades on class delete.
create table if not exists homework (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  title text not null,
  content text,
  source_message_id bigint,
  posted_by text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_homework_group_active
  on homework (group_id, created_at)
  where active = true;

-- One row per media file attached to a homework item's content (the teacher's
-- assignment material: photo, voice/audio, video, or document). position orders
-- files within an item (1-based). Hard-deleted with the item (cascade); the item
-- itself is soft-deleted via homework.active. Mirrors class_material_files.
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

-- One row per (homework, member). A row exists once the member has submitted;
-- reviewed flips true when a homework teacher replies to the submission.
-- resubmitted flips true when the member submits again after a review (awaiting
-- re-review); a fresh review clears it.
create table if not exists homework_submissions (
  id bigserial primary key,
  homework_id bigint not null references homework(id) on delete cascade,
  member_id bigint references members(id) on delete set null,
  submission_message_id bigint,
  submitted_at timestamptz not null default now(),
  reviewed boolean not null default false,
  reviewed_by text,
  reviewed_at timestamptz,
  resubmitted boolean not null default false,
  resubmitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (homework_id, member_id)
);

create index if not exists idx_homework_submissions_homework
  on homework_submissions (homework_id);

-- Pending registration queue from /myid
create table if not exists pending_registrations (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  telegram_user_id text not null,
  name text not null,
  username text,
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('pending', 'approved', 'dismissed'))
);

create unique index if not exists uq_pending_group_user_pending
  on pending_registrations (group_id, telegram_user_id)
  where status = 'pending';

-- Sessions
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  group_id bigint not null references groups(id) on delete cascade,
  session_type text not null,
  name text not null,
  series_id integer not null,
  active boolean not null default true,
  registration_active boolean not null default true,
  allow_public_registration boolean not null default false,
  chat_id text not null,
  widget_message_id bigint,
  -- In-session page allocator for group-recitation sessions. Handed out and
  -- advanced atomically via allocate_group_recitation_page(); never written by
  -- the general session upsert (which would clobber concurrent allocations).
  group_recitation_next_page integer not null default 1,
  started_at timestamptz not null default now(),
  started_by text,
  ended_at timestamptz,
  ended_by text,
  archived boolean not null default false,
  -- Optional teacher assigned to this session (nulls out if the teacher row is
  -- removed). Used by offline classes and available to live sessions too.
  teacher_id bigint references teachers(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (session_type in ('main', 'training', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation')),
  check (series_id > 0),
  check (group_recitation_next_page > 0)
);

-- Atomically hand out the current group-recitation page and advance the counter
-- in a single locked UPDATE, so concurrent self-registrations never collide on
-- the same page number. Returns the page just allocated.
create or replace function allocate_group_recitation_page(p_session_id uuid)
returns integer
language sql
as $$
  update sessions
     set group_recitation_next_page = group_recitation_next_page + 1
   where id = p_session_id
   returning group_recitation_next_page - 1;
$$;

-- One active session per group at a time
create unique index if not exists uq_sessions_group_active
  on sessions (group_id)
  where active = true;

create index if not exists idx_sessions_group_started_at on sessions (group_id, started_at desc);
create index if not exists idx_sessions_group_type on sessions (group_id, session_type);

-- Session participants, one row per member (or guest) per session
create table if not exists session_participants (
  id bigserial primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  member_id bigint references members(id) on delete set null,
  guest_name text,
  display_name text not null,
  attendance_status text,
  called_state text,
  registration_time timestamptz,
  pages text,
  verse text,
  attended_main boolean,
  backup boolean,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attendance_status in ('present', 'listening', 'excused', 'absent') or attendance_status is null),
  check (called_state in ('responding', 'responded', 'away') or called_state is null),
  check ((member_id is not null) or (guest_name is not null and guest_name <> ''))
);

create unique index if not exists uq_session_participants_member
  on session_participants (session_id, member_id)
  where member_id is not null;

create unique index if not exists uq_session_participants_guest
  on session_participants (session_id, guest_name)
  where guest_name is not null;

create index if not exists idx_session_participants_session on session_participants (session_id);
create index if not exists idx_session_participants_display_name on session_participants (session_id, display_name);

-- Cross-session recitation progress per member
create table if not exists member_progress (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  member_id bigint not null references members(id) on delete cascade,
  mode text not null,
  page_value text,
  updated_at timestamptz not null default now(),
  unique (group_id, member_id, mode),
  check (mode in ('personalRecitation', 'groupRecitation'))
);

create table if not exists group_progress (
  group_id bigint not null references groups(id) on delete cascade,
  mode text not null,
  next_page integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (group_id, mode),
  check (mode in ('groupRecitation')),
  check (next_page > 0)
);

-- Force-reply prompt routing keyed by the prompt message's own id. reply_prompts
-- allows many open prompts per admin: on reply, Telegram echoes
-- reply_to_message.message_id which we look up here.
create table if not exists reply_prompts (
  id bigserial primary key,
  chat_id text not null,
  prompt_message_id bigint not null,
  telegram_user_id text not null,
  group_id text not null,
  action text not null,
  host_message_id bigint,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, prompt_message_id)
);

create index if not exists idx_reply_prompts_expires_at on reply_prompts (expires_at);

-- Deduplicate Telegram retries and ensure idempotency
create table if not exists processed_updates (
  update_id bigint primary key,
  status text not null default 'processing',
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  retry_count integer not null default 0,
  last_error text,
  check (status in ('processing', 'processed', 'failed'))
);

-- Generic updated_at trigger
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_groups_updated_at on groups;
create trigger trg_groups_updated_at
before update on groups
for each row execute function touch_updated_at();

drop trigger if exists trg_group_settings_updated_at on group_settings;
create trigger trg_group_settings_updated_at
before update on group_settings
for each row execute function touch_updated_at();

drop trigger if exists trg_members_updated_at on members;
create trigger trg_members_updated_at
before update on members
for each row execute function touch_updated_at();

drop trigger if exists trg_teachers_updated_at on teachers;
create trigger trg_teachers_updated_at
before update on teachers
for each row execute function touch_updated_at();

drop trigger if exists trg_class_managers_updated_at on class_managers;
create trigger trg_class_managers_updated_at
before update on class_managers
for each row execute function touch_updated_at();

drop trigger if exists trg_class_materials_updated_at on class_materials;
create trigger trg_class_materials_updated_at
before update on class_materials
for each row execute function touch_updated_at();

drop trigger if exists trg_homework_updated_at on homework;
create trigger trg_homework_updated_at
before update on homework
for each row execute function touch_updated_at();

drop trigger if exists trg_homework_submissions_updated_at on homework_submissions;
create trigger trg_homework_submissions_updated_at
before update on homework_submissions
for each row execute function touch_updated_at();

drop trigger if exists trg_pending_registrations_updated_at on pending_registrations;
create trigger trg_pending_registrations_updated_at
before update on pending_registrations
for each row execute function touch_updated_at();

drop trigger if exists trg_sessions_updated_at on sessions;
create trigger trg_sessions_updated_at
before update on sessions
for each row execute function touch_updated_at();

drop trigger if exists trg_session_participants_updated_at on session_participants;
create trigger trg_session_participants_updated_at
before update on session_participants
for each row execute function touch_updated_at();

drop trigger if exists trg_reply_prompts_updated_at on reply_prompts;
create trigger trg_reply_prompts_updated_at
before update on reply_prompts
for each row execute function touch_updated_at();

drop trigger if exists trg_processed_updates_updated_at on processed_updates;
create trigger trg_processed_updates_updated_at
before update on processed_updates
for each row execute function touch_updated_at();

-- Auto-assign members.list_number on insert: next sequential number per group,
-- unless one was supplied explicitly (e.g. the backfill script). Fires only on
-- INSERT, so existing members keep their assigned number on update/reactivation.
create or replace function assign_member_list_number()
returns trigger as $$
begin
  if new.list_number is null then
    -- Serialize concurrent inserts for the same group so two rows can't read the
    -- same max() and compute the same next number. Keyed on group_id; released
    -- automatically at transaction end. Different groups use different keys and
    -- do not block each other.
    perform pg_advisory_xact_lock(new.group_id);

    select coalesce(max(list_number), 0) + 1
      into new.list_number
      from members
      where group_id = new.group_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_assign_member_list_number on members;
create trigger trg_assign_member_list_number
before insert on members
for each row execute function assign_member_list_number();

-- Security baseline: enable RLS on all application tables.
-- The bot uses SUPABASE_SERVICE_ROLE_KEY on the server, which bypasses RLS.
-- No anon/authenticated policies are defined here by design.
alter table groups enable row level security;
alter table group_settings enable row level security;
alter table members enable row level security;
alter table teachers enable row level security;
alter table class_materials enable row level security;
alter table homework enable row level security;
alter table homework_submissions enable row level security;
alter table pending_registrations enable row level security;
alter table sessions enable row level security;
alter table session_participants enable row level security;
alter table member_progress enable row level security;
alter table group_progress enable row level security;
alter table processed_updates enable row level security;
alter table reply_prompts enable row level security;
-- ─── Scheduled retention: prune processed_updates ─────────────────────────────
-- The processed_updates table is a dedup ledger for at-least-once webhook
-- delivery. A row only matters while Telegram might redeliver the same
-- update_id (minutes, not days), so old rows are safe to delete.
--   • non-failed rows: pruned after 1 day
--   • failed rows: kept 30 days for debugging
-- Runs daily via pg_cron (Supabase Cron).
create extension if not exists pg_cron;

select cron.schedule(
  'prune_processed_updates',
  '0 3 * * *',
  $$
    delete from processed_updates
    where (status <> 'failed' and coalesce(processed_at, updated_at) < now() - interval '1 day')
       or (status =  'failed' and coalesce(processed_at, updated_at) < now() - interval '30 days')
  $$
);
