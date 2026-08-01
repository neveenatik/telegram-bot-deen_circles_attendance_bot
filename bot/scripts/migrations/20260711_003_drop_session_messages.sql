-- Drop the unused session_messages table from an existing v2 database.
-- Context: the table was meant to track the bot's outgoing message ids per
-- session, but runtime never reads or writes it. Those ids live in the session
-- metadata blob (messageId / actionMessageIds / listMessageIds) and are only
-- used for in-place message editing/cleanup, never queried across sessions.
-- Run once in the Supabase SQL editor.

drop table if exists session_messages;
