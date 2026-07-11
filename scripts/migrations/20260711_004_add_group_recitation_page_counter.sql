-- Promote the in-session group-recitation page allocator out of the JSONB blob
-- into a real column, and add an atomic allocator function.
--
-- Why: `groupRecitationStartPage` lived in metadata.session_blob and was
-- read-modify-written in JS on every "present" click. Under the serverless
-- webhook (one invocation per update) two near-simultaneous self-registrations
-- could both read the same value and get assigned the same page. A column with
-- an atomic UPDATE ... RETURNING serializes the increment in the database.

alter table sessions
  add column if not exists group_recitation_next_page integer not null default 1;

-- Backfill from the existing blob value so in-flight group-recitation sessions
-- keep their current allocator position.
update sessions
   set group_recitation_next_page =
         greatest(1, coalesce((metadata->'session_blob'->>'groupRecitationStartPage')::int, 1))
 where session_type = 'groupRecitation';

-- Atomically hand out the current page and advance the counter in one locked
-- UPDATE. Returns the page just allocated.
create or replace function allocate_group_recitation_page(p_session_id uuid)
returns integer
language sql
as $$
  update sessions
     set group_recitation_next_page = group_recitation_next_page + 1
   where id = p_session_id
   returning group_recitation_next_page - 1;
$$;
