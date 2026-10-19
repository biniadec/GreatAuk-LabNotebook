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
--   TEST 5: a not-yet-enrolled ("legacy") session — no project_memberships
--           row at all, same as Luigi's current anonymous identity — CAN
--           still insert progress into the default Great Auk project.
--   TEST 6: that same legacy session CANNOT insert progress into a
--           different (non-default) project — the legacy allowance is
--           scoped to the default project only, not a blanket bypass.
--   TEST 7: an enrolled student CANNOT insert progress for a project they
--           aren't a member of, even though it's a real project.
--   TEST 7b: (sanity check) that same enrolled student CAN update their own
--            progress within their own enrolled project — without this,
--            TEST 7 passing could mean the write policy is too strict.
--   TEST 8: an enrolled student CANNOT change an EXISTING record's
--           project_id to move it into a project they aren't a member of
--           (distinct from TEST 7: this targets UPDATE on a row that
--           already passes the policy's USING clause, specifically
--           exercising WITH CHECK rather than row visibility).
--
-- ON EXCEPTION HANDLING (reviewed specifically for this): Postgres treats
-- an UPDATE whose row fails a RESTRICTIVE policy's USING clause silently —
-- the row just doesn't match, zero rows affected, no error. It's only when
-- a row DOES pass USING but then fails WITH CHECK (exactly TEST 8's case),
-- or when WITH CHECK fails on a fresh INSERT (TEST 6/7, where there's no
-- USING clause to filter through in the first place), that Postgres raises
-- a loud `insufficient_privilege` error. Every "should fail" test below
-- still does NOT rely on that distinction alone, or on an exception being
-- raised at all — each one independently re-queries the actual data
-- afterward to confirm the forbidden write didn't persist, regardless of
-- whether catching `insufficient_privilege` worked as expected. This means
-- a test here still correctly fails (never silently reports PASSED) even
-- if some future Postgres/Supabase behavior change means a blocked write
-- raises a different SQLSTATE, or raises nothing at all.
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
-- column-grant/write-enforcement fixes) has actually been applied — it
-- tests the real, applied policies, not this file's own copy of their
-- logic.
--
-- PREREQUISITE: five real auth.users UUIDs. profiles/project_memberships/
-- exercise_progress all foreign-key to auth.users(id), so these can't be
-- fully synthetic. Easiest: create five throwaway accounts via Dashboard >
-- Authentication > Users > Add user (e.g. test-student-a@…,
-- test-student-b@…, test-teacher@…, test-admin@…, test-legacy@…), note
-- their UUIDs, fill them in below. Delete those Dashboard users afterward
-- if you don't want them lingering — nothing this script itself writes
-- needs that cleanup, since it all rolls back, but the auth.users rows
-- themselves are outside this transaction's control.
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
    (test_admin,     'Test Admin',     'admin'),
    (test_legacy,    'Test Legacy',    'student')
    -- test_legacy deliberately gets a profiles row (exactly as the real
    -- auto-provisioning trigger would give any new signup) but NO
    -- project_memberships row below — this is what makes it stand in for
    -- Luigi's current, not-yet-enrolled anonymous identity in TEST 5/6.
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

  write_succeeded := false;
  begin
    update public.profiles set role = 'admin' where user_id = test_student_a;
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;

  select (role = 'admin') into result from public.profiles where user_id = test_student_a;

  if write_succeeded or result then
    raise exception 'TEST 1 FAILED: student was able to change profiles.role to admin';
  else
    raise notice 'TEST 1 PASSED: student cannot change profiles.role';
  end if;

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

  ----------------------------------------------------------------------
  -- TEST 5: a not-yet-enrolled ("legacy") session CAN still insert
  -- progress into the default Great Auk project — proves Luigi's current
  -- anonymous writes keep working after this migration.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_legacy, 'role', 'authenticated')::text, true);

  write_succeeded := false;
  begin
    insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id)
    values (test_legacy, 'rls-test-legacy-ex01', true, 'Legacy fixture answer', great_auk_id);
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;

  select exists (
    select 1 from public.exercise_progress
    where user_id = test_legacy and exercise_id = 'rls-test-legacy-ex01' and project_id = great_auk_id
  ) into result;

  if not (write_succeeded and result) then
    raise exception 'TEST 5 FAILED: legacy session could not write into the default project — this would break Luigi''s current anonymous saving';
  else
    raise notice 'TEST 5 PASSED: legacy (unenrolled) session can write into the default project';
  end if;

  ----------------------------------------------------------------------
  -- TEST 6: that same legacy session CANNOT insert progress into a
  -- different, non-default project — the legacy allowance is scoped to
  -- the default project only, not a blanket bypass of the new check.
  ----------------------------------------------------------------------
  write_succeeded := false;
  begin
    insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id)
    values (test_legacy, 'rls-test-legacy-ex02', true, 'Should not be allowed', thylacine_id);
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;

  select exists (
    select 1 from public.exercise_progress
    where user_id = test_legacy and exercise_id = 'rls-test-legacy-ex02'
  ) into result;

  if write_succeeded or result then
    raise exception 'TEST 6 FAILED: legacy session was able to write into a non-default project';
  else
    raise notice 'TEST 6 PASSED: legacy session cannot write into a non-default project';
  end if;

  ----------------------------------------------------------------------
  -- TEST 7 / 7b: an enrolled student cannot write progress for a project
  -- they aren't a member of, but CAN write within their own project.
  -- test_student_a is enrolled in great_auk_id only (see fixtures above).
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_student_a, 'role', 'authenticated')::text, true);

  write_succeeded := false;
  begin
    insert into public.exercise_progress (user_id, exercise_id, completed, notes, project_id)
    values (test_student_a, 'rls-test-a-ex02', true, 'Should not be allowed', thylacine_id);
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;

  select exists (
    select 1 from public.exercise_progress
    where user_id = test_student_a and exercise_id = 'rls-test-a-ex02'
  ) into result;

  if write_succeeded or result then
    raise exception 'TEST 7 FAILED: enrolled student was able to write progress for a project they are not a member of';
  else
    raise notice 'TEST 7 PASSED: enrolled student cannot write progress for an unrelated project';
  end if;

  update public.exercise_progress
  set notes = 'Updated within own enrolled project'
  where user_id = test_student_a and exercise_id = 'rls-test-a-ex01';

  select exists (
    select 1 from public.exercise_progress
    where user_id = test_student_a and exercise_id = 'rls-test-a-ex01'
      and notes = 'Updated within own enrolled project'
  ) into result;

  if not result then
    raise exception 'TEST 7b FAILED: enrolled student could NOT update their own progress within their own enrolled project (policy too strict / broken)';
  else
    raise notice 'TEST 7b PASSED: enrolled student can update their own progress within their own enrolled project';
  end if;

  ----------------------------------------------------------------------
  -- TEST 8: an enrolled student cannot change an EXISTING record's
  -- project_id to move it into a project they aren't a member of. Unlike
  -- TEST 7 (a fresh INSERT, no USING clause involved at all), this row
  -- (rls-test-a-ex01) already belongs to test_student_a within their own
  -- enrolled project, so it passes the policy's USING clause — this
  -- specifically exercises WITH CHECK rejecting the attempted change.
  ----------------------------------------------------------------------
  write_succeeded := false;
  begin
    update public.exercise_progress
    set project_id = thylacine_id
    where user_id = test_student_a and exercise_id = 'rls-test-a-ex01';
    write_succeeded := true;
  exception
    when insufficient_privilege then
      write_succeeded := false;
  end;

  select (project_id = thylacine_id) into result
  from public.exercise_progress
  where user_id = test_student_a and exercise_id = 'rls-test-a-ex01';

  if write_succeeded or coalesce(result, false) then
    raise exception 'TEST 8 FAILED: enrolled student was able to move an existing record into an unauthorized project';
  else
    raise notice 'TEST 8 PASSED: enrolled student cannot move an existing record into an unauthorized project';
  end if;

  raise notice 'ALL TESTS PASSED';
end $$;

rollback;
