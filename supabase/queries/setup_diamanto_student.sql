-- ============================================================================
-- setup_diamanto_student.sql
--
-- NOT YET RUN. Prepared for approval only.
--
-- Enrolls Diamanto as a STUDENT of the Thylacine RNA project only — no
-- Great Auk access, not a teacher, not an administrator. Same pattern as
-- setup_emilio_teacher.sql, for a student.
--
-- When: only AFTER the HoloBase platform has been deployed AND Luigi's
-- existing account and progress have been verified on the live site.
--
-- Before running:
--   1. Create her Supabase Auth account: Dashboard > Authentication > Users
--      > Add user, with her email and a password you set (tick "Auto Confirm
--      User"), then relay the password to her directly. Not "Invite user":
--      Microsoft Safe Links consumes one-time email links before the person
--      clicks them (MIGRATION_PLAN.md section 10), and the code-entry
--      alternative needs custom SMTP first (section 11). This step is an
--      Auth action, not SQL — this script never touches auth.users.
--   2. Copy her new user UUID from the Users list.
--   3. Replace '<DIAMANTO_USER_ID>' everywhere below (4 places) with it.
--      If any placeholder is left, the uuid cast fails and nothing changes.
--
-- Safety: the DO block checks first and RAISES (changing nothing) unless
-- the UUID belongs to a brand-new, real (non-anonymous) account whose
-- profile role is 'student', that has NO saved progress and NO membership
-- other than an existing Thylacine student one. So pasting someone else's
-- UUID — Luigi's, a teacher's, an admin's — stops the script. Re-running it
-- for Diamanto after success is harmless.
--
-- It sets her display name, adds one Thylacine RNA student membership, and
-- nothing else: it does not touch exercise_progress, does not change her
-- role, and does not grant Great Auk access.
-- ============================================================================

do $$
declare
  v_user          uuid := '<DIAMANTO_USER_ID>'::uuid;
  v_thylacine     uuid;
  v_is_anonymous  boolean;
  v_role          text;
begin
  select id into v_thylacine from public.projects where slug = 'thylacine-rna';
  if v_thylacine is null then
    raise exception 'Project thylacine-rna not found — nothing changed.';
  end if;

  select is_anonymous into v_is_anonymous from auth.users where id = v_user;
  if not found then
    raise exception 'No Auth account with id % — create it first (Add user). Nothing changed.', v_user;
  end if;
  if v_is_anonymous then
    raise exception 'Account % is anonymous, not a real account. Nothing changed.', v_user;
  end if;

  select role into v_role from public.profiles where user_id = v_user;
  if not found then
    raise exception 'No profiles row for % (the 0001 trigger should have created one). Nothing changed.', v_user;
  end if;
  if v_role <> 'student' then
    raise exception 'Account % has role %, not student — wrong UUID? Nothing changed.', v_user, v_role;
  end if;

  if exists (select 1 from public.exercise_progress where user_id = v_user) then
    raise exception 'Account % already has saved progress — not a new account, wrong UUID? Nothing changed.', v_user;
  end if;

  if exists (select 1 from public.project_memberships
              where user_id = v_user
                and not (project_id = v_thylacine and role = 'student')) then
    raise exception 'Account % already has another project membership — wrong UUID? Nothing changed.', v_user;
  end if;

  update public.profiles
     set display_name = 'Diamanto'
   where user_id = v_user;

  insert into public.project_memberships (project_id, user_id, role)
  values (v_thylacine, v_user, 'student')
  on conflict (project_id, user_id) do nothing;

  raise notice 'Diamanto (%) is set up as a Thylacine RNA student.', v_user;
end
$$;

-- ---- Verification (read-only) -----------------------------------------

-- Expect: display_name = 'Diamanto', role = 'student'.
select user_id, display_name, role
from public.profiles
where user_id = '<DIAMANTO_USER_ID>'::uuid;

-- Expect: exactly one row — thylacine-rna / student.
select p.slug, m.role
from public.project_memberships m
join public.projects p on p.id = m.project_id
where m.user_id = '<DIAMANTO_USER_ID>'::uuid;

-- Expect: ZERO rows. Anything here means Great Auk access she shouldn't have.
select 1
from public.project_memberships m
join public.projects p on p.id = m.project_id
where m.user_id = '<DIAMANTO_USER_ID>'::uuid
  and p.slug = 'great-auk';
