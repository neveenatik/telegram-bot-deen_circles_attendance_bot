-- Add a persistent `welcomed_at` flag to members and backfill existing rows.
--
-- Context: the "send acceptance confirmation" (sendConfirmations) action used to
-- re-welcome the entire roster on every press, because there was no persisted
-- record of who had already been welcomed (the only tracking was the ephemeral
-- await_prompts accumulator, now removed). `welcomed_at` makes that state durable:
-- sendConfirm/sendConfirmations stamp it, and sendConfirmations only welcomes
-- members whose welcomed_at is null.
--
-- Backfill: existing members are treated as already welcomed by setting
-- welcomed_at = created_at, so the first sendConfirmations after this release does
-- NOT blast the whole roster. New members are inserted with welcomed_at = null and
-- will be welcomed on the next confirmation.
--
-- IMPORTANT ordering: apply this migration BEFORE deploying the code that reads
-- welcomed_at (getMaster selects it). It is additive and safe to re-run.

alter table members add column if not exists welcomed_at timestamptz;

update members set welcomed_at = created_at where welcomed_at is null;
