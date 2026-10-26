-- ============================================================================
-- relabel_and_retire_luigi_anonymous.sql
--
-- DO NOT RUN YET. This is the final step of the account migration, only
-- once:
--   1. migrate_luigi_copy.sql has been run and verify_luigi_migration.sql
--      shows all 25 records present and identical, AND
--   2. Luigi has actually logged into the new permanent account on the
--      live (tested) app and confirmed his progress and notes appear
--      correctly there.
--
-- Replace '<NEW_LUIGI_USER_ID>' before running.
--
-- Note: this label-based relabeling is a bridge for the CURRENT
-- supervisor.js, which still groups by student_label (see the finding in
-- MIGRATION_PLAN.md about Module 00's NULL labels — this update applies
-- uniformly to all of this user_id's rows regardless of their current
-- label, so it isn't affected by that gap). Once supervisor.js is rewritten
-- to identify students by user_id + project_memberships instead (planned,
-- not yet built), this label juggling stops being load-bearing for access
-- or display — student_label becomes purely historical metadata, as
-- intended.
--
-- CONFIRMED via a live read-only audit: exercise_progress has exactly one
-- user-defined trigger, `set_exercise_progress_updated_at` (BEFORE UPDATE,
-- calling set_updated_at()). Both statements below are UPDATEs, so — unlike
-- the copy step, which is a plain INSERT the trigger doesn't touch — this
-- trigger WOULD fire here and stamp updated_at to now() on all 25+25 rows,
-- overwriting real historical activity timestamps for no reason (this
-- script only changes student_label, nothing about the actual progress).
-- Disabled around both statements, by its confirmed exact name, and
-- re-enabled immediately after — not a blanket disable of every trigger.
-- ============================================================================

begin;

alter table public.exercise_progress disable trigger set_exercise_progress_updated_at;

-- Relabel the copied rows from the transitional label to the real one. Once
-- this runs, the supervisor view's existing by-label merge logic will treat
-- the new account's rows as "Luigi" going forward.
update public.exercise_progress
set student_label = 'Luigi'
where user_id = '<NEW_LUIGI_USER_ID>'::uuid;

-- Retire (not delete) the original anonymous identity's rows by relabeling
-- them out of the "Luigi" grouping, so the supervisor view shows exactly
-- one "Luigi" (the new account) with no duplicate versions. The rows
-- themselves are kept, not deleted, as a historical/rollback safety net.
update public.exercise_progress
set student_label = 'Luigi (retired anonymous identity, migrated)'
where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c';

alter table public.exercise_progress enable trigger set_exercise_progress_updated_at;

commit;

-- Only once you are fully confident the migration is complete and no
-- longer need the original rows at all, they can be deleted in a separate,
-- explicit, later step — not part of this script.

-- ---- Post-check (read-only): confirm updated_at was actually preserved
-- (i.e. the trigger really was disabled for this statement, not just
-- assumed to be) — every row should show today's date only in created_at-
-- style fields, never in updated_at, which should match whatever
-- verify_luigi_migration.sql already captured for these same 25 rows.
select user_id, exercise_id, student_label, updated_at
from public.exercise_progress
where user_id in ('<NEW_LUIGI_USER_ID>'::uuid, 'd303c036-37ce-4723-876d-c207c706cf5c')
order by user_id, exercise_id;
