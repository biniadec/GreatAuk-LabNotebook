-- ============================================================================
-- migrate_luigi_copy.sql
--
-- COPIES (does not move/delete) Luigi's 25 confirmed-genuine progress
-- records from his anonymous identity (d303c036-37ce-4723-876d-
-- c207c706cf5c) to his new permanent account. The original anonymous rows
-- are left completely untouched by this script — preserved until the new
-- account and app are tested successfully, per the plan.
--
-- Note: this copies ALL rows for that user_id regardless of student_label
-- — deliberately. 21 of the 25 genuine rows (all of Module 00) have a NULL
-- student_label (they predate that column existing at all), not "Luigi".
-- Filtering by label would silently drop them. Filter by user_id only.
--
-- BEFORE RUNNING:
--   1. migrations/0001_multi_user_platform.sql must already be applied.
--   2. Luigi's new permanent account must exist, with its profiles row and
--      Great Auk project_memberships row already set up (see
--      setup_luigi_profile_membership.sql).
--   3. Replace every '<NEW_LUIGI_USER_ID>' below with that account's UUID.
--   4. Run STEP 0 and STEP 1 (both read-only) and read their results before
--      running STEP 2.
--
-- REVISION NOTE: the previous version of this script wrapped the copy in
-- a blanket `alter table exercise_progress disable trigger user;`, which
-- would have silently disabled ANY trigger on the table, not just one
-- affecting updated_at — too broad a tool for a problem that may not even
-- exist. It also used `on conflict (user_id, exercise_id) do nothing`,
-- which would silently skip any row that happened to already exist at the
-- destination, with no visible sign that anything was skipped. Both are
-- fixed below: STEP 0 tells you definitively whether a trigger would even
-- interfere before you decide to do anything about it, and STEP 2 has no
-- on-conflict clause at all — a real conflict now fails loudly with a
-- constraint-violation error (which should never legitimately happen,
-- since the destination is a brand-new account), rather than silently
-- vanishing. STEP 1 checks for that possibility explicitly, in advance,
-- read-only.
--
-- Deliberately uses a distinct, clearly-transitional student_label instead
-- of "Luigi" — NOT a final choice, a safety measure for the verification
-- window. See "avoiding a duplicate Luigi in the supervisor view" in
-- MIGRATION_PLAN.md: if these copied rows were labeled "Luigi" immediately,
-- they would carry identical updated_at timestamps to the originals and
-- auto-merge with them in the supervisor view's existing by-label merge
-- logic, with no reliable way to tell which "version" you were actually
-- looking at while trying to verify the copy. Keeping them separately
-- labeled lets you compare old vs. new side by side during testing.
-- Relabeling to "Luigi" (and retiring the originals) is its own later,
-- deliberate step — see relabel_and_retire_luigi_anonymous.sql.
-- ============================================================================

-- ---- STEP 0 (read-only): does any trigger on exercise_progress fire on
-- INSERT and risk overwriting updated_at? tgtype encodes this as a bitmask
-- (bit 2 = INSERT, bit 1 = BEFORE); the `pg_get_triggerdef` output is the
-- easiest way to just read it directly.

select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.exercise_progress'::regclass
  and not tgisinternal;

-- If this returns nothing, or returns only a trigger whose definition
-- clearly says `BEFORE UPDATE` (not INSERT), no trigger will interfere and
-- STEP 2 can run as-is. If it returns a trigger that fires on INSERT and
-- unconditionally sets NEW.updated_at, note its exact name — you may need
-- to disable that ONE specific trigger (not all of them) around STEP 2:
--   alter table public.exercise_progress disable trigger <exact_name>;
--   -- ... run STEP 2 ...
--   alter table public.exercise_progress enable trigger <exact_name>;
-- Either way, verify_luigi_migration.sql's timestamp_matches column is the
-- actual proof after the fact — treat STEP 0 as advance information, not
-- as the final word.


-- ---- STEP 1 (read-only): does the destination already have a row for any
-- of these 25 exercise_ids? Should return ZERO rows — the destination is a
-- brand-new account. If this returns anything, STOP and investigate before
-- proceeding; don't let STEP 2 silently overwrite or skip it.

select exercise_id
from public.exercise_progress
where user_id = '<NEW_LUIGI_USER_ID>'::uuid
  and exercise_id in (
    select exercise_id from public.exercise_progress
    where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  );


-- ---- STEP 2: the copy itself, inside a transaction. No on-conflict clause
-- — if STEP 1 found nothing, this succeeds cleanly; if a real conflict
-- somehow exists anyway, this fails loudly with a unique-violation error
-- rather than silently skipping rows.

begin;

insert into public.exercise_progress (user_id, exercise_id, completed, notes, student_label, updated_at, project_id)
select
  '<NEW_LUIGI_USER_ID>'::uuid,
  exercise_id,
  completed,
  notes,
  'Luigi (migrated copy — pending verification)',
  updated_at,
  project_id
from public.exercise_progress
where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c';

commit;
