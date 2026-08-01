-- Drop the legacy await_prompts table from an existing v2 database.
-- Context: force-reply prompt routing now lives entirely in reply_prompts
-- (keyed by the prompt message's own id). The only remaining consumer of
-- await_prompts was the pendingStudents batch-welcome accumulator, which has
-- been replaced by a persistent `welcomedAt` flag on each member. Nothing
-- reads or writes await_prompts anymore.
-- Run once in the Supabase SQL editor.

drop trigger if exists trg_await_prompts_updated_at on await_prompts;
drop table if exists await_prompts;
