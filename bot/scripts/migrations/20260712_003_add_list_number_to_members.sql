-- Add list_number to members: the sequential roster number students use to
-- communicate with teachers (see scripts/tmp/original-list.txt). Nullable, and
-- unique per group among assigned (non-null) values so no two active roster
-- entries in the same group share a number.
--
-- Also installs a BEFORE INSERT trigger so future members auto-receive the next
-- sequential number for their group (unless one is supplied explicitly, e.g. the
-- backfill). The trigger only fires on INSERT, so existing rows are untouched.
--
-- Idempotent (`if not exists`) and tracked in schema_migrations. Run once in the
-- Supabase SQL editor, then backfill values with:
--   node scripts/tmp/backfill-list-number.mjs --group 252 --apply

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
    where version = '20260712_003_add_list_number_to_members'
  ) then
    alter table members
      add column if not exists list_number integer;

    -- Unique per group among assigned numbers (nulls are allowed to repeat).
    create unique index if not exists uq_members_group_list_number
      on members (group_id, list_number)
      where list_number is not null;

    insert into schema_migrations (version)
    values ('20260712_003_add_list_number_to_members');
  end if;
end $$;

-- Auto-assign the next per-group list_number on insert. Idempotent DDL, so it is
-- safe to re-run even if the guarded block above was already applied.
create or replace function assign_member_list_number()
returns trigger as $$
begin
  if new.list_number is null then
    -- Serialize concurrent inserts for the same group so two rows can't read the
    -- same max() and compute the same next number. Keyed on group_id; released
    -- automatically at transaction end. Different groups use different keys and
    -- do not block each other.
    perform pg_advisory_xact_lock(new.group_id);

    select coalesce(max(list_number), 0) + 1
      into new.list_number
      from members
      where group_id = new.group_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_assign_member_list_number on members;
create trigger trg_assign_member_list_number
  before insert on members
  for each row
  execute function assign_member_list_number();

commit;
