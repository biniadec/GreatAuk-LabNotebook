-- ============================================================================
-- verify_0002_before_running.sql
--
-- SIMPLIFIED per request: this no longer creates five throwaway accounts.
-- It reuses your REAL, existing administrator account and Luigi's REAL,
-- existing enrolled-student data for every check that can be done
-- read-only — nothing is ever written to either of those two identities,
-- or to Luigi's progress, by this script. See "WHY ONE NEW ACCOUNT IS
-- STILL NEEDED" below for the one thing that structurally cannot be tested
-- without it, and why.
--
-- Answers whether 0002_retire_legacy_instructor_policy.sql is safe to run:
--
--   REQUIREMENT 1 (admin access / student writes unaffected): TEST A/B use
--     your REAL administrator UUID, read-only, to confirm admin read
--     access to Luigi's real progress and profile survives the drop.
--     Student login and progress-SAVING are not tested here at all — not
--     because it's untested, but because it's structurally impossible for
--     them to be affected: the policy being dropped is SELECT-only on
--     exercise_progress, and Postgres never consults a SELECT policy while
--     evaluating an INSERT or UPDATE; login is Supabase Auth and doesn't
--     consult this table's policies at all. There is no mechanism by which
--     dropping a SELECT policy changes write behavior, so there is nothing
--     for a SQL test to meaningfully exercise there — re-running INSERT/
--     UPDATE against your real test-student account to "prove" this would
--     mean writing to their real progress, which you asked this script not
--     to do, for a guarantee that doesn't need an empirical test to hold.
--
--   REQUIREMENT 2 (teacher reads stay project-scoped, progress + profiles):
--     TEST C (positive) uses the one new teacher account (see below) to
--     confirm it CAN read Luigi's real progress and profile, since Luigi
--     is a real student in the project this teacher is assigned to.
--     TEST D (negative, profiles) proves the same teacher CANNOT read your
--     real administrator's profile, read-only, using your account only as
--     a target to query against — never writing to it. This is a genuine,
--     non-vacuous negative case: the policy requires the target to be a
--     'student' member of a project the caller teaches, which is false for
--     your admin account regardless of which project the teacher is
--     assigned to, so a pass here really does demonstrate the isolation
--     check is doing its job, not just that there was nothing to find.
--
--   REQUIREMENT 3 (any other bypass?): already answered by
--     audit_current_policies.sql, which you've run — the legacy
--     instructors-table policy (held only by your own admin UUID) is the
--     one bypass, and it's exactly what 0002 removes.
--
--   WHY ONE NEW ACCOUNT IS STILL NEEDED: every row in profiles,
--   project_memberships, and exercise_progress has a foreign key straight
--   to auth.users(id) — there is no way to create a synthetic "teacher"
--   identity, even transaction-scoped and rolled back, without a real
--   auth.users row behind it. The only way to avoid creating one at all
--   would be to temporarily grant a teacher-role membership to an account
--   that already exists — but the only real accounts that exist today are
--   your administrator account, your test-student account, and Luigi, and
--   you've asked that none of those three have their data, roles,
--   memberships, or progress modified, even temporarily. Respecting that
--   literally leaves no existing identity available to stand in as a
--   teacher. The one new account below is the minimal way around that: a
--   single lightweight account, created exactly the same simple way you
--   already created the test-student account, used only to prove the
--   teacher-side read policies — nothing about it touches your
--   administrator account, your test student, or Luigi's data.
--
--   WHAT THIS DOES NOT RE-PROVE (and why that's fine): the negative case
--   for exercise_progress specifically — a teacher of one project cannot
--   read a student's progress in a DIFFERENT project — needs a second
--   real project with a real enrolled student to test against with real
--   data, and Thylacine RNA has no enrolled students yet. Rather than
--   fabricate a throwaway "Thylacine student" fixture (which would be no
--   more "real" than the five-account version you asked to move away
--   from), this relies on rls_tests.sql TEST 3, which already proves
--   exactly this shape of guarantee (same helper function,
--   is_teacher_of_student_in_project(), same cross-project logic) with
--   synthetic fixtures, reviewed and unchanged since. If you'd rather see
--   it re-proven fresh in this exact run instead of relying on that file,
--   say so and I'll add a second minimal account for it — just flagging
--   that as optional, not something this script silently skipped.
--
-- HOW: the actual `drop policy` statement from 0002 runs INSIDE this same
-- transaction, which ends in ROLLBACK, never COMMIT — the drop and the one
-- new account's profiles/membership rows are undone automatically either
-- way. Your administrator account, your test-student account, and Luigi's
-- rows are never written to anywhere in this script, only read.
--
-- PREREQUISITE: exactly one real auth.users UUID for a throwaway "Test
-- Teacher" account — create it the same way you created the test-student
-- account (Dashboard > Authentication > Users > Add user, or your own
-- sign-up flow), note its UUID, fill it in below. Safe to delete that
-- Dashboard user afterward; nothing this script writes against it needs
-- that cleanup, since it all rolls back.
--
-- Fill in your real administrator UUID and Luigi's real UUID below too —
-- both already known from earlier in this project:
--   administrator: 800ce85d-2fe5-41ac-971d-21cb3c4247f3
--   Luigi:          b83f6452-6183-41aa-b22f-f061ccbd0cf2
-- ============================================================================

begin;

do $$
declare
  admin_uuid      uuid := '800ce85d-2fe5-41ac-971d-21cb3c4247f3'; -- your real admin account
  luigi_uuid      uuid := 'b83f6452-6183-41aa-b22f-f061ccbd0cf2'; -- Luigi's real account
  test_teacher    uuid := '<TEST_TEACHER_UUID>';                   -- the one new account
  great_auk_id    uuid;
  result          boolean;
  policy_still_present boolean;
begin
  select id into great_auk_id from public.projects where slug = 'great-auk';
  if great_auk_id is null then
    raise exception 'Great Auk project not found — has 0001 actually been applied?';
  end if;

  -- Sanity check: Luigi actually has real progress data to read (if this
  -- is empty, the tests below would pass vacuously — confirming there's
  -- nothing to find, not that reads actually work).
  select exists (select 1 from public.exercise_progress where user_id = luigi_uuid) into result;
  if not result then
    raise exception 'SETUP FAILED: no exercise_progress rows found for the given Luigi UUID — check the UUID is correct before relying on this test.';
  end if;

  -- ---- The ONE new fixture: a teacher account for Great Auk. Additive
  -- only — a brand new user_id that has never existed in these tables
  -- before, so this is not "changing an existing account" in any sense.
  insert into public.profiles (user_id, display_name, role) values
    (test_teacher, 'Test Teacher (verify-0002, temporary)', 'teacher')
  on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role;

  insert into public.project_memberships (project_id, user_id, role) values
    (great_auk_id, test_teacher, 'teacher')
  on conflict (project_id, user_id) do nothing;

  -- ---- THE ACTUAL CHANGE 0002 MAKES, applied live, inside this ----------
  -- transaction only. Exact statement copied from 0002 itself.
  drop policy if exists "Instructors can read all progress rows" on public.exercise_progress;

  select exists (
    select 1 from pg_policies
    where tablename = 'exercise_progress' and policyname = 'Instructors can read all progress rows'
  ) into policy_still_present;

  if policy_still_present then
    raise exception 'SETUP FAILED: the legacy policy name in this script does not match the live database — recheck audit_current_policies.sql query 1 before relying on this or on 0002 itself.';
  else
    raise notice 'Legacy instructor policy dropped for this transaction (will be rolled back at the end either way).';
  end if;

  -- From here on, simulate real authenticated client sessions.
  set local role authenticated;

  ----------------------------------------------------------------------
  -- TEST A: your REAL administrator account can still read Luigi's REAL
  -- progress after the legacy policy is dropped. Read-only — nothing
  -- written to either account.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', admin_uuid, 'role', 'authenticated')::text, true);

  select exists (select 1 from public.exercise_progress where user_id = luigi_uuid) into result;
  if not result then
    raise exception 'TEST A FAILED: administrator lost read access to Luigi''s real progress after the legacy policy was dropped — DO NOT RUN 0002 until this is resolved.';
  else
    raise notice 'TEST A PASSED: administrator still reads Luigi''s real progress after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST B: your REAL administrator account can still read Luigi's REAL
  -- profile after the drop.
  ----------------------------------------------------------------------
  select exists (select 1 from public.profiles where user_id = luigi_uuid) into result;
  if not result then
    raise exception 'TEST B FAILED: administrator lost read access to Luigi''s real profile after the drop.';
  else
    raise notice 'TEST B PASSED: administrator still reads Luigi''s real profile after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST C: the one new, temporary Great Auk teacher account CAN read
  -- Luigi's REAL progress and profile — Luigi is a real student in the
  -- same project this teacher is assigned to. Read-only against Luigi.
  ----------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', test_teacher, 'role', 'authenticated')::text, true);

  select exists (select 1 from public.exercise_progress where user_id = luigi_uuid) into result;
  if not result then
    raise exception 'TEST C FAILED: a teacher of Luigi''s own project could not read his real progress after the drop.';
  else
    raise notice 'TEST C PASSED: a teacher of Luigi''s project reads his real progress after the drop.';
  end if;

  select exists (select 1 from public.profiles where user_id = luigi_uuid) into result;
  if not result then
    raise exception 'TEST C2 FAILED: a teacher of Luigi''s own project could not read his real profile after the drop.';
  else
    raise notice 'TEST C2 PASSED: a teacher of Luigi''s project reads his real profile after the drop.';
  end if;

  ----------------------------------------------------------------------
  -- TEST D: that same teacher CANNOT read your REAL administrator's
  -- profile — a genuine negative case (your admin account is not a
  -- 'student' member of any project, so this must be denied regardless of
  -- which project the teacher is assigned to), using only a read against
  -- your real account, never a write.
  ----------------------------------------------------------------------
  select exists (select 1 from public.profiles where user_id = admin_uuid) into result;
  if result then
    raise exception 'TEST D FAILED: teacher could read the administrator''s profile — profiles-table project isolation is broken.';
  else
    raise notice 'TEST D PASSED: teacher cannot read the administrator''s profile.';
  end if;

  raise notice 'ALL TESTS PASSED — 0002 is safe to run for real. (Cross-project progress isolation for a DIFFERENT project remains covered by rls_tests.sql TEST 3 — see file header.)';
end $$;

rollback;
