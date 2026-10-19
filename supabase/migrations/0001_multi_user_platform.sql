-- ============================================================================
-- 0001_multi_user_platform.sql
--
-- Prepares the Great Auk Lab Notebook's Supabase schema for multiple students,
-- multiple teachers, and multiple projects (initially "Great Auk" and
-- "Thylacine RNA"), on top of the existing single-student setup.
--
-- REVISION NOTE: this file was revised after a security review of the first
-- version flagged several real issues, all fixed here:
--   1. Recursive/self-referential RLS policies (profiles policies querying
--      profiles; project_memberships' teacher policy querying
--      project_memberships) replaced with SECURITY DEFINER helper functions
--      — see section 0 below.
--   2. The original "Users can update own profile" policy let a student set
--      their own role to 'admin'. Fixed with a column-level GRANT (see
--      section 1) so self-service updates can only ever touch display_name,
--      enforced independently of and prior to any RLS check.
--   3. The original NOT NULL project_id column had no default, which would
--      have broken every write from the still-unmodified live sync adapter
--      (it doesn't send project_id). Fixed with a SECURITY DEFINER default
--      function so legacy inserts keep working unchanged during the
--      transition (see section 4).
--
-- NOT YET RUN AGAINST THE LIVE DATABASE. This file is reviewed and executed
-- manually by Binia, in the Supabase SQL editor, only when she decides to
-- proceed. Run queries/audit_existing_schema.sql FIRST and reconcile its
-- output against the "ASSUMED CURRENT STATE" below before applying this.
-- It is written to be additive and backward-compatible:
--
--   - It does not touch, rename, or drop any existing table, column, row,
--     or policy (exercise_progress, instructors, and their current RLS
--     policies/grants are all left exactly as they are).
--   - It does not disable anonymous authentication.
--   - It does not create any student or teacher accounts.
--   - Anonymous auth (Luigi's current invisible flow) keeps working exactly
--     as today even after this migration is applied; nothing here requires
--     Luigi to do anything, and his existing writes keep succeeding even
--     before the app code is updated to send project_id explicitly.
--
-- ASSUMED CURRENT STATE (reconstructed from this project's history, not
-- re-derived from a prior migration file, since none existed before this
-- one — every earlier schema change was run ad hoc in the SQL editor).
-- CONFIRM THIS against queries/audit_existing_schema.sql's actual output
-- before relying on it:
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
-- later, deliberate migration (0002) retires the flat "any instructor sees
-- everything" policy in favor of the project-scoped teacher policy added
-- here — see MIGRATION_PLAN.md for the reasoning and the sequencing risk
-- around that cutover.
--
-- KNOWN DATA NOTE (found during this review, relevant to anyone reading
-- exercise_progress going forward): Luigi's 21 genuine Module 00 rows have
-- a NULL student_label — they predate the student_label column/field
-- entirely. Any logic (app code or SQL) that identifies "Luigi's rows" by
-- filtering student_label = 'Luigi' will silently miss them. This is a
-- real, currently-live gap in supervisor.js's merge logic on `main` today,
-- separate from this migration — flagged in MIGRATION_PLAN.md. The fix
-- planned here is to stop identifying students by student_label at all
-- once real accounts exist, and use user_id + project_memberships instead;
-- student_label is kept only as inert historical metadata.
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


-- ----------------------------------------------------------------------------
-- 0. Authorization helper functions — fixes recursive/self-referential RLS.
--
-- Why these exist: the first version of this migration had policies on
-- `profiles` that queried `profiles` from within their own USING clause,
-- and a policy on `project_memberships` that queried `project_memberships`
-- from within its own USING clause. Postgres does not infinite-loop on
-- this, but it is a well-documented anti-pattern: evaluating the policy
-- depends on a nested query against the SAME table, which is itself
-- subject to RLS, making correctness depend on other policies on that
-- table being exactly right, forever. The fix (and Supabase's own
-- documented recommendation for this exact situation) is to move the
-- lookup into a SECURITY DEFINER function, which runs with the function
-- owner's privileges and therefore bypasses the caller's RLS for this one,
-- narrow, read-only check — never for anything else.
--
-- Security properties applied to every function below:
--   - `security definer` so the internal lookup bypasses the caller's own
--     RLS (the entire point — without this, they would be exactly as
--     recursive/fragile as what they replace).
--   - `set search_path = public, pg_temp` on every one, which prevents a
--     classic SECURITY DEFINER vulnerability: without a pinned search_path,
--     a caller could create an object (e.g. a function or table) earlier
--     in their own search path that shadows an unqualified identifier
--     inside this function, and have THIS function's elevated privileges
--     execute attacker-controlled code. Every identifier inside these
--     functions is also schema-qualified (`public.profiles`, not just
--     `profiles`) as a second, redundant layer of the same protection.
--   - Ownership: these must be created by a role with full table access
--     (the default role when running SQL in the Supabase SQL editor,
--     typically the project's postgres/owner role) — that owner's
--     privileges are what the SECURITY DEFINER bypass actually grants.
--     Do not recreate these as a lower-privileged role, or the bypass
--     this exists for will not work.
--   - EXECUTE is revoked from `public` and granted only to `authenticated`
--     — never to `anon` (not used by this app; every real session here,
--     including anonymous sign-ins, carries role `authenticated`).
--   - The two lowest-level, single-fact checks (`is_admin`,
--     `_is_teacher_for_project`) only ever answer a question about the
--     CALLER (`auth.uid()`) — they take no "which user" argument, so there
--     is nothing to probe about anyone else by calling them directly.
--   - `_is_student_in_project`, which DOES answer a question about another,
--     specific user (needed for "is this OTHER user_id a student in a
--     project I teach"), is deliberately NOT granted EXECUTE to
--     `authenticated` at all. It is only ever called from inside the two
--     combined functions below it, which run with the SAME definer
--     privileges and so can call it internally regardless — but no client
--     session can invoke it directly to enumerate arbitrary users'
--     enrollment. Only the combined, already-authorization-scoped
--     functions (`is_teacher_of_student_in_project`,
--     `shares_any_project_as_teacher_student`) are exposed.
-- ----------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;


create or replace function public._is_teacher_for_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_memberships
    where user_id = auth.uid() and project_id = pid and role = 'teacher'
  );
$$;

revoke all on function public._is_teacher_for_project(uuid) from public;
grant execute on function public._is_teacher_for_project(uuid) to authenticated;


-- Deliberately NOT granted to authenticated — see the note above. Only
-- called from within the two functions below, under definer privileges.
create or replace function public._is_student_in_project(target_user uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_memberships
    where user_id = target_user and project_id = pid and role = 'student'
  );
$$;

revoke all on function public._is_student_in_project(uuid, uuid) from public;


create or replace function public.is_teacher_of_student_in_project(target_user uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._is_teacher_for_project(pid) and public._is_student_in_project(target_user, pid);
$$;

revoke all on function public.is_teacher_of_student_in_project(uuid, uuid) from public;
grant execute on function public.is_teacher_of_student_in_project(uuid, uuid) to authenticated;


create or replace function public.shares_any_project_as_teacher_student(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.project_memberships teacher_m
    join public.project_memberships student_m
      on student_m.project_id = teacher_m.project_id
     and student_m.user_id = target_user
     and student_m.role = 'student'
    where teacher_m.user_id = auth.uid()
      and teacher_m.role = 'teacher'
  );
$$;

revoke all on function public.shares_any_project_as_teacher_student(uuid) from public;
grant execute on function public.shares_any_project_as_teacher_student(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 1a. profiles policies and grants.
-- ----------------------------------------------------------------------------

-- A user can always read their own profile.
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

-- Admins can read every profile (needed to manage teachers/students).
create policy "Admins can read all profiles"
  on public.profiles for select
  using (public.is_admin());

-- Teachers can read the profiles of students who share a project with them
-- (so a teacher-facing view can show a real display name instead of a
-- free-text label). Scoped to shared projects only, never every student.
create policy "Teachers can read profiles of their project's students"
  on public.profiles for select
  using (public.shares_any_project_as_teacher_student(user_id));

-- Self-service update, row-scoped by RLS as before — but see the GRANT
-- below, which is what actually prevents privilege escalation. The
-- original version of this policy let a student run
-- `update profiles set role = 'admin' where user_id = auth.uid()`, since
-- USING/WITH CHECK only restrict WHICH ROW is touched, never WHICH COLUMN
-- or what value it's set to. Fixed at the correct layer: Postgres
-- column-level GRANTs are enforced independently of, and prior to, RLS —
-- there is no way to UPDATE a column you don't hold grant on, regardless
-- of what any policy allows. role changes are not self-service at all;
-- they're a manual `update profiles set role = '...' where user_id = '...'`
-- run directly by you in the SQL editor — a trusted, out-of-band mechanism,
-- not something exposed to any authenticated session.
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Table-level grants. RLS policies alone are not sufficient — Postgres also
-- requires the underlying GRANT, or every policy check fails outright with
-- "permission denied" regardless of what the policy would otherwise allow.
-- (This exact mistake broke Luigi's sync once already during the
-- supervisor-view rollout; the fix is applied up front here.)
--
-- Note the column list on UPDATE: this is the actual fix for the
-- privilege-escalation issue above. `authenticated` has no UPDATE grant on
-- `role` (or on `user_id`/`created_at`) at all — an UPDATE statement that
-- touches those columns is rejected outright by Postgres's privilege
-- system, before RLS is even evaluated, no matter what the policy's
-- USING/WITH CHECK would otherwise permit.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;


-- ----------------------------------------------------------------------------
-- 2a. projects policies and grants.
-- ----------------------------------------------------------------------------

-- Any authenticated user can see the list of projects they belong to. This
-- subqueries project_memberships directly rather than through a helper
-- function; it is not self-referential (projects querying
-- project_memberships, a different table), and the current user can always
-- see their own membership row via "Users can read own memberships" below,
-- so this resolves correctly without needing a SECURITY DEFINER bypass.
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
  using (public.is_admin());

grant select on public.projects to authenticated;

-- Seed the two initial projects. Safe to re-run (idempotent on slug).
insert into public.projects (slug, name) values
  ('great-auk', 'Great Auk Comparative Genomics'),
  ('thylacine-rna', 'Thylacine RNA')
on conflict (slug) do nothing;


-- ----------------------------------------------------------------------------
-- 3a. project_memberships policies and grants.
-- ----------------------------------------------------------------------------

-- A user can always see their own memberships (which projects am I in, and as what).
create policy "Users can read own memberships"
  on public.project_memberships for select
  using (auth.uid() = user_id);

-- A teacher can see the full membership list (including other students) for
-- any project where they themselves hold a teacher membership. Fixed to use
-- the helper function instead of a self-referential subquery against
-- project_memberships from within its own policy.
create policy "Teachers can read memberships of their own projects"
  on public.project_memberships for select
  using (public._is_teacher_for_project(project_id));

-- Admins can see every membership everywhere.
create policy "Admins can read all memberships"
  on public.project_memberships for select
  using (public.is_admin());

grant select on public.project_memberships to authenticated;

-- No insert/update/delete policy is granted to students or teachers here on
-- purpose: enrolling someone in a project is an administrative action for
-- now (run manually in the SQL editor), confirmed acceptable for the
-- initial rollout.


-- ----------------------------------------------------------------------------
-- 4. exercise_progress — add project scoping, without touching existing data
--    or existing policies, and WITHOUT breaking the live site's current
--    writes (which don't send project_id — see the default function below).
-- ----------------------------------------------------------------------------

-- Resolves the Great Auk project's id for legacy inserts that don't specify
-- project_id (i.e. every write the live site makes today, until
-- sync-adapter.js is updated to send it explicitly). SECURITY DEFINER is
-- required here too: without it, this default would be evaluated under the
-- INSERTing session's own privileges, and a session with no
-- project_memberships row yet (every current anonymous session, and every
-- brand-new account before enrollment) would see zero rows under the
-- "Members can read their own projects" policy, making the default resolve
-- to NULL and the NOT NULL constraint below fail — the opposite of what
-- this is for.
create or replace function public.default_great_auk_project_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.projects where slug = 'great-auk';
$$;

revoke all on function public.default_great_auk_project_id() from public;
grant execute on function public.default_great_auk_project_id() to authenticated;

alter table public.exercise_progress
  add column if not exists project_id uuid
    references public.projects(id)
    default public.default_great_auk_project_id();

-- Backfill: every row that exists today predates the multi-project model,
-- so it is unambiguously Great Auk data.
update public.exercise_progress
set project_id = (select id from public.projects where slug = 'great-auk')
where project_id is null;

-- Safe to make mandatory now that every existing row is backfilled AND
-- future legacy inserts (missing project_id) are covered by the default
-- above — this does not reintroduce the original backward-compatibility
-- break, because the column is no longer ever NULL by omission.
alter table public.exercise_progress
  alter column project_id set not null;

-- New, additive, project-scoped read policy for teachers. This does not
-- replace or modify the existing "instructors" read-all policy — both can
-- coexist. See MIGRATION_PLAN.md and 0002 for why the old one should
-- eventually be dropped, and why that is a deliberate separate step, not
-- part of this file.
create policy "Teachers can read progress of their project's students"
  on public.exercise_progress for select
  using (public.is_teacher_of_student_in_project(user_id, project_id));

-- Admins can read every progress row across every project, unconditionally.
create policy "Admins can read all progress rows"
  on public.exercise_progress for select
  using (public.is_admin());


-- ----------------------------------------------------------------------------
-- 5. Auto-provisioning: every new auth.users row gets a profiles row.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
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
