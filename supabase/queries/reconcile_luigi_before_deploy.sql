-- ============================================================================
-- reconcile_luigi_before_deploy.sql
--
-- NOT YET RUN. Prepared for Binia's review. Run STEP 1 (read-only) first;
-- run STEP 3 only after Binia has approved the exact rows STEP 1 shows.
--
-- Purpose: bring Luigi's REAL account up to date with answers he saved on
-- the live (anonymous-auth) site after his 25 records were copied across on
-- 2026-10-19/20, so that after the HoloBase deploy he sees the newest
-- version of every exercise.
--
-- Identities:
--   original anonymous identity (source, NEVER modified): d303c036-37ce-4723-876d-c207c706cf5c
--   real account (target):                               b83f6452-6183-41aa-b22f-f061ccbd0cf2
--
-- What STEP 3 changes, and nothing else:
--   - "live-site version is newer": the real account's row for that exercise
--     gets the anonymous row's completed, notes and updated_at — only if the
--     anonymous row is strictly newer AND the content differs, re-checked
--     inside the transaction.
--   - "missing from the real account": a new row is inserted for the real
--     account with the anonymous row's completed, notes and updated_at.
--   Both: project_id is set to Great Auk explicitly; student_label is the
--   same transitional label the original copy used, so the later
--   relabel_and_retire_luigi_anonymous.sql treats these rows identically.
--
-- Scope: only Luigi's original anonymous identity -> his real account. The
-- third anonymous identity 98ce87b1-68f8-4518-936a-bdf2b27ca4a7 (one empty,
-- incomplete m1-ex08 row, 2026-10-20 19:28:43) was reviewed on 2026-10-21
-- and deliberately is NOT transferred: it holds no answer or completion.
-- This script never reads or writes it, and its row is covered by the
-- "every other user's rows unchanged" fingerprint check below.
--
-- What it never does: touch any anonymous row; delete anything; change any
-- real-account row outside the approved list; overwrite a real-account row
-- that is newer; touch any other user.
--
-- Timestamps: the real save time is preserved (the anonymous row's
-- updated_at), exactly as the original copy did. The BEFORE UPDATE trigger
-- set_exercise_progress_updated_at would otherwise stamp the time of this
-- fix instead, so it is disabled for this one statement block only — the
-- same pattern relabel_and_retire_luigi_anonymous.sql uses. The disable and
-- re-enable happen INSIDE the same transaction as the changes: if anything
-- fails, Postgres rolls the trigger change back together with everything
-- else. (The table is briefly locked for other writers while it runs —
-- milliseconds, during the saving freeze.)
--
-- Saves made after the review: STEP 3 aborts, changing nothing, if Luigi's
-- anonymous identity saved anything after the moment recorded in STEP 1, if
-- the set of rows needing reconciliation is not exactly the approved list,
-- or if any approved row now looks different. Then: re-run STEP 1, review
-- again, update the two parameters, re-run STEP 3. After a successful run,
-- running it again also aborts harmlessly ("nothing left to reconcile").
-- Because the old live site can keep writing anonymous rows until the
-- deploy (and for ~10 minutes after it, from browser caches), re-run
-- verify_luigi_before_deploy.sql after the deploy too, before ending the
-- freeze; any new difference is handled by repeating this procedure.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 (READ-ONLY): the rows that need reconciliation, and the review time.
-- Run this on its own. Send the output to Claude/keep it for approval, and
-- note the reviewed_at value for STEP 2.
-- ----------------------------------------------------------------------------
with
  anon as (
    select exercise_id, completed, notes, updated_at, project_id
    from public.exercise_progress
    where user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  ),
  real as (
    select exercise_id, completed, notes, updated_at, project_id
    from public.exercise_progress
    where user_id = 'b83f6452-6183-41aa-b22f-f061ccbd0cf2'
  ),
  classified as (
    select
      coalesce(a.exercise_id, r.exercise_id) as exercise_id,
      a.completed  as live_site_completed,  r.completed  as real_account_completed,
      a.notes      as live_site_notes,      r.notes      as real_account_notes,
      a.updated_at as live_site_updated_at, r.updated_at as real_account_updated_at,
      (select slug from public.projects where id = a.project_id) as live_site_project,
      case
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
select now() as reviewed_at, *
from classified
where proposed_action not like 'none%'
order by exercise_id;


-- ----------------------------------------------------------------------------
-- STEP 2: fill in the two parameters in STEP 3 from the approved STEP 1
-- output:
--   v_approved     the exercise_ids Binia approved, e.g. '{m0-ex05,m1-ex05,m1-ex06}'
--   v_reviewed_at  the reviewed_at value STEP 1 printed, copied exactly
-- Left as placeholders, STEP 3 refuses to run.
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- STEP 3 (CHANGES DATA — only after approval): the reconciliation.
-- One DO statement, run on its own. A single statement is all-or-nothing in
-- Postgres: if any check below raises, every change it made — including the
-- trigger disable — is rolled back automatically. (No explicit begin/commit,
-- so a failed run can't leave the SQL Editor's session inside an aborted
-- transaction.)
-- ----------------------------------------------------------------------------
do $$
declare
  -- ===== parameters (STEP 2) =====
  v_approved     text[]      := '{REPLACE_WITH_APPROVED_EXERCISE_IDS}'::text[];
  v_reviewed_raw text        := 'REPLACE_WITH_REVIEWED_AT';
  -- ===============================
  c_anon   constant uuid := 'd303c036-37ce-4723-876d-c207c706cf5c';
  c_real   constant uuid := 'b83f6452-6183-41aa-b22f-f061ccbd0cf2';
  c_label  constant text := 'Luigi (migrated copy — pending verification)';
  v_reviewed_at       timestamptz;
  v_ga                uuid;
  v_candidates        text[];
  v_anon_fp_before    text;
  v_anon_fp_after     text;
  v_other_fp_before   text;
  v_other_fp_after    text;
  v_users_fp_before   text;
  v_users_fp_after    text;
  v_updated           int;
  v_inserted          int;
  v_remaining         int;
begin
  -- ---- preconditions -----------------------------------------------------
  if v_reviewed_raw like 'REPLACE%' or exists (select 1 from unnest(v_approved) x where x like 'REPLACE%') then
    raise exception 'Parameters not filled in (STEP 2). Nothing changed.';
  end if;
  v_reviewed_at := v_reviewed_raw::timestamptz;

  select id into v_ga from public.projects where slug = 'great-auk';
  if v_ga is null then raise exception 'Great Auk project not found. Nothing changed.'; end if;

  if not exists (select 1 from auth.users where id = c_real and not is_anonymous) then
    raise exception 'Luigi''s real account not found (or anonymous). Nothing changed.';
  end if;
  if not exists (select 1 from public.project_memberships
                  where user_id = c_real and project_id = v_ga and role = 'student') then
    raise exception 'Luigi''s real account has no Great Auk student membership. Nothing changed.';
  end if;

  -- The timestamp trigger must exist, be enabled, and be the only user
  -- trigger on the table — so disabling it by name is exactly what we think.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.exercise_progress'::regclass
                    and tgname = 'set_exercise_progress_updated_at'
                    and tgenabled = 'O') then
    raise exception 'Timestamp trigger set_exercise_progress_updated_at missing or not enabled. Nothing changed.';
  end if;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.exercise_progress'::regclass and not tgisinternal) <> 1 then
    raise exception 'exercise_progress has user triggers other than set_exercise_progress_updated_at — review first. Nothing changed.';
  end if;

  -- Lock both identities' rows so nothing changes underneath this check.
  perform 1 from public.exercise_progress where user_id in (c_anon, c_real) for update;

  -- ---- has anything been saved since the review? ------------------------
  if exists (select 1 from public.exercise_progress
              where user_id = c_anon and updated_at > v_reviewed_at) then
    raise exception 'Luigi''s anonymous identity saved something after the review (%). Re-run STEP 1 and review again. Nothing changed.', v_reviewed_at;
  end if;
  if exists (select 1 from public.exercise_progress
              where user_id = c_real and updated_at > v_reviewed_at) then
    raise exception 'Luigi''s real account changed after the review (%). Re-run STEP 1 and review again. Nothing changed.', v_reviewed_at;
  end if;

  -- ---- recompute exactly what needs reconciling, now ---------------------
  create temporary table _reconcile on commit drop as
  select
    a.exercise_id,
    a.completed, a.notes, a.updated_at, a.project_id as source_project,
    case when r.exercise_id is null then 'insert' else 'update' end as op
  from public.exercise_progress a
  left join public.exercise_progress r
    on r.user_id = c_real and r.exercise_id = a.exercise_id
  where a.user_id = c_anon
    and ( r.exercise_id is null
          or ( not (a.completed is not distinct from r.completed
                    and a.notes is not distinct from r.notes)
               and a.updated_at > r.updated_at ) );

  if exists (
    select 1
    from public.exercise_progress a
    join public.exercise_progress r on r.user_id = c_real and r.exercise_id = a.exercise_id
    where a.user_id = c_anon
      and not (a.completed is not distinct from r.completed and a.notes is not distinct from r.notes)
      and a.updated_at = r.updated_at
  ) then
    raise exception 'A REVIEW row exists (same time, different content) — needs a manual decision. Nothing changed.';
  end if;

  select coalesce(array_agg(exercise_id order by exercise_id), '{}') into v_candidates from _reconcile;
  if v_candidates = '{}'::text[] then
    raise exception 'Nothing left to reconcile (already applied, or nothing differs). Nothing changed.';
  end if;
  if not (v_candidates @> v_approved and v_approved @> v_candidates) then
    raise exception 'Rows needing reconciliation are % but the approved list is %. Re-run STEP 1 and review again. Nothing changed.', v_candidates, v_approved;
  end if;
  if exists (select 1 from _reconcile where source_project is distinct from v_ga) then
    raise exception 'A source row is not in the Great Auk project — needs review. Nothing changed.';
  end if;

  -- ---- fingerprints of everything that must NOT change -------------------
  select md5(coalesce(string_agg(concat_ws('|', exercise_id, completed, notes, student_label, updated_at, project_id), E'\n' order by exercise_id), ''))
    into v_anon_fp_before from public.exercise_progress where user_id = c_anon;
  select md5(coalesce(string_agg(concat_ws('|', exercise_id, completed, notes, student_label, updated_at, project_id), E'\n' order by exercise_id), ''))
    into v_other_fp_before from public.exercise_progress
   where user_id = c_real and exercise_id <> all (v_approved);
  select md5(coalesce(string_agg(concat_ws('|', user_id, exercise_id, completed, notes, student_label, updated_at, project_id), E'\n' order by user_id, exercise_id), ''))
    into v_users_fp_before from public.exercise_progress
   where user_id not in (c_anon, c_real);

  -- ---- apply ------------------------------------------------------------
  execute 'alter table public.exercise_progress disable trigger set_exercise_progress_updated_at';

  update public.exercise_progress r
     set completed  = s.completed,
         notes      = s.notes,
         updated_at = s.updated_at,
         project_id = v_ga
    from _reconcile s
   where s.op = 'update'
     and r.user_id = c_real
     and r.exercise_id = s.exercise_id
     and r.updated_at < s.updated_at;          -- never overwrite newer data
  get diagnostics v_updated = row_count;

  insert into public.exercise_progress (user_id, exercise_id, completed, notes, student_label, updated_at, project_id)
  select c_real, s.exercise_id, s.completed, s.notes, c_label, s.updated_at, v_ga
    from _reconcile s
   where s.op = 'insert'
  on conflict (user_id, exercise_id) do nothing;
  get diagnostics v_inserted = row_count;

  execute 'alter table public.exercise_progress enable trigger set_exercise_progress_updated_at';

  -- ---- verify inside the transaction; any failure undoes everything -------
  if v_updated + v_inserted <> cardinality(v_approved) then
    raise exception 'Expected % change(s), made % update(s) + % insert(s). Rolled back.', cardinality(v_approved), v_updated, v_inserted;
  end if;

  select md5(coalesce(string_agg(concat_ws('|', exercise_id, completed, notes, student_label, updated_at, project_id), E'\n' order by exercise_id), ''))
    into v_anon_fp_after from public.exercise_progress where user_id = c_anon;
  if v_anon_fp_after <> v_anon_fp_before then
    raise exception 'Anonymous rows changed — must never happen. Rolled back.';
  end if;
  select md5(coalesce(string_agg(concat_ws('|', exercise_id, completed, notes, student_label, updated_at, project_id), E'\n' order by exercise_id), ''))
    into v_other_fp_after from public.exercise_progress
   where user_id = c_real and exercise_id <> all (v_approved);
  if v_other_fp_after <> v_other_fp_before then
    raise exception 'A real-account row outside the approved list changed. Rolled back.';
  end if;
  select md5(coalesce(string_agg(concat_ws('|', user_id, exercise_id, completed, notes, student_label, updated_at, project_id), E'\n' order by user_id, exercise_id), ''))
    into v_users_fp_after from public.exercise_progress
   where user_id not in (c_anon, c_real);
  if v_users_fp_after <> v_users_fp_before then
    raise exception 'Another user''s rows changed. Rolled back.';
  end if;

  -- Nothing may still need carrying over, and every approved row must now
  -- match its source exactly, timestamp included. (A real-account row that
  -- is legitimately newer is left alone and not counted.)
  select count(*) into v_remaining
    from public.exercise_progress a
    left join public.exercise_progress r on r.user_id = c_real and r.exercise_id = a.exercise_id
   where a.user_id = c_anon
     and ( r.exercise_id is null
           or ( not (a.completed is not distinct from r.completed and a.notes is not distinct from r.notes)
                and a.updated_at > r.updated_at )
           or ( a.exercise_id = any (v_approved)
                and not (a.completed is not distinct from r.completed
                         and a.notes is not distinct from r.notes
                         and a.updated_at = r.updated_at
                         and r.project_id = v_ga) ) );
  if v_remaining <> 0 then
    raise exception '% exercise(s) still differ after reconciling. Rolled back.', v_remaining;
  end if;

  if not exists (select 1 from pg_trigger
                  where tgname = 'set_exercise_progress_updated_at'
                    and tgrelid = 'public.exercise_progress'::regclass
                    and tgenabled = 'O') then
    raise exception 'Timestamp trigger is not re-enabled. Rolled back.';
  end if;

  raise notice 'Reconciled % exercise(s): % updated, % inserted: %', cardinality(v_approved), v_updated, v_inserted, v_approved;
end
$$;


-- ----------------------------------------------------------------------------
-- STEP 4 (READ-ONLY): confirm the result.
-- ----------------------------------------------------------------------------

-- 4a. The approved exercises, side by side: expect identical completed,
--     notes and updated_at on both sides, real-account project great-auk.
select a.exercise_id,
       a.completed  = r.completed  as completed_same,
       a.notes      = r.notes      as notes_same,
       a.updated_at = r.updated_at as timestamp_preserved,
       (select slug from public.projects where id = r.project_id) as real_account_project,
       r.student_label
from public.exercise_progress a
join public.exercise_progress r
  on r.user_id = 'b83f6452-6183-41aa-b22f-f061ccbd0cf2' and r.exercise_id = a.exercise_id
where a.user_id = 'd303c036-37ce-4723-876d-c207c706cf5c'
  and a.exercise_id = any ('{REPLACE_WITH_APPROVED_EXERCISE_IDS}'::text[])
order by a.exercise_id;

-- 4b. Re-run query 2 of verify_luigi_before_deploy.sql: expect a single line,
--     "none — identical", with every exercise counted, and queries 3 and 4
--     returning no rows.

-- 4c. The timestamp trigger is enabled again (expect one row, tgenabled = 'O').
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.exercise_progress'::regclass
  and tgname = 'set_exercise_progress_updated_at';
