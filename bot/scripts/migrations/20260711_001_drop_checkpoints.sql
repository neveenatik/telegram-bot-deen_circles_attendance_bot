-- Drop the checkpoint feature from an existing v2 database.
-- Context: checkpoints were only ever used to test functionality. Runtime never
-- read these tables (checkpoint state lived in the session metadata blob), and
-- the feature has been removed from the bot. Run once in the Supabase SQL editor.

-- 1. Remove the checkpoint tables (confirmations first: it FKs checkpoints).
drop table if exists checkpoint_confirmations;
drop table if exists checkpoints;

-- 2. Narrow the session_messages kinds to drop the unused 'checkpoint' kind.
alter table session_messages drop constraint if exists session_messages_message_kind_check;
alter table session_messages
  add constraint session_messages_message_kind_check
  check (message_kind in ('widget', 'list', 'action', 'admin'));

-- 3. Remove the unused checkpoint attendance-counting setting.
alter table group_settings drop column if exists checkpoint_counts_as_present_for;
