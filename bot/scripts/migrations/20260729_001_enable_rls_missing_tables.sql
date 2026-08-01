-- Enable row level security on application tables that were created after the
-- original RLS baseline and never had RLS turned on. The Supabase advisor flags
-- any table in the PostgREST-exposed `public` schema without RLS enabled.
--
-- The bot uses SUPABASE_SERVICE_ROLE_KEY on the server, which bypasses RLS, so
-- no anon/authenticated policies are defined — enabling RLS with no policies
-- denies all access to anon/authenticated roles, which is the intended lockdown.
--
-- Idempotent and tracked in schema_migrations. Fresh clones get the final shape
-- from scripts/supabase_v2.sql and never need to run this file.

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
    where version = '20260729_001_enable_rls_missing_tables'
  ) then
    alter table user_prefs enable row level security;
    alter table class_managers enable row level security;
    alter table class_material_files enable row level security;
    alter table homework_files enable row level security;
    alter table class_schedule enable row level security;

    insert into schema_migrations (version)
    values ('20260729_001_enable_rls_missing_tables');
  end if;
end $$;

commit;
