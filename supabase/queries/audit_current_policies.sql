-- ============================================================================
-- audit_current_policies.sql
--
-- READ-ONLY. Run this before deciding on 0002. It supersedes
-- audit_existing_schema.sql for the policy question specifically:
-- audit_existing_schema.sql was run BEFORE 0001 was applied and only ever
-- covered exercise_progress/instructors; this covers all four tables as
-- they actually stand right now, post-0001, so the review of "could
-- anything else bypass project isolation" (requirement 3) is based on the
-- real, current policy set, not on what the migration files say they
-- created (which is a claim about intent, not a confirmed fact about the
-- live database).
--
-- Nothing here writes anything. Safe to run any number of times.
-- ============================================================================

-- 1. Every RLS policy on all four platform tables — exact name, command,
--    permissive/restrictive, and the actual USING/WITH CHECK expressions.
--    This is the real inventory requirement 3 asks for: read it looking for
--    any permissive policy whose USING clause does NOT narrow by project
--    (directly or via a helper function) and is not one of the two
--    deliberate, documented exceptions (a user reading their own row;
--    is_admin(), which is an intentional unconditional bypass, not a flaw).
select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename in ('exercise_progress', 'instructors', 'profiles', 'projects', 'project_memberships')
order by tablename, cmd, policyname;


-- 2. Table-level grants on all four tables — RLS policies only matter if
--    the underlying GRANT exists at all; this is the other half of "could
--    something bypass project isolation" (a stray broad grant would matter
--    even if every policy above looks correctly scoped).
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('exercise_progress', 'instructors', 'profiles', 'projects', 'project_memberships')
order by table_name, grantee, privilege_type;


-- 3. Every row currently in the `instructors` allowlist table — i.e.
--    exactly which account(s) the legacy policy 0002 retires currently
--    grants unconditional, unscoped read access to. Documents, before the
--    drop, who (if anyone) is actually relying on it today.
select user_id from public.instructors;


-- 4. Cross-check: does your current administrator account's profiles.role
--    already independently grant it the same read access the legacy
--    instructors-table policy provides? If this returns 'admin', your
--    account's read access comes from the NEW policy
--    ("Admins can read all progress rows", gated on is_admin()) regardless
--    of whether it also happens to be listed in `instructors` — i.e.
--    dropping the legacy policy removes nothing you actually depend on.
select user_id, display_name, role
from public.profiles
where user_id in (select user_id from public.instructors);


-- 5. Every SECURITY DEFINER function this platform relies on for RLS, with
--    its owner and whether search_path is actually pinned (the specific
--    protection reviewed when these were written) — a quick confirmation
--    that nothing about them has drifted since 0001 was applied.
select
  p.proname as function_name,
  r.rolname as owner,
  p.prosecdef as is_security_definer,
  p.proconfig as config_settings  -- should show search_path=public,pg_temp for each
from pg_proc p
join pg_roles r on r.oid = p.proowner
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_admin', '_is_teacher_for_project', '_is_student_in_project',
    'is_teacher_of_student_in_project', 'shares_any_project_as_teacher_student',
    'is_student_for_project', 'has_any_project_membership',
    'default_great_auk_project_id', 'handle_new_user'
  )
order by p.proname;
