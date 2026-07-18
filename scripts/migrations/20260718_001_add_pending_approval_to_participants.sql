-- Persist the "awaiting admin approval" flag on session_participants.
--
-- Why: a walk-in who taps a roster/recitation list is counted present live but
-- is not yet a roster member — she is queued as a pending registration. To tag
-- her ⏳ in the LIVE list (not just the end-of-session report) the flag must
-- survive the serverless reload, and buildSessionPayload strips participants
-- (they live in session_participants), so an in-memory field alone is dropped on
-- write. A nullable boolean column keeps it: NULL/false means "not pending" (the
-- default for every registered member and every approved/dismissed walk-in),
-- true means she is still in the pending queue.

begin;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from schema_migrations
    where version = '20260718_001_add_pending_approval_to_participants'
  ) then
    alter table session_participants
      add column if not exists pending_approval boolean;

    insert into schema_migrations (version)
    values ('20260718_001_add_pending_approval_to_participants');
  end if;
end $$;

commit;
