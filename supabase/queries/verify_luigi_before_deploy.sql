-- ============================================================================
-- verify_luigi_before_deploy.sql
--
-- READ-ONLY. Only SELECT statements: inserts, updates and deletes nothing.
--
-- Purpose: immediately before deploying HoloBase, confirm that Luigi's real
-- account holds the most recent version of every exercise he has ever
-- saved — including anything he saved on the live (anonymous-auth) site
-- AFTER his 25 records were copied across on 2026-10-19/20.
--
-- Run it once the saving freeze with Luigi has started (so nothing changes
-- between this check and the deploy). Run each numbered query on its own in
-- the Supabase SQL Editor (select the query's text, then Run) — the editor
-- shows only the last result when several run together.
--
-- Identities (already recorded in this repository):
--   Luigi's original anonymous identity:  d303c036-37ce-4723-876d-c207c706cf5c
--   Luigi's real account:                 b83f6452-6183-41aa-b22f-f061ccbd0cf2
--
-- How "most recent" is decided: updated_at is set by the database itself
-- (DEFAULT now() on insert, the set_exercise_progress_updated_at trigger on
-- update) — neither the old nor the new frontend sends a timestamp — so it is
-- reliable server time. The copy preserved the original timestamps, so a
-- later edit on either side shows up as a newer updated_at. A re-save with
-- unchanged content also refreshes updated_at, so CONTENT is compared first:
-- identical content needs no action whatever the timestamps say.
--
-- Expected result today, if Luigi has not saved anything since the copy:
--   query 1: 25 rows, all "none — identical"
--   query 2: one line, "none — identical" = 25
--   query 3: no rows, or only identities whose status starts "reviewed"
--   query 4: no rows, or only rows whose status starts "reviewed"
--
-- Reviewed and deliberately NOT transferred (decision 2026-10-21):
--   98ce87b1-68f8-4518-936a-bdf2b27ca4a7 — one row, m1-ex08, completed =
--   false, notes empty, saved 2026-10-20 19:28:43.844711+00. Carries no
--   answer or completion (it displays exactly like no row), and the live
--   site labels every visitor's rows "Luigi", so the label does not show
--   whose it is. Queries 3 and 4 mark it "reviewed"; if that identity ever
--   saves anything newer, it shows as "NEW — review" again.
--   query 5: 25 rows, membership = student / great-auk
--
-- If anything says CARRY OVER or REVIEW: stop before deploying. A separate
-- script will be proposed and shown to Binia first; nothing is changed
-- automatically, and no existing record is modified or deleted without her
-- explicit approval.
-- ============================================================================


-- 1. Per-exercise reconciliation: original anonymous rows vs real account.
with
  anon as (
    select exercise_id, completed, notes, updated_at
    from public.exercise_progress
    where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  ),
  real as (
    select exercise_id, completed, notes, updated_at
    from public.exercise_progress
    where user_id = 'b83f6452-6183-41aa-b22f-f061ccbd0cf2'
  )
select
  coalesce(a.exercise_id, r.exercise_id)                       as exercise_id,
  a.completed                                                  as live_site_completed,
  r.completed                                                  as real_account_completed,
  a.notes                                                      as live_site_notes,
  r.notes                                                      as real_account_notes,
  a.updated_at                                                 as live_site_updated_at,
  r.updated_at                                                 as real_account_updated_at,
  case
    when r.exercise_id is null then 'CARRY OVER — saved on the live site, missing from the real account'
    when a.exercise_id is null then 'none — only in the real account (kept)'
    when a.completed is not distinct from r.completed
     and a.notes     is not distinct from r.notes      then 'none — identical'
    when a.updated_at > r.updated_at                     then 'CARRY OVER — live-site version is newer'
    when r.updated_at > a.updated_at                     then 'none — real-account version is newer (kept)'
    else                                                      'REVIEW — same time, different content'
  end                                                          as proposed_action
from anon a
full outer join real r on r.exercise_id = a.exercise_id
order by 1;


-- 2. One-glance summary of query 1.
with
  anon as (
    select exercise_id, completed, notes, updated_at
    from public.exercise_progress
    where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  ),
  real as (
    select exercise_id, completed, notes, updated_at
    from public.exercise_progress
    where user_id = 'b83f6452-6183-41aa-b22f-f061ccbd0cf2'
  ),
  classified as (
    select case
      when r.exercise_id is null then 'CARRY OVER — saved on the live site, missing from the real account'
      when a.exercise_id is null then 'none — only in the real account (kept)'
      when a.completed is not distinct from r.completed
       and a.notes     is not distinct from r.notes      then 'none — identical'
      when a.updated_at > r.updated_at                     then 'CARRY OVER — live-site version is newer'
      when r.updated_at > a.updated_at                     then 'none — real-account version is newer (kept)'
      else                                                      'REVIEW — same time, different content'
    end as proposed_action
    from anon a
    full outer join real r on r.exercise_id = a.exercise_id
  )
select proposed_action, count(*) as exercises
from classified
group by proposed_action
order by proposed_action;


-- 3. Any OTHER anonymous identity with saved work since the copy. The live
--    site creates a new anonymous identity per browser, so if Luigi used a
--    different browser or device after 2026-10-19, his newest answers would
--    be here, not under d303c036. (The new HoloBase code never creates
--    anonymous sessions, and the local test suites never reach the live
--    database, so anything listed here came from a real live-site visitor.)
select
  case
    when p.user_id = '98ce87b1-68f8-4518-936a-bdf2b27ca4a7'
     and max(p.updated_at) <= timestamptz '2026-10-20 19:28:43.844711+00'
      then 'reviewed 2026-10-21 — empty m1-ex08, not transferred'
    else 'NEW — review'
  end                                        as status,
  p.user_id,
  count(*)                                   as rows_saved,
  min(p.updated_at)                          as first_saved,
  max(p.updated_at)                          as last_saved,
  string_agg(distinct coalesce(p.student_label, '(no label)'), ', ') as labels,
  string_agg(p.exercise_id, ', ' order by p.exercise_id)             as exercises
from public.exercise_progress p
join auth.users u on u.id = p.user_id
where u.is_anonymous
  and p.user_id <> 'd303c036-37ce-4723-876d-c207c706cf5c'
  and p.updated_at >= timestamptz '2026-10-19 00:00:00+00'
group by p.user_id
order by last_saved desc;


-- 4. Any row labelled as Luigi's that belongs to neither of his two
--    identities (any date) — a second place his work could be.
select
  case
    when user_id = '98ce87b1-68f8-4518-936a-bdf2b27ca4a7'
     and updated_at <= timestamptz '2026-10-20 19:28:43.844711+00'
      then 'reviewed 2026-10-21 — not transferred'
    else 'NEW — review'
  end as status,
  user_id, exercise_id, completed, notes, student_label, updated_at
from public.exercise_progress
where student_label ilike '%luigi%'
  and user_id not in ('d303c036-37ce-4723-876d-c207c706cf5c',
                      'b83f6452-6183-41aa-b22f-f061ccbd0cf2')
order by updated_at desc;


-- 5. The real account is ready for the new site: its rows are in the Great
--    Auk project and it holds a Great Auk student membership.
select
  p.exercise_id,
  pr.slug                                    as row_project,
  (select string_agg(m.role || ' / ' || mp.slug, ', ')
     from public.project_memberships m
     join public.projects mp on mp.id = m.project_id
    where m.user_id = p.user_id)             as memberships,
  p.updated_at
from public.exercise_progress p
left join public.projects pr on pr.id = p.project_id
where p.user_id = 'b83f6452-6183-41aa-b22f-f061ccbd0cf2'
order by p.exercise_id;
