-- ============================================================================
-- identify_luigi_progress.sql
--
-- READ-ONLY. Does not insert, update, or delete anything. Safe to run at
-- any time in the Supabase SQL editor.
--
-- Purpose: before migrating Luigi's progress to a permanent account, get a
-- complete, authoritative picture of every row currently attributed to him,
-- across every anonymous identity he has ever used (student_label is a
-- free-text field set by the app on every write, not an auth-linked
-- attribute, so this is the only reliable way to find "all of Luigi's data"
-- today).
-- ============================================================================


-- ---- 1. One row per distinct identity, with activity summary -----------
-- Run this first. Confirms how many distinct anonymous user_ids currently
-- carry student_label = 'Luigi', and how active/stale each one is.

select
  user_id,
  count(*)                                                              as row_count,
  count(*) filter (where completed)                                      as completed_count,
  count(*) filter (where notes is not null and length(trim(notes)) > 0)  as answered_count,
  min(updated_at)                                                        as first_activity,
  max(updated_at)                                                        as last_activity
from public.exercise_progress
where student_label = 'Luigi'
group by user_id
order by last_activity desc;


-- ---- 2. Exercises with more than one identity's row -----------------------
-- Flags exactly which exercise_ids have conflicting/duplicate versions
-- across identities, i.e. where a "most recent wins" decision will need to
-- be made (the supervisor view already does this automatically for
-- display; this is the same check, run directly against the data).

select
  exercise_id,
  count(distinct user_id) as identity_count
from public.exercise_progress
where student_label = 'Luigi'
group by exercise_id
having count(distinct user_id) > 1
order by exercise_id;


-- ---- 3. Full row-level export, ordered for review --------------------------
-- The complete, ungrouped detail behind (1) and (2) above — every row,
-- every identity, every timestamp. Keep a copy of this output (e.g. export
-- to CSV) as the pre-migration backup/reference before any account
-- migration is performed, regardless of which migration strategy is used.

select
  exercise_id,
  user_id,
  completed,
  notes,
  updated_at
from public.exercise_progress
where student_label = 'Luigi'
order by exercise_id, updated_at desc;
