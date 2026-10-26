-- ============================================================================
-- setup_luigi_profile_membership.sql
--
-- Run AFTER:
--   1. migrations/0001_multi_user_platform.sql has been applied, AND
--   2. Luigi's new permanent Supabase Auth account has been created via the
--      Dashboard (Authentication > Users > Add user — same method already
--      used for the instructor account; email/password, not SQL, since
--      auth.users is managed by Supabase Auth itself).
--
-- Replace every '<NEW_LUIGI_USER_ID>' below with his new account's UUID
-- (visible in the Dashboard's Users list right after creating it) before
-- running.
--
-- The auto-provisioning trigger added in 0001 already created a default
-- profiles row for this new account the moment it was created (display_name
-- 'New user', role 'student') — this script just sets his real name and
-- enrolls him in the Great Auk project. It does not touch exercise_progress.
-- ============================================================================

update public.profiles
set display_name = 'Luigi'
where user_id = '<NEW_LUIGI_USER_ID>'::uuid;

insert into public.project_memberships (project_id, user_id, role)
values (
  (select id from public.projects where slug = 'great-auk'),
  '<NEW_LUIGI_USER_ID>'::uuid,
  'student'
)
on conflict (project_id, user_id) do nothing;

-- Sanity check: confirm both rows now exist as expected.
select * from public.profiles where user_id = '<NEW_LUIGI_USER_ID>'::uuid;
select * from public.project_memberships where user_id = '<NEW_LUIGI_USER_ID>'::uuid;
