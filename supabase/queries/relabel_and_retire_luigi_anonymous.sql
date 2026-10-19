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
-- ============================================================================

begin;

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

commit;

-- Only once you are fully confident the migration is complete and no
-- longer need the original rows at all, they can be deleted in a separate,
-- explicit, later step — not part of this script.
