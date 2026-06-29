-- Run once in Supabase (SQL editor). Key/value store for the attendance bot.
create table if not exists kv (
  key   text primary key,
  value jsonb
);
