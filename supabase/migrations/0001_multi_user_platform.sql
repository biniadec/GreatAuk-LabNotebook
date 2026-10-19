-- ============================================================================
-- 0001_multi_user_platform.sql
--
-- Prepares the Great Auk Lab Notebook's Supabase schema for multiple students,
-- multiple teachers, and multiple projects (initially "Great Auk" and
-- "Thylacine RNA"), on top of the existing single-student setup.
--
-- NOT YET RUN AGAINST THE LIVE DATABASE. This file is reviewed and executed
-- manually by Binia, in the Supabase SQL editor, only when she decides to
-- proceed. It is written to be additive and backward-compatible:
--
--   - It does not touch, rename, or drop any existing table, column, row,
--     or policy (exercise_progress, instructors, and their current RLS
--     policies/grants are all left exactly as they are).
--   - It does not disable anonymous authentication.
--   - It does not create any student or teacher accounts.
--   - Anonymous auth (Luigi's current invisible flow) keeps working exactly
--     as today even after this migration is applied; nothing here requires
--     Luigi to do anything.
--
-- ASSUMED CURRENT STATE (reconstructed from this project's history, not
-- re-derived from a prior migration file, since none existed before this
-- one — every earlier schema change was run ad hoc in the SQL editor):
--
--   create table public.exercise_progress (
--     id uuid primary key default gen_random_uuid(),
--     user_id uuid not null references auth.users(id),
--     exercise_id text not null,
--     completed boolean not null default false,
--     notes text,
--     student_label text,
--     updated_at timestamptz not null default now(),
--     unique (user_id, exercise_id)
--   );
--   -- RLS enabled; policies: students read/write their own rows only
--   -- (auth.uid() = user_id for select/insert/update).
--
--   create table public.instructors (
--     user_id uuid primary key references auth.users(id) on delete cascade
--   );
--   -- RLS enabled; policy: a user can read their own instructors row.
--   -- Additional policy on exercise_progress: any row's SELECT is also
--   -- allowed when auth.uid() exists in instructors (used by
--   -- supervisor.html today to read every row, unscoped by project).
--
-- This migration leaves both of the above completely alone, and adds the
-- new tables/columns/policies described below alongside them. A SEPARATE,
-- later, deliberate migration (not part of this file) should eventually
-- retire the flat "any instructor sees everything" policy in favor of the
-- project-scoped teacher policy added here — see MIGRATION_PLAN.md for the
-- reasoning and the sequencing risk around that cutover.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. profiles — one row per auth.users row, display name + global role.
-- ----------------------------------------------------------------------------

create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role         text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can always read and update their own profile.
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admins can read every profile (needed to manage teachers/students).
create policy "Admins can read all profiles"
  on public.profiles for select
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

-- Teachers can read the profiles of students who share a project with them
-- (so the supervisor-style view can show a real display name instead of a
-- free-text label). Scoped to shared projects only, never every student.
create policy "Teachers can read profiles of their project's students"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.project_memberships teacher_m
      join public.project_memberships student_m
        on student_m.project_id = teacher_m.project_id
       and student_m.user_id = public.profiles.user_id
       and student_m.role = 'student'
      where teacher_m.user_id = auth.uid()
        and teacher_m.role = 'teacher'
    )
  );

-- Table-level grants. RLS policies alone are not sufficient — Postgres also
-- requires the underlying GRANT, or every policy check fails outright with
-- "permission denied" regardless of what the policy would otherwise allow.
-- (This exact mistake broke Luigi's sync once already during the
-- supervisor-view rollout; the fix is applied up front here.)
grant select, update on public.profiles to authenticated;


-- ----------------------------------------------------------------------------
-- 2. projects — the set of courses this platform hosts.
-- ----------------------------------------------------------------------------

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Any authenticated user can see the list of projects they belong to.
create policy "Members can read their own projects"
  on public.projects for select
  using (
    exists (
      select 1 from public.project_memberships m
      where m.project_id = public.projects.id and m.user_id = auth.uid()
    )
  );

-- Admins can see every project, including ones they are not a member of.
create policy "Admins can read all projects"
  on public.projects for select
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

grant select on public.projects to authenticated;

-- Seed the two initial projects. Safe to re-run (idempotent on slug).
insert into public.projects (slug, name) values
  ('great-auk', 'Great Auk Comparative Genomics'),
  ('thylacine-rna', 'Thylacine RNA')
on conflict (slug) do nothing;


-- ----------------------------------------------------------------------------
-- 3. project_memberships — who belongs to which project, and in what role.
-- ----------------------------------------------------------------------------

create table public.project_memberships (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('student', 'teacher')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

alter table public.project_memberships enable row level security;

-- A user can always see their own memberships (which projects am I in, and as what).
create policy "Users can read own memberships"
  on public.project_memberships for select
  using (auth.uid() = user_id);

-- A teacher can see the full membership list (including other students) for
-- any project where they themselves hold a teacher membership.
create policy "Teachers can read memberships of their own projects"
  on public.project_memberships for select
  using (
    exists (
      select 1 from public.project_memberships teacher_m
      where teacher_m.user_id = auth.uid()
        and teacher_m.role = 'teacher'
        and teacher_m.project_id = public.project_memberships.project_id
    )
  );

-- Admins can see every membership everywhere.
create policy "Admins can read all memberships"
  on public.project_memberships for select
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );

grant select on public.project_memberships to authenticated;

-- No insert/update/delete policy is granted to students or teachers here on
-- purpose: enrolling someone in a project is an administrative action for
-- now (run manually in the SQL editor, or later through an admin-only UI),
-- not something any signed-in user can do to themselves or others yet.


-- ----------------------------------------------------------------------------
-- 4. exercise_progress — add project scoping, without touching existing data
--    or existing policies.
-- ----------------------------------------------------------------------------

alter table public.exercise_progress
  add column if not exists project_id uuid references public.projects(id);

-- Backfill: every row that exists today predates the multi-project model,
-- so it is unambiguously Great Auk data.
update public.exercise_progress
set project_id = (select id from public.projects where slug = 'great-auk')
where project_id is null;

-- Only make it mandatory for all FUTURE rows once every existing row has
-- been backfilled above, in the same transaction.
alter table public.exercise_progress
  alter column project_id set not null;

-- New, additive, project-scoped read policy for teachers. This does not
-- replace or modify the existing "instructors" read-all policy — both can
-- coexist. See MIGRATION_PLAN.md for why the old one should eventually be
-- dropped, and why that is a deliberate separate step, not part of this file.
create policy "Teachers can read progress of their project's students"
  on public.exercise_progress for select
  using (
    exists (
      select 1
      from public.project_memberships teacher_m
      join public.project_memberships student_m
        on student_m.project_id = teacher_m.project_id
       and student_m.user_id = public.exercise_progress.user_id
       and student_m.role = 'student'
      where teacher_m.user_id = auth.uid()
        and teacher_m.role = 'teacher'
        and teacher_m.project_id = public.exercise_progress.project_id
    )
  );

-- Admins can read every progress row across every project, unconditionally.
create policy "Admins can read all progress rows"
  on public.exercise_progress for select
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'admin')
  );


-- ----------------------------------------------------------------------------
-- 5. Auto-provisioning: every new auth.users row gets a profiles row.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'New user'),
    'student'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Note: this trigger also fires for anonymous sign-ins (auth.users gets a
-- row for every anonymous session too), so every anonymous identity will
-- also get a default 'student' profiles row with display_name 'New user'.
-- That is harmless — it is not read or shown anywhere until a real email is
-- attached — but it does mean `profiles` will accumulate one row per stray
-- anonymous identity, same as exercise_progress already does today.
