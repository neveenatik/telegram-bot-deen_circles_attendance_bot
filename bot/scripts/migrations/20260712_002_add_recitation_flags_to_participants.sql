-- Persist the recitation-correction flags on session_participants.
--
-- Why: `attendedMain` (did she attest to attending the main halaqa?) and
-- `backup` (registered on the reserve list after the list was frozen?) lived
-- only on the in-memory session.participants record. Neither was a column nor
-- part of metadata.session_blob (buildSessionPayload strips participants), so on
-- the serverless webhook they were silently dropped on write and gone on the
-- next cold read — the reserve-list partition and the "لم تحضر الأساسية" tag
-- would vanish after any reload/redeploy.
--
-- Both are nullable booleans: NULL means "not applicable / not set" (the default
-- for every non-recitation participant), matching the undefined-by-default shape
-- the app already uses.

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
    where version = '20260712_002_add_recitation_flags_to_participants'
  ) then
    alter table session_participants
      add column if not exists attended_main boolean,
      add column if not exists backup boolean;

    insert into schema_migrations (version)
    values ('20260712_002_add_recitation_flags_to_participants');
  end if;
end $$;

commit;
