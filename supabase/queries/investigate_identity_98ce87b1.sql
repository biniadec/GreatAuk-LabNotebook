-- ============================================================================
-- investigate_identity_98ce87b1.sql
--
-- READ-ONLY. Does not insert, update, or delete anything.
--
-- Purpose: characterise the third anonymous identity found by
-- verify_luigi_before_deploy.sql (queries 3 and 4):
--   98ce87b1-68f8-4518-936a-bdf2b27ca4a7 — one row, m1-ex08, completed =
--   false, notes empty, student_label 'Luigi', 2026-10-20 19:28:43.844711+00.
--
-- Background (from the live site's code, main @ 71e1dae):
--   - Every page visit with no saved session calls signInAnonymously(), so
--     a new browser, private window, cleared storage — or arriving from an
--     email link, since the client ignores sessions in the URL
--     (detectSessionInUrl: false) — creates a new anonymous identity.
--   - Every row any visitor saves is labelled 'Luigi' (hardcoded), so the
--     label does not identify the person.
--   - A row is written only when a checkbox or answer changes, or once per
--     browser when old local data is uploaded. completed = false with an
--     empty answer is what ticking-then-unticking, or typing-then-deleting,
--     leaves behind.
--   - Timing: 37 seconds after this row was saved (19:29:20 UTC), Binia
--     reported that the Supabase invite test link had redirected to the
--     LIVE site (https://biniadec.github.io/GreatAuk-LabNotebook/) and
--     failed with otp_expired — a visit that would create a new anonymous
--     identity. The alternative is Luigi using another browser or device.
--
-- Run each numbered query on its own. Queries A and C answer "when and from
-- what kind of browser"; D confirms neither of Luigi's identities has this
-- exercise; E shows what the invite test did in Auth at the same minute.
-- ============================================================================


-- A. The identity itself: when it was created and last signed in.
select id, is_anonymous, created_at, last_sign_in_at
from auth.users
where id = '98ce87b1-68f8-4518-936a-bdf2b27ca4a7';


-- B. Everything it ever saved (any date).
select exercise_id, completed, notes, student_label, updated_at,
       (select slug from public.projects where id = project_id) as project
from public.exercise_progress
where user_id = '98ce87b1-68f8-4518-936a-bdf2b27ca4a7'
order by updated_at;


-- C. Which kind of browser it used (browser/OS string only; IP addresses are
--    deliberately not selected). Compare with your own browser's user agent,
--    shown at e.g. https://www.whatismybrowser.com, or with Luigi's device.
--    If this errors with "column user_agent does not exist", skip it.
select created_at, updated_at, user_agent
from auth.sessions
where user_id = '98ce87b1-68f8-4518-936a-bdf2b27ca4a7'
order by created_at;


-- D. Does exercise m1-ex08 exist in either of Luigi's identities?
--    (Expected: no rows — query 2 of verify_luigi_before_deploy.sql showed
--    no "only in the real account" rows and no m1-ex08 under d303c036.)
select user_id, exercise_id, completed, notes, updated_at
from public.exercise_progress
where exercise_id = 'm1-ex08'
  and user_id in ('d303c036-37ce-4723-876d-c207c706cf5c',
                  'b83f6452-6183-41aa-b22f-f061ccbd0cf2');


-- E. Auth activity in the same window (the invite test): accounts invited,
--    created or signed in between 19:00 and 19:45 UTC on 2026-10-20.
select id, email, is_anonymous, invited_at, created_at, last_sign_in_at
from auth.users
where invited_at      between timestamptz '2026-10-20 19:00+00' and timestamptz '2026-10-20 19:45+00'
   or created_at      between timestamptz '2026-10-20 19:00+00' and timestamptz '2026-10-20 19:45+00'
   or last_sign_in_at between timestamptz '2026-10-20 19:00+00' and timestamptz '2026-10-20 19:45+00'
order by created_at;
