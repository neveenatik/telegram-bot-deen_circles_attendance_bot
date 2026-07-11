-- Promote the in-session group-recitation page allocator out of the JSONB blob
-- into a real column, and add an atomic allocator function.
--
-- Why: `groupRecitationStartPage` lived in metadata.session_blob and was
-- read-modify-written in JS on every "present" click. Under the serverless
-- webhook (one invocation per update) two near-simultaneous self-registrations
-- could both read the same value and get assigned the same page. A column with
-- an atomic UPDATE ... RETURNING serializes the increment in the database.
--
-- Registered in schema_migrations because the backfill is NOT re-runnable:
-- once the app has allocated pages atomically, the column has advanced past the
-- (now stale) blob seed, so re-running the backfill would reset it backwards.

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
    where version = '20260711_004_add_group_recitation_page_counter'
  ) then
    alter table sessions
      add column if not exists group_recitation_next_page integer not null default 1;

    alter table sessions
      drop constraint if exists sessions_group_recitation_next_page_check;
    alter table sessions
      add constraint sessions_group_recitation_next_page_check
      check (group_recitation_next_page > 0);

    -- Backfill from the existing blob value so in-flight group-recitation
    -- sessions keep their current allocator position.
    update sessions
       set group_recitation_next_page =
             greatest(1, coalesce((metadata->'session_blob'->>'groupRecitationStartPage')::int, 1))
     where session_type = 'groupRecitation';

    insert into schema_migrations (version)
    values ('20260711_004_add_group_recitation_page_counter');
  end if;
end $$;

-- Atomically hand out the current page and advance the counter in one locked
-- UPDATE. Returns the page just allocated. `create or replace` is safe to run
-- repeatedly, so it stays outside the run-once guard.
create or replace function allocate_group_recitation_page(p_session_id uuid)
returns integer
language sql
as $$
  update sessions
     set group_recitation_next_page = group_recitation_next_page + 1
   where id = p_session_id
   returning group_recitation_next_page - 1;
$$;

commit;
