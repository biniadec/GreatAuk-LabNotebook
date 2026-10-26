-- ============================================================================
-- verify_project_id_backfill.sql
--
-- READ-ONLY. Run immediately after applying 0001, before doing anything
-- else — including before creating Luigi's new account or running any of
-- the account-migration scripts.
--
-- Purpose: explicitly confirm (not assume) that adding project_id to
-- exercise_progress did not alter updated_at for any existing row,
-- including Luigi's 25 genuine records. You've already exported those 25
-- records (notes, completion states, timestamps) separately — this
-- query's output is what you diff against that export directly.
-- ============================================================================

-- 1. Site-wide: every row must have a non-NULL project_id, and the count
--    of rows should match whatever it was before 0001 ran (0001 adds a
--    column and populates it; it never adds or removes rows).
select
  count(*)                                         as total_rows,
  count(*) filter (where project_id is null)       as rows_still_null,
  count(distinct project_id)                       as distinct_project_ids_in_use
from public.exercise_progress;

-- Expect: rows_still_null = 0. If this is nonzero, 0001's DO block (which
-- is supposed to have caught and fixed exactly this) didn't run as
-- expected — stop and investigate before proceeding to anything else.


-- 2. Luigi's 25 records specifically, in the exact shape comparable
--    against your existing export: user_id, exercise_id, completed,
--    notes, updated_at, and the newly-added project_id.
select
  user_id,
  exercise_id,
  completed,
  notes,
  updated_at,
  project_id
from public.exercise_progress
where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
order by exercise_id;

-- Diff this output's (exercise_id, completed, notes, updated_at) columns
-- against your export. They must match exactly, row for row. project_id
-- is new — expected to be the Great Auk project's id for all 25, which
-- you can confirm with:
--   select id from public.projects where slug = 'great-auk';
