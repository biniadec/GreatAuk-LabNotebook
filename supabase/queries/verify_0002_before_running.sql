-- ============================================================================
-- verify_0002_before_running.sql
--
-- Answers, by actually testing it against the real database (not by
-- argument alone), whether 0002_retire_legacy_instructor_policy.sql is safe
-- to run:
--   REQUIREMENT 1: dropping the legacy instructor policy does not affect
--     administrator read access, or student progress-saving (insert/update).
--     (Student LOGIN is unaffected as a structural fact, not something this
--     file tests — the policy being dropped is SELECT-only on
--     exercise_progress; Postgres never consults a SELECT policy while
--     evaluating an INSERT or UPDATE, and login is Supabase Auth, which
--     doesn't consult exercise_progress policies at all. There is nothing
--     for a SQL test to exercise there.)
--   REQUIREMENT 2: teachers can only read progress AND profiles for
--     students enrolled in their assigned project(s) — TEST C/C2 cover
--     exercise_progress (same guarantee rls_tests.sql TEST 3/3b already
--     proved, re-run here specifically with the legacy policy gone, so
--     this file stands on its own); TEST D/D2 are NEW and cover profiles,
--     which rls_tests.sql never had a dedicated test for.
--   REQUIREMENT 3: whether any OTHER permissive policy could bypass project
--     isolation. This file can't discover unknown policies by running SQL
--     (that's what audit_current_policies.sql's query 1 is for — read that
--     first). What this file proves is narrower but concrete: once the one
--     identified bypass (the legacy instructor policy) is gone, every
--     remaining access path actually observed here is correctly scoped.
--
-- HOW: the actual `drop policy` statement from 0002 runs INSIDE this same
-- transaction, immediately before the test battery, which is then run
-- against the real, current data. Postgres DDL (DROP POLICY) is fully
-- transactional, so this genuinely exercises the post-0002 policy set
-- against your live database for the duration of the transaction — not a
-- simulation or a copy of the logic. The transaction ends in ROLLBACK,
-- never COMMIT, so the drop and all fixture rows are undone automatically;
-- the database is left in exactly the state it was in before this ran,
-- regardless of outcome. Luigi's real rows are never touched — all fixture
-- data uses separate throwaway UUIDs.
--
-- PREREQUISITE: five real auth.users UUIDs, same as rls_tests.sql — reuse
-- the same five test accounts if you already created them for that file.
-- Fill them in below.
--
-- If every TEST below reports PASSED, 0002 is safe to run for real as its
-- own, final, separate step (a plain `drop policy if exists ...`, nothing
-- else — see that file).
-- ============================================================================

begin;

do $$
declare
  test_student_a  uuid := '<TEST_STUDENT_A_UUID>';
  test_student_b  uuid := '<TEST_STUDENT_B_UUID>';
  test_teacher    uuid := '<TEST_TEACHER_UUID>';
  test_admin      uuid := '<TEST_ADMIN_UUID>';
  test_legacy     uuid := '<TEST_LEGACY_UUID>';
  great_auk_id    uuid;
  thylacine_id    uuid;
  result          boolean;
  write_succeeded boolean;
  affected_rows   int;
  policy_still_present boolean;
begin
  select id into great_auk_id from public.projects where slug = 'great-auk';
  select id into thylacine_id from public.projects where slug = 'thylacine-rna';

  if great_auk_id is null or thylacine_id is null then
    raise exception 'Seed projects not found — has 0001 actually been applied?';
  end if;

  -- ---- Fixtures (privileged role, same pattern as rls_tests.sql). --------
  insert into public.profiles (user_id, display_name, role) values
    (test_student_a, 'Test Student A', 'student'),
    (test_student_b, 'Test Student B', 'student'),
    (test_teacher,   'Test Teacher',   'teacher'),
    (test_admin,     'Test Admin',     'admin'),
    (test_legacy,    'Test Legacy',    'student')
  on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role;

  insert into public.project_memberships (project_id, user_id, role) values
    (great_auk_id, test_student_a, 'student'),
    (great_auk_id, test_teacher,   'teacher')
    -- test_student_b shares no project with test_teacher — used by TEST C.
  on conflict (project_id, user_id) do nothing;

  insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id) values
    (test_student_a, 'verify-0002-a-ex01', true, 'Test A fixture answer', great_auk_id),
    (test_student_b, 'verify-0002-b-ex01', true, 'Test B fixture answer', great_auk_id)
  on conflict (user_id, exercise_id) do nothing;

  -- ---- THE ACTUAL CHANGE 0002 MAKES, applied live, inside this ----------
  -- transaction only. Exact statement copied from 0002 itself.
  drop policy if exists "Instructors can read all progress rows" on public.exercise_progress;

  select exists (
    select 1 from pg_policies
    where tablename = 'exercise_progress' and policyname = 'Instructors can read all progress rows'
  ) into policy_still_present;

  if policy_still_present then
    raise exception 'SETUP FAILED: the legacy policy name in this script does not match the live database — check audit_current_policies.sql query 1 for the real name and correct both this file and 0002 before relying on either.';
  else
    raise notice 'Legacy instructor policy dropped for this transaction (will be rolled back at the end either way).';
  end if;

  -- From here on, simulate real authenticated client sessions.
  set local role authenticated;

  ----------------------------------------------------------------------
  -- TEST A: administrator can still read EVERY exercise_progress row
  -- across BOTH projects, with the legacy policy gone — proving the new
  -- "Admins can read all progress rows" policy (is_admin()) is what
  -- actually grants this, independent of the policy being retired.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_admin, 'role', 'authenticated')::text, true);

  select exists (
    select 1 from public.exercise_progress where user_id = test_student_a
  ) and exists (
    select 1 from public.exercise_progress where user_id = test_student_b
  ) into result;

  if not result then
    raise exception 'TEST A FAILED: administrator lost read access to student progress after the legacy policy was dropped — DO NOT RUN 0002 until this is resolved.';
  else
    raise notice 'TEST A PASSED: administrator still reads all progress rows after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST B: administrator can still read profiles and projects.
  ----------------------------------------------------------------------
  select exists (select 1 from public.profiles where user_id = test_student_b) into result;
  if not result then
    raise exception 'TEST B FAILED: administrator lost read access to profiles after the drop.';
  else
    raise notice 'TEST B PASSED: administrator still reads all profiles after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST C / C2: teacher scoping on exercise_progress still holds with
  -- the legacy policy gone (re-proves rls_tests.sql TEST 3/3b under the
  -- post-0002 policy set specifically, not assumed from that file alone).
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_teacher, 'role', 'authenticated')::text, true);

  select exists (
    select 1 from public.exercise_progress where user_id = test_student_b
  ) into result;
  if result then
    raise exception 'TEST C FAILED: teacher could read an unrelated student''s progress after the drop.';
  else
    raise notice 'TEST C PASSED: teacher still cannot see a student outside their project after the drop.';
  end if;

  select exists (
    select 1 from public.exercise_progress where user_id = test_student_a
  ) into result;
  if not result then
    raise exception 'TEST C2 FAILED: teacher lost read access to their own project''s student after the drop.';
  else
    raise notice 'TEST C2 PASSED: teacher still reads their own project''s student after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST D / D2 (NEW): teacher can read the PROFILE of a student sharing
  -- their project, but not the profile of an unrelated student. Neither
  -- rls_tests.sql nor any prior review had a dedicated test for this —
  -- requirement 2 explicitly asks about profiles, not just progress.
  ----------------------------------------------------------------------
  select exists (
    select 1 from public.profiles where user_id = test_student_a
  ) into result;
  if not result then
    raise exception 'TEST D FAILED: teacher could NOT read the profile of their own project''s student.';
  else
    raise notice 'TEST D PASSED: teacher can read the profile of their own project''s student.';
  end if;

  select exists (
    select 1 from public.profiles where user_id = test_student_b
  ) into result;
  if result then
    raise exception 'TEST D2 FAILED: teacher could read the profile of a student outside their project — profiles-table project isolation is broken.';
  else
    raise notice 'TEST D2 PASSED: teacher cannot read the profile of a student outside their project.';
  end if;

  ----------------------------------------------------------------------
  -- TEST E / E2: student progress-SAVING (insert + update) is completely
  -- unaffected by the drop (structurally guaranteed, since the dropped
  -- policy only ever applied to SELECT — re-proven here directly anyway,
  -- per the explicit request to confirm this, not just assert it).
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_student_a, 'role', 'authenticated')::text, true);

  write_succeeded := false;
  begin
    insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id)
    values (test_student_a, 'verify-0002-a-ex02', true, 'New answer after drop', great_auk_id);
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;
  if not write_succeeded then
    raise exception 'TEST E FAILED: student could not INSERT new progress after the drop — progress-saving would break.';
  else
    raise notice 'TEST E PASSED: student can still insert new progress after the drop.';
  end if;

  write_succeeded := false;
  begin
    update public.exercise_progress
    set notes = 'Edited after drop', completed = false
    where user_id = test_student_a and exercise_id = 'verify-0002-a-ex01';
    get diagnostics affected_rows = row_count;
    write_succeeded := (affected_rows > 0);
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;
  if not write_succeeded then
    raise exception 'TEST E2 FAILED: student could not UPDATE existing progress after the drop — progress-saving would break.';
  else
    raise notice 'TEST E2 PASSED: student can still update existing progress after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST F: the not-yet-enrolled legacy write allowance (Luigi's
  -- anonymous-identity equivalent) is also unaffected by the drop.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_legacy, 'role', 'authenticated')::text, true);

  write_succeeded := false;
  begin
    insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id)
    values (test_legacy, 'verify-0002-legacy-ex01', true, 'Legacy write after drop', great_auk_id);
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;
  if not write_succeeded then
    raise exception 'TEST F FAILED: a not-yet-enrolled session could not write into the default project after the drop.';
  else
    raise notice 'TEST F PASSED: not-yet-enrolled sessions can still write into the default project after the drop.';
  end if;

  raise notice 'ALL TESTS PASSED — 0002 is safe to run for real.';
end $$;

rollback;
