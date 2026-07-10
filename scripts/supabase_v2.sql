-- Supabase relational schema v2 for telegram attendance bot
-- Bootstrap schema for new environments. For changes to existing databases,
-- add an ordered migration under scripts/migrations/ instead.

create extension if not exists pgcrypto;

-- Groups and settings
create table if not exists groups (
  id bigserial primary key,
  telegram_chat_id text not null unique,
  title text,
  current_series integer not null default 1,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_series > 0)
);

create table if not exists group_settings (
  group_id bigint primary key references groups(id) on delete cascade,
  training_groups jsonb not null default '[]'::jsonb,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, telegram_user_id)
);

-- Keep active names unique to reduce collisions in attendance/reporting
create unique index if not exists uq_members_group_name_active
  on members (group_id, name)
  where active = true;

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
  check (teacher_type in ('courseteacher', 'trainingteacher', 'recitationteacher'))
);

create unique index if not exists uq_teachers_group_name_active
  on teachers (group_id, name)
  where active = true;

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
  started_at timestamptz not null default now(),
  started_by text,
  ended_at timestamptz,
  ended_by text,
  archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (session_type in ('main', 'open', 'registeredSecondary', 'personalRecitation', 'groupRecitation')),
  check (series_id > 0)
);

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

-- Awaiting prompt state (per admin user per group)
create table if not exists await_prompts (
  id bigserial primary key,
  group_id bigint not null references groups(id) on delete cascade,
  telegram_user_id text not null,
  action text not null,
  chat_id text not null,
  host_message_id bigint,
  prompt_message_id bigint,
  awaiting_prompt boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, telegram_user_id)
);

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

drop trigger if exists trg_await_prompts_updated_at on await_prompts;
create trigger trg_await_prompts_updated_at
before update on await_prompts
for each row execute function touch_updated_at();

drop trigger if exists trg_processed_updates_updated_at on processed_updates;
create trigger trg_processed_updates_updated_at
before update on processed_updates
for each row execute function touch_updated_at();

-- Security baseline: enable RLS on all application tables.
-- The bot uses SUPABASE_SERVICE_ROLE_KEY on the server, which bypasses RLS.
-- No anon/authenticated policies are defined here by design.
alter table groups enable row level security;
alter table group_settings enable row level security;
alter table members enable row level security;
alter table teachers enable row level security;
alter table pending_registrations enable row level security;
alter table sessions enable row level security;
alter table session_participants enable row level security;
alter table member_progress enable row level security;
alter table group_progress enable row level security;
alter table await_prompts enable row level security;
alter table processed_updates enable row level security;

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
