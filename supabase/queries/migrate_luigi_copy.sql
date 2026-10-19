-- ============================================================================
-- migrate_luigi_copy.sql
--
-- COPIES (does not move/delete) Luigi's 25 confirmed-genuine progress
-- records from his anonymous identity (d303c036-37ce-4723-876d-
-- c207c706cf5c) to his new permanent account. The original anonymous rows
-- are left completely untouched by this script — preserved until the new
-- account and app are tested successfully, per the plan.
--
-- BEFORE RUNNING:
--   1. migrations/0001_multi_user_platform.sql must already be applied.
--   2. Luigi's new permanent account must exist, with its profiles row and
--      Great Auk project_memberships row already set up (see
--      setup_luigi_profile_membership.sql).
--   3. Replace every '<NEW_LUIGI_USER_ID>' below with that account's UUID.
--   4. Run STEP 0 first and read its result before running STEP 1.
--
-- Deliberately uses a distinct, clearly-transitional student_label instead
-- of "Luigi" — NOT a final choice, a safety measure for the verification
-- window. See "avoiding a duplicate Luigi in the supervisor view" in
-- MIGRATION_PLAN.md: if these copied rows were labeled "Luigi" immediately,
-- they would carry identical updated_at timestamps to the originals and
-- auto-merge with them in the supervisor view's existing by-label merge
-- logic, with no reliable way to tell which "version" you were actually
-- looking at while trying to verify the copy. Keeping them separately
-- labeled lets you compare old vs. new side by side in the supervisor view
-- during testing. Relabeling to "Luigi" (and retiring the originals) is its
-- own later, deliberate step — see relabel_and_retire_luigi_anonymous.sql.
-- ============================================================================

-- ---- STEP 0: check first whether any trigger would fire on INSERT and
-- overwrite updated_at, before deciding whether STEP 1's trigger-disable is
-- actually needed (it's harmless to leave in either way, but worth knowing).

select tgname, tgenabled, tgtype
from pg_trigger
where tgrelid = 'public.exercise_progress'::regclass
  and not tgisinternal;


-- ---- STEP 1: the copy itself, inside a transaction, idempotent (safe to
-- re-run if it fails partway through — won't duplicate rows on a retry).

begin;

alter table public.exercise_progress disable trigger user;

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
where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
on conflict (user_id, exercise_id) do nothing;

alter table public.exercise_progress enable trigger user;

commit;
