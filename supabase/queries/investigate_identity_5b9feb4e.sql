-- ============================================================================
-- investigate_identity_5b9feb4e.sql
--
-- READ-ONLY. Does not insert, update, or delete anything.
--
-- Purpose: characterize the newly-surfaced identity 5b9feb4e-d346-4c65-
-- 9f57-ec628adaf668 (10 rows, last updated 2026-10-08) to determine whether
-- it is genuine student work or leftover test pollution, before any account
-- migration decision is made. Same question we answered for the three
-- earlier stray identities (which turned out to be test pollution from an
-- automated regression script) — this time without assuming the answer.
-- ============================================================================

-- Full row-level detail for this one identity: which exercises, completion
-- state, notes content, and exact timestamps. A row with completed = false
-- and empty/null notes across all of one module (matching the pattern of
-- the three previously-confirmed test identities) points to pollution; a
-- row with real notes text and/or completed = true points to genuine work.

select
  exercise_id,
  completed,
  notes,
  student_label,
  updated_at
from public.exercise_progress
where user_id = '5b9feb4e-d346-4c65-9f57-ec628adaf668'
order by exercise_id;


-- For comparison: the same detail for the identity already believed genuine
-- (4c7e0f1a-a2d1-4ad7-82ba-5010fa209854, 1 row, 2026-10-05), so both can be
-- read side by side.

select
  exercise_id,
  completed,
  notes,
  student_label,
  updated_at
from public.exercise_progress
where user_id = '4c7e0f1a-a2d1-4ad7-82ba-5010fa209854'
order by exercise_id;


-- Full refreshed identity summary across every Luigi-labeled row, in case
-- any other identities have appeared since the last check.

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
