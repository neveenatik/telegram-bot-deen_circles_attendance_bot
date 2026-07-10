-- Retire the legacy KV table.
-- Context: the bot has fully migrated to the v2 relational schema and the
-- runtime no longer reads or writes the `kv` table. It remained only as a
-- rollback path to the old v1/KV deployment. Run once, in the Supabase SQL
-- editor, after taking a final backup/export of `kv` if you want the rollback
-- insurance preserved outside the database.
drop table if exists kv;
