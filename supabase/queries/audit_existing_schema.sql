-- ============================================================================
-- audit_existing_schema.sql
--
-- READ-ONLY. This is the query that produced 0001's "CONFIRMED CURRENT
-- STATE" comment block — kept here as a durable, re-runnable record, and in
-- case the live schema changes again before 0001 is actually applied.
-- Everything about exercise_progress and instructors prior to this branch
-- was set up ad hoc in the SQL editor across several earlier sessions,
-- never version-controlled; this query is what replaced an earlier,
-- reconstructed-from-history guess with the real, confirmed structure.
--
-- If re-running this ever shows something different from what 0001's
-- "CONFIRMED CURRENT STATE" comment currently says, fix 0001 to match
-- reality before applying it, not after.
-- ============================================================================

-- 1. RLS policies currently defined on the two existing tables — exact
--    names, commands, roles, and expressions.
select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename in ('exercise_progress', 'instructors')
order by tablename, policyname;


-- 2. Table-level grants. Separate from RLS, and the earlier "permission
--    denied for table instructors" incident showed both matter.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('exercise_progress', 'instructors')
order by table_name, grantee, privilege_type;


-- 3. Triggers on both tables (excluding Postgres-internal ones used for
--    constraint enforcement), with their full definitions.
select
  c.relname               as table_name,
  t.tgname                as trigger_name,
  t.tgenabled,
  pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relname in ('exercise_progress', 'instructors')
  and not t.tgisinternal
order by table_name, trigger_name;


-- 4. Column definitions — types, nullability, defaults — compared directly
--    against the assumed schema in 0001's header comment.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('exercise_progress', 'instructors')
order by table_name, ordinal_position;


-- 5. Constraints (primary key, unique, foreign key) on both tables.
select
  tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
 and kcu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name in ('exercise_progress', 'instructors')
order by tc.table_name, tc.constraint_type;
