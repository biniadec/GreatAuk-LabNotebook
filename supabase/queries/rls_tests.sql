-- ============================================================================
-- rls_tests.sql
--
-- Proves, directly against the real RLS policies (not by inspection or
-- argument), that:
--   TEST 1: a student cannot change their own role.
--   TEST 2: a student cannot read another student's progress.
--   TEST 3: a teacher cannot read a student outside their own project(s).
--   TEST 3b: (sanity check) a teacher CAN read their own project's student
--            — without this, TEST 3 passing could just mean the policy is
--            too strict / broken, not correctly scoped.
--   TEST 4: an admin can read a project they are not a member of.
--
-- SAFE TO RUN: everything happens inside one transaction that ends in
-- ROLLBACK (never COMMIT), so no permanent change is made to the database
-- regardless of outcome — all fixture rows (profiles/project_memberships/
-- exercise_progress) created for the test are undone automatically. Still,
-- this executes real statements against the live database for the duration
-- of the transaction, so run it deliberately, not as a reflex — not part of
-- "do not execute anything in Supabase yet" being satisfied by inaction;
-- it's satisfied by the rollback leaving nothing behind. Review before
-- running.
--
-- PREREQUISITE: run this only after 0001 (with the helper-function/
-- column-grant fixes) has actually been applied — it tests the real,
-- applied policies, not this file's own copy of their logic.
--
-- PREREQUISITE: four real auth.users UUIDs. profiles/project_memberships/
-- exercise_progress all foreign-key to auth.users(id), so these can't be
-- fully synthetic. Easiest: create four throwaway accounts via Dashboard >
-- Authentication > Users > Add user (e.g. test-student-a@…,
-- test-student-b@…, test-teacher@…, test-admin@…), note their UUIDs, fill
-- them in below. Delete those Dashboard users afterward if you don't want
-- them lingering — nothing this script itself writes needs that cleanup,
-- since it all rolls back, but the auth.users rows themselves are outside
-- this transaction's control.
-- ============================================================================

begin;

do $$
declare
  test_student_a uuid := '<TEST_STUDENT_A_UUID>';
  test_student_b uuid := '<TEST_STUDENT_B_UUID>';
  test_teacher   uuid := '<TEST_TEACHER_UUID>';
  test_admin     uuid := '<TEST_ADMIN_UUID>';
  great_auk_id   uuid;
  thylacine_id   uuid;
  result         boolean;
begin
  select id into great_auk_id from public.projects where slug = 'great-auk';
  select id into thylacine_id from public.projects where slug = 'thylacine-rna';

  if great_auk_id is null or thylacine_id is null then
    raise exception 'Seed projects not found — has 0001 actually been applied?';
  end if;

  -- ---- Fixtures (as the privileged role the SQL editor runs as; this is
  -- BEFORE switching to `authenticated` below, since the policies being
  -- tested would otherwise block this very setup, e.g. project_memberships
  -- has no insert policy for authenticated at all).
  insert into public.profiles (user_id, display_name, role) values
    (test_student_a, 'Test Student A', 'student'),
    (test_student_b, 'Test Student B', 'student'),
    (test_teacher,   'Test Teacher',   'teacher'),
    (test_admin,     'Test Admin',     'admin')
  on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role;

  insert into public.project_memberships (project_id, user_id, role) values
    (great_auk_id, test_student_a, 'student'),
    (great_auk_id, test_teacher,   'teacher')
    -- test_student_b and test_teacher are deliberately NOT both in
    -- thylacine_id together, and test_student_b shares no project with
    -- test_teacher at all — this is what TEST 3 relies on.
  on conflict (project_id, user_id) do nothing;

  insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id) values
    (test_student_a, 'rls-test-a-ex01', true, 'Test A fixture answer', great_auk_id),
    (test_student_b, 'rls-test-b-ex01', true, 'Test B fixture answer', great_auk_id)
  on conflict (user_id, exercise_id) do nothing;

  -- From here on, simulate real authenticated client sessions: switch the
  -- actual Postgres role (required for GRANT-level restrictions, like the
  -- profiles column grant, to actually apply — the SQL editor's default
  -- role bypasses RLS and grants entirely, which would make every test
  -- below meaningless if skipped) and set the JWT claims auth.uid() reads.
  set local role authenticated;

  ----------------------------------------------------------------------
  -- TEST 1: a student cannot change their own role.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_student_a, 'role', 'authenticated')::text, true);

  begin
    update public.profiles set role = 'admin' where user_id = test_student_a;
    raise exception 'TEST 1 FAILED: student was able to update profiles.role';
  exception
    when insufficient_privilege then
      raise notice 'TEST 1 PASSED: student cannot update profiles.role (insufficient_privilege)';
  end;

  ----------------------------------------------------------------------
  -- TEST 2: a student cannot read another student's progress.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_student_a, 'role', 'authenticated')::text, true);

  select exists (
    select 1 from public.exercise_progress where user_id = test_student_b
  ) into result;

  if result then
    raise exception 'TEST 2 FAILED: student A could read student B''s progress row(s)';
  else
    raise notice 'TEST 2 PASSED: student A cannot see student B''s progress';
  end if;

  ----------------------------------------------------------------------
  -- TEST 3 / 3b: a teacher cannot read a student outside their own
  -- project, but CAN read a student within it.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_teacher, 'role', 'authenticated')::text, true);

  select exists (
    select 1 from public.exercise_progress where user_id = test_student_b
  ) into result;

  if result then
    raise exception 'TEST 3 FAILED: teacher could read an unrelated student''s progress';
  else
    raise notice 'TEST 3 PASSED: teacher cannot see a student outside their project';
  end if;

  select exists (
    select 1 from public.exercise_progress where user_id = test_student_a
  ) into result;

  if not result then
    raise exception 'TEST 3b FAILED: teacher could NOT read their own enrolled student''s progress (policy too strict / broken)';
  else
    raise notice 'TEST 3b PASSED: teacher can see their own project''s student';
  end if;

  ----------------------------------------------------------------------
  -- TEST 4: an admin can read a project they are not a member of.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_admin, 'role', 'authenticated')::text, true);

  select exists (
    select 1 from public.projects where slug = 'thylacine-rna'
  ) into result;

  if not result then
    raise exception 'TEST 4 FAILED: admin could not read a project they are not a member of';
  else
    raise notice 'TEST 4 PASSED: admin can read all projects';
  end if;

  raise notice 'ALL TESTS PASSED';
end $$;

rollback;
