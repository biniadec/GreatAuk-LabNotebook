-- ============================================================================
-- verify_luigi_migration.sql
--
-- READ-ONLY. Run after migrate_luigi_copy.sql, before any relabeling or
-- retiring of the original anonymous records.
--
-- Replace '<NEW_LUIGI_USER_ID>' with the new account's UUID before running.
--
-- Note: all comparisons below are keyed on user_id only, never
-- student_label — 21 of the 25 genuine rows (all of Module 00) have a NULL
-- student_label (they predate that column existing), so any label-based
-- comparison would silently miss them.
-- ============================================================================

-- 1. Row count sanity check — both sides must report 25.
select
  (select count(*) from public.exercise_progress
     where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c')   as original_count,
  (select count(*) from public.exercise_progress
     where user_id = '<NEW_LUIGI_USER_ID>'::uuid)              as copied_count;


-- 2. Full row-by-row comparison: every exercise_id, with completed/notes/
--    updated_at compared directly between the original and the copy.
--    "false" in any *_matches column pinpoints exactly what differs.
select
  o.exercise_id,
  o.completed                           as original_completed,
  n.completed                           as copied_completed,
  (o.completed is not distinct from n.completed)  as completed_matches,
  o.notes                               as original_notes,
  n.notes                               as copied_notes,
  (o.notes is not distinct from n.notes)          as notes_match,
  o.updated_at                          as original_updated_at,
  n.updated_at                          as copied_updated_at,
  (o.updated_at = n.updated_at)                   as timestamp_matches
from public.exercise_progress o
left join public.exercise_progress n
  on n.user_id = '<NEW_LUIGI_USER_ID>'::uuid
 and n.exercise_id = o.exercise_id
where o.user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
order by o.exercise_id;


-- 3. Specifically confirm the genuine-but-incomplete answer (Module 01,
--    Exercise 04 — assumed exercise_id m1-ex04 per the established
--    m<module>-ex<number> convention; adjust if that assumption is wrong)
--    copied correctly: completed = false, notes present and non-empty.
select exercise_id, completed, notes, updated_at
from public.exercise_progress
where user_id = '<NEW_LUIGI_USER_ID>'::uuid
  and exercise_id = 'm1-ex04';


-- 4. Any row present on one side but not the other (should return zero
--    rows if the copy is complete and nothing extra was written).
select 'only in original' as which, exercise_id
from public.exercise_progress
where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  and exercise_id not in (
    select exercise_id from public.exercise_progress where user_id = '<NEW_LUIGI_USER_ID>'::uuid
  )
union all
select 'only in copy' as which, exercise_id
from public.exercise_progress
where user_id = '<NEW_LUIGI_USER_ID>'::uuid
  and exercise_id not in (
    select exercise_id from public.exercise_progress where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  );
