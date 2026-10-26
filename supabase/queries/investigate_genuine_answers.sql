-- ============================================================================
-- investigate_genuine_answers.sql
--
-- READ-ONLY. Does not insert, update, or delete anything.
--
-- Purpose: the 25 exported substantive answers (Module 00: 21 completed;
-- Module 01: 4 with written answers, 3 completed, one genuine-but-incomplete)
-- don't line up with the 4-row summary previously seen for user_id
-- d303c036-37ce-4723-876d-c207c706cf5c. This identifies exactly which
-- user_id each substantive row actually belongs to, so we can tell whether
-- Module 00 and Module 01 are under one identity or split across several
-- before any migration decision is made.
-- ============================================================================

-- 1. Every row with real content — completed, or has actual note text, or
--    both. Filtering on completed alone would miss genuine-but-incomplete
--    answers like the Module 01 Exercise 04 case described.

select
  user_id,
  exercise_id,
  completed,
  length(coalesce(notes, '')) as notes_length,
  notes,
  updated_at
from public.exercise_progress
where student_label = 'Luigi'
  and (completed = true or (notes is not null and length(trim(notes)) > 0))
order by user_id, exercise_id;


-- 2. Per-identity, per-module rollup: how many substantive rows each
--    user_id holds, split by which module those exercise_ids belong to.
--    Directly answers "do Module 00 and Module 01 sit under the same
--    identity or different ones."

select
  user_id,
  substring(exercise_id from '^m(\d+)-') as module_number,
  count(*)            as substantive_row_count,
  min(updated_at)     as first_activity,
  max(updated_at)     as last_activity
from public.exercise_progress
where student_label = 'Luigi'
  and (completed = true or (notes is not null and length(trim(notes)) > 0))
group by user_id, module_number
order by user_id, module_number;


-- 3. Simple per-identity total, for a quick top-line view across all
--    modules at once.

select
  user_id,
  count(*)            as substantive_row_count,
  min(updated_at)     as first_activity,
  max(updated_at)     as last_activity
from public.exercise_progress
where student_label = 'Luigi'
  and (completed = true or (notes is not null and length(trim(notes)) > 0))
group by user_id
order by last_activity desc;
