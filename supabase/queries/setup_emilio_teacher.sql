-- ============================================================================
-- setup_emilio_teacher.sql
--
-- Enrolls Emilio as a teacher for the Thylacine RNA project ONLY — not
-- Great Auk, and not as an administrator. Same pattern as
-- setup_luigi_profile_membership.sql, adapted for a teacher role on a
-- different project.
--
-- Run AFTER:
--   1. Emilio's real Supabase Auth account has been created (Dashboard >
--      Authentication > Users > Invite user is the recommended method for
--      a real colleague — it emails him a link to set his own password,
--      rather than you choosing one for him. "Add user" with a temporary
--      password works too if you'd rather set one up yourself and hand it
--      to him directly. Either way, this is an Auth-level action, not SQL —
--      auth.users is managed by Supabase Auth itself, not this script.)
--
-- Replace every '<EMILIO_USER_ID>' below with his new account's UUID
-- (visible in the Dashboard's Users list right after creating it) before
-- running.
--
-- The auto-provisioning trigger added in 0001 already created a default
-- profiles row for this new account the moment it was created (display_name
-- 'New user' unless you supplied one at invite time, role 'student') — this
-- script sets his real name, promotes his role to 'teacher', and enrolls
-- him in Thylacine RNA specifically. It does not touch exercise_progress,
-- does not grant Great Auk access, and does not make him an administrator.
-- ============================================================================

update public.profiles
set display_name = 'Emilio', role = 'teacher'
where user_id = '<EMILIO_USER_ID>'::uuid;

insert into public.project_memberships (project_id, user_id, role)
values (
  (select id from public.projects where slug = 'thylacine-rna'),
  '<EMILIO_USER_ID>'::uuid,
  'teacher'
)
on conflict (project_id, user_id) do nothing;

-- ---- Verification -----------------------------------------------------

-- Expect: role = 'teacher', display_name = 'Emilio'.
select user_id, display_name, role from public.profiles where user_id = '<EMILIO_USER_ID>'::uuid;

-- Expect: exactly one row, project 'thylacine-rna', role 'teacher'.
select p.slug, m.role
from public.project_memberships m
join public.projects p on p.id = m.project_id
where m.user_id = '<EMILIO_USER_ID>'::uuid;

-- Confirms exclusivity: expect this to return ZERO rows. If it returns
-- anything, Emilio has Great Auk access he shouldn't have — fix before
-- considering this setup complete.
select 1
from public.project_memberships m
join public.projects p on p.id = m.project_id
where m.user_id = '<EMILIO_USER_ID>'::uuid
  and p.slug = 'great-auk';
