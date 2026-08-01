-- Option A: route force-reply prompts by the prompt message's own message_id.
--
-- The legacy await_prompts table holds a single row per (group, admin), so only
-- one force-reply prompt could be open at a time; a second prompt required
-- blocking the admin (ensureNoPendingAwaiting) with a "you have a pending step"
-- nag. reply_prompts instead keys each open prompt by (chat_id, prompt_message_id).
-- When the admin replies, Telegram echoes the original prompt via
-- reply_to_message.message_id, which we look up directly — so multiple prompts
-- can be open concurrently with no blocking.
--
-- await_prompts is retained; it still backs the pendingStudents batch accumulator
-- (managingPendingStudents), which is keyed by (group, admin) and has no prompt id.
--
-- This migration is additive (creates a new table only) and safe to re-run.
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

drop trigger if exists trg_reply_prompts_updated_at on reply_prompts;
create trigger trg_reply_prompts_updated_at
before update on reply_prompts
for each row execute function touch_updated_at();

-- Service role bypasses RLS; no anon/authenticated policies by design.
alter table reply_prompts enable row level security;
