-- Delegation for offline classes: an owner can share a class with other users
-- so they can help manage it in their own DMs. The class owner stays
-- groups.owner_user_id; delegates live here with a per-person role.
--
-- Roles:
--   operator  = full operational access EXCEPT rename/delete the class and
--               managing managers (create sessions, edit attendance, roster,
--               teachers, assign session teacher, reports).
--   assistant = attendance editing in existing sessions + reports only.

create table if not exists class_managers (
  group_id bigint not null references groups(id) on delete cascade,
  user_id text not null,
  manager_role text not null default 'operator',
  display_name text,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id),
  check (manager_role in ('operator', 'assistant'))
);

-- List every class shared with a given delegate efficiently.
create index if not exists idx_class_managers_user_id
  on class_managers (user_id);

drop trigger if exists trg_class_managers_updated_at on class_managers;
create trigger trg_class_managers_updated_at
before update on class_managers
for each row execute function touch_updated_at();
