-- ============================================================================
-- setup_test_teacher_thylacine.sql
--
-- Configures the existing "Test Teacher" throwaway account
-- (6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d) as a real teacher of Thylacine RNA
-- ONLY, for a genuine real-browser login test before inviting Emilio.
--
-- This UUID was used once before, transiently, inside
-- verify_0002_before_running.sql's rolled-back transaction (as a Great Auk
-- teacher fixture) — that entire transaction ended in ROLLBACK, so nothing
-- from that run persisted. This script is a separate, real (committed)
-- setup, assigning it to Thylacine RNA specifically this time, which is
-- what the real browser test is for.
--
-- Run AFTER confirming this account already exists in auth.users (it does,
-- per the earlier round — no new Auth account needed here, just
-- profiles/project_memberships rows).
--
-- Does not touch Luigi's account, profile, memberships, or progress in any
-- way. Does not touch your administrator account. Does not touch
-- exercise_progress at all.
-- ============================================================================

-- ---- 1. Set this account's profile role to 'teacher' ----------------------
update public.profiles
set display_name = 'Test Teacher', role = 'teacher'
where user_id = '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid;

-- ---- 2. Enrol it exclusively in Thylacine RNA ------------------------------
insert into public.project_memberships (project_id, user_id, role)
values (
  (select id from public.projects where slug = 'thylacine-rna'),
  '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid,
  'teacher'
)
on conflict (project_id, user_id) do update set role = excluded.role;

-- If an earlier attempt ever left a Great Auk row on this account, this
-- removes it so the account is genuinely exclusive to Thylacine RNA before
-- the checks below run. Harmless no-op if no such row exists.
delete from public.project_memberships
where user_id = '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid
  and project_id = (select id from public.projects where slug = 'great-auk');


-- ============================================================================
-- Verification — run all four and read the results before logging in.
-- ============================================================================

-- CHECK 1: profile role is 'teacher' (not 'student', not 'admin').
-- Expect: one row, role = 'teacher', display_name = 'Test Teacher'.
select user_id, display_name, role
from public.profiles
where user_id = '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid;

-- CHECK 2: enrolled in Thylacine RNA as teacher.
-- Expect: exactly one row — slug 'thylacine-rna', role 'teacher'.
select p.slug, m.role
from public.project_memberships m
join public.projects p on p.id = m.project_id
where m.user_id = '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid;

-- CHECK 3: no Great Auk membership at all.
-- Expect: ZERO rows. Anything returned here means this account can still
-- see Great Auk data and the setup is not actually exclusive — stop and
-- investigate before logging in if so.
select 1
from public.project_memberships m
join public.projects p on p.id = m.project_id
where m.user_id = '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid
  and p.slug = 'great-auk';

-- CHECK 4: no administrator privileges.
-- Expect: TRUE. (role = 'teacher', confirmed again here as an explicit
-- boolean rather than eyeballing CHECK 1's output, so there's no ambiguity.)
select (role = 'teacher' and role <> 'admin') as is_teacher_not_admin
from public.profiles
where user_id = '6e8d145e-b0fc-46dd-b9b8-b6e0ff1fed2d'::uuid;
