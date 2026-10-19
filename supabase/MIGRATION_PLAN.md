# Multi-user platform migration plan

Status: **draft, nothing applied**. This document describes what the migration files in this branch
do and how the account migration and app-code changes would proceed once reviewed and approved.
Nothing in this document has been run against the live database or deployed to GitHub Pages.

## 0. Security review fixes applied in this revision

A review of the first version of this package (commit `2de2754`) found seven issues, all addressed
below. If you're re-reading this plan after the first pass, this section is the delta:

1. **Recursive RLS** — policies on `profiles` querying `profiles`, and a policy on
   `project_memberships` querying `project_memberships`, from within their own `USING` clauses.
   Replaced with `SECURITY DEFINER` helper functions (pinned `search_path`, least-privilege `EXECUTE`
   grants) — see section 1a.
2. **Privilege escalation** — the original "Users can update own profile" policy let a student set
   their own `role` to `'admin'`, since `USING`/`WITH CHECK` only restrict which *row*, never which
   *column*. Fixed with a column-level `GRANT` restricting self-service updates to `display_name`
   only — enforced by Postgres independently of, and prior to, RLS. See section 1a.
3. **Backward compatibility** — the original `NOT NULL project_id` column had no default, which
   would have broken every write from the still-unmodified live sync adapter (it doesn't send
   `project_id`). Fixed with a `SECURITY DEFINER` default function so legacy inserts keep working
   unchanged during the transition. See section 3.
4. **Migration copy safety** — the original copy script used a blanket
   `DISABLE TRIGGER USER` (disables *everything*, not just whatever might touch `updated_at`) and a
   silent `ON CONFLICT ... DO NOTHING` (would silently skip rows without any visible sign). Replaced
   with an inspect-first, fail-loud approach. See section 2.
5. **Account identity / `student_label`** — found that Luigi's 21 genuine Module 00 rows have a
   **NULL** `student_label` (they predate that column existing at all). This is a real, currently-live
   gap: `supervisor.js` on `main` today filters on `student_label = 'Luigi'` exactly, so it is
   silently missing those 21 rows right now, in production — not just a migration concern. See
   section 4a.
6. **RLS tests** — `queries/rls_tests.sql` added, proving (not just asserting) the four required
   guarantees directly against the real policies.
7. **Legacy policy audit** — `queries/audit_existing_schema.sql` added: a read-only inspection of the
   actual live policies/grants/triggers/columns, since the "ASSUMED CURRENT STATE" in `0001` was
   reconstructed from project history, not from direct inspection.

## 1. What the schema migration adds

- `profiles` — one row per `auth.users` row: `display_name`, `role` (`student` / `teacher` / `admin`).
  Auto-created for every new signup (including anonymous ones) via an `on_auth_user_created` trigger.
- `projects` — the set of courses hosted on this platform. Seeded with `great-auk` and `thylacine-rna`.
- `project_memberships` — who belongs to which project, as a `student` or `teacher`.
- `exercise_progress.project_id` — new column, backfilled to the Great Auk project for every existing
  row, defaulted (via a function, not a bare constant) to the same project for any future legacy
  insert that omits it, then made `not null`.
- A set of `SECURITY DEFINER` helper functions (`is_admin`, `_is_teacher_for_project`,
  `_is_student_in_project`, `is_teacher_of_student_in_project`,
  `shares_any_project_as_teacher_student`, `default_great_auk_project_id`) that every policy below
  calls into, instead of any policy querying its own table (or another RLS-protected table) directly
  from within its own check. See section 1a for the full reasoning and the exact privilege model.
- A new, **additive** teacher-read policy on `exercise_progress`, scoped to only the students who
  share a project with that teacher — this is what satisfies "teachers can only access students
  belonging to their assigned projects."
- A new admin-read policy, unconditional, on `profiles`, `projects`, `project_memberships`, and
  `exercise_progress` — this is what satisfies "the administrator can access everything."

Nothing existing is renamed, dropped, or altered in place except the one `alter table ... add
column` / backfill / `set not null` sequence on `exercise_progress`, which only adds a column and
fills it in — no existing column, row, or policy is touched.

## 1a. Why helper functions, and the exact privilege model

Postgres does not infinite-loop on a policy that queries its own table from within itself, but it is
a well-documented anti-pattern (and Supabase's own documented recommendation is to avoid it): the
policy's correctness ends up depending on *other* policies on that same table being exactly right,
forever, and each check becomes a nested RLS-evaluated query rather than a single predictable lookup.
Both self-references found in the first version (`profiles` admin-check querying `profiles`;
`project_memberships` teacher-check querying `project_memberships`) are fixed by moving the lookup
into a `SECURITY DEFINER` function instead, which runs with the function owner's privileges and so
bypasses the *caller's* RLS for this one, narrow, read-only check — never for anything else.

Every function applies the same security properties:

- `security definer`, so the lookup bypasses the caller's own RLS (the entire point).
- `set search_path = public, pg_temp` on every one — without a pinned search path, a caller could
  define an object earlier in their own search path that shadows an unqualified identifier inside the
  function, and have *this* function's elevated privileges execute attacker-influenced code. Every
  identifier inside is also schema-qualified (`public.profiles`, never bare `profiles`) as a second,
  redundant layer of the same protection.
- **Ownership**: created by whatever role runs the SQL editor (typically the project's
  postgres/owner role) — that owner's privileges are what the bypass actually grants. Don't recreate
  these as a lower-privileged role, or the bypass stops working.
- `EXECUTE` revoked from `public`, granted only to `authenticated` (never `anon` — not used by this
  app; every real session here, including anonymous sign-ins, already carries role `authenticated`).
- The two lowest-level checks (`is_admin`, `_is_teacher_for_project`) only ever answer a question
  about the *caller* (`auth.uid()`) — they take no "which user" argument, so there's nothing to probe
  about anyone else by calling them directly.
- `_is_student_in_project` **does** answer a question about another, specific user (needed for "is
  this other `user_id` a student in a project I teach"). This one is deliberately **not** granted
  `EXECUTE` to `authenticated` at all — it's only ever called from inside the two combined functions
  below it, which run under the same definer privileges and so can call it internally regardless, but
  no client session can invoke it directly to enumerate arbitrary users' enrollment one at a time.
  Only the already-authorization-scoped combined functions
  (`is_teacher_of_student_in_project`, `shares_any_project_as_teacher_student`) are exposed.

This is a stricter design than the review strictly asked for (it only named the recursion problem),
but it's the natural extension of the same fix: once you're routing authorization checks through
functions anyway, it costs nothing extra to also close the "enumerate arbitrary users via a
directly-callable function" gap, so it's included here rather than left for later.

## 2. Transferring Luigi's progress to a permanent account

**Decided: create a new, separate permanent account and copy his 25 confirmed-genuine records
across, rather than upgrading his existing anonymous session in place.**

Investigation established that all 25 genuine records (Module 00: 21 completed; Module 01: 4 with
written answers, 3 completed, one — Exercise 04 — genuine but not marked complete) belong to a single
identity, `d303c036-37ce-4723-876d-c207c706cf5c`. The other identities found along the way
(`4c7e0f1a…`, `5b9feb4e…`, and the three from early October) were either empty or test pollution from
automated regression testing, not additional genuine work.

Sequencing, each step gated on the one before it:

1. Run `queries/audit_existing_schema.sql` (read-only) and reconcile its output against `0001`'s
   "ASSUMED CURRENT STATE" comment before trusting it.
2. Apply `migrations/0001_multi_user_platform.sql` (profiles/projects/project_memberships/
   `project_id`/helper functions).
3. Create Luigi's new permanent account via the Supabase Dashboard (Authentication → Users → Add
   user — the same method already used for the instructor account; not SQL, since `auth.users` is
   managed by Supabase Auth itself, not something to insert into directly).
4. Run `queries/setup_luigi_profile_membership.sql` (sets his real display name, enrolls him in the
   Great Auk project) — the account's `profiles` row already exists by this point, created
   automatically by the new trigger.
5. Run `queries/migrate_luigi_copy.sql`'s STEP 0 and STEP 1 (both read-only) and read their output.
   STEP 0 checks whether any trigger would interfere with the preserved timestamps; STEP 1 confirms
   the destination has no pre-existing conflicting rows. Only then run STEP 2, the actual copy —
   copies (does not move) all 25 rows from `d303c036-37ce-4723-876d-c207c706cf5c`, keyed on `user_id`
   only (not `student_label` — see section 4a for why that matters), preserving `completed`, `notes`,
   and `updated_at` exactly. The original rows are untouched.
6. Run `queries/verify_luigi_migration.sql` — row count, a full field-by-field comparison, and an
   explicit check on the Exercise 04 genuine-but-incomplete case.
7. Only once (6) passes AND Luigi has logged into the new account on the live, tested app and
   confirmed his progress/notes appear correctly: run
   `queries/relabel_and_retire_luigi_anonymous.sql`, which relabels the copy to `"Luigi"` and retires
   (relabels, does not delete) the original anonymous rows out of that grouping.

The copied rows are deliberately given a distinct transitional label rather than `"Luigi"` — see
section 4a below for why.

**Why a copy instead of the in-place upgrade originally proposed:** the in-place approach (calling
`supabase.auth.updateUser({ email, password })` on an already-signed-in anonymous session) is still
technically the simpler operation when it applies cleanly, but the explicit new-account path keeps
the original anonymous rows completely inert and untouched throughout testing — preserved exactly as
required, with no fallback-less single identity being converted in place while you're still testing
whether the new login flow actually works.

**On the copy's safety (revised):** the previous version wrapped STEP 2 in a blanket
`DISABLE TRIGGER USER`, which would have silently disabled *any* trigger on the table, not just one
that happens to touch `updated_at` — too broad a tool for a problem that might not even exist. It
also used `ON CONFLICT ... DO NOTHING`, which would silently skip a row that happened to already
exist at the destination, with no visible sign anything was skipped. Both are fixed: STEP 0 tells you
definitively, by reading the trigger's actual definition, whether disabling anything is even
necessary (and names the one trigger to disable, surgically, if so — never all of them); STEP 1
checks in advance, read-only, whether a conflict would occur; and STEP 2 itself has no
`ON CONFLICT` clause at all, so a real conflict (which should never legitimately happen against a
brand-new account) fails loudly with a constraint-violation error instead of silently vanishing.

## 3. Backward compatibility: the live site must keep working during the transition

The original `project_id` column was `NOT NULL` with no default — once applied, any insert that
doesn't supply it (which is exactly what `sync-adapter.js` does today; it has no concept of
`project_id` at all) would fail outright. Since updating `sync-adapter.js` to be project-aware is
explicitly a *later*, separate step (see section 5), applying the original migration first would have
broken Luigi's live saves in the gap between the two.

Fixed with a `SECURITY DEFINER` default function, `default_great_auk_project_id()`, used as the
column's `DEFAULT` instead of a bare value. A plain (non-definer) default resolving `SELECT id FROM
projects WHERE slug = 'great-auk'` would run under the *inserting session's own* privileges — and a
session with no `project_memberships` row yet (every current anonymous session, and every brand-new
account before enrollment) sees zero rows under the "Members can read their own projects" policy on
`projects`, so the default would resolve to `NULL` and the `NOT NULL` constraint would fail anyway,
defeating the purpose. The `SECURITY DEFINER` function bypasses exactly that, resolving the Great Auk
project's id reliably regardless of the inserting session's own enrollment state. The column stays
`NOT NULL` — it's just never actually `NULL` by omission anymore, legacy or otherwise.

## 4. Making localStorage user-specific

Today, `storage.js`'s `STORAGE_KEYS` are flat, global strings (`greatauk_exercise_completion_v1`,
`greatauk_exercise_notes_v1`) with no account scoping at all — fine while there was exactly one
(invisible, anonymous) identity per browser, but not once real, nameable accounts can share a machine
(e.g. a shared lab computer, or Luigi testing on a machine he also uses for something else).

**Proposed fix, confined entirely to `sync-adapter.js`** (no change needed to `storage.js` or
`progress.js`, preserving the existing adapter-pattern boundary): `HybridAdapter.read`/`write` would
suffix every key with the current session's `user_id` before delegating to the underlying
`LocalStorageAdapter` — e.g. `greatauk_exercise_completion_v1::<user_id>` — rather than changing the
constants in `storage.js` itself, which stay exactly as they are today.

This also surfaces a new requirement that doesn't exist today, because Luigi never logs in or out:
once real accounts exist, **both login and logout need to force a full page reload**, not just an
in-memory state swap. `sync-adapter.js` currently memoizes `sessionPromise`/`loadPromise`/
`mergedState` at the module level for the lifetime of a page load; switching the signed-in user
without reloading would leave stale cached state around from the previous account. A full reload
sidesteps that entire class of bug rather than requiring careful manual resets of that state.

**Specifically for Luigi's own transition**: when he first signs into his new permanent account on
his usual browser, that browser's existing (unscoped) local cache still holds his anonymous
identity's data. This turns out not to be a problem in practice, by virtue of the copy already having
happened server-side first: `HybridAdapter`'s existing "Supabase has no rows yet → migrate up from
local" branch only triggers when Supabase is *empty* for that `user_id`; since the copy step above
runs before he ever logs in, Supabase will already be authoritative and non-empty the first time he
signs in, so his old anonymous local cache is simply overwritten with the correct (copied) data rather
than read from. The key-scoping change is still the right long-term fix — this just means Luigi's own
transition doesn't depend on it being done first.

## 4a. Identity: `user_id` + `project_memberships`, not `student_label`

**Found during this review, and important beyond just this migration**: Luigi's 21 genuine Module 00
rows have a **NULL** `student_label` — they predate that column/field being added to the write path
entirely (it was introduced partway through this project, after Module 00 was already built and
tested). `supervisor.js` as it exists on `main` **today** groups and displays rows by filtering
`student_label = 'Luigi'` exactly — meaning it is currently, silently, missing all 21 of those rows in
production. This is a live bug, not just a migration-era concern, though fixing it means touching app
code, which is out of scope for this SQL-only branch per your standing instructions. Flagging it here
so it's not lost, and recommending it be prioritized whenever `supervisor.js` is next touched,
independent of the rest of this migration's timeline.

**Going forward, the plan is to stop keying identity by `student_label` at all.** Once real accounts
exist, the correct, robust way to identify "which rows belong to which student" is by `user_id`,
joined to `profiles` (for display name) and `project_memberships` (for which project(s) they're
enrolled in) — never by a free-text column the app happened to write inconsistently. `student_label`
stays in the table, untouched, as inert historical metadata — useful for a human skimming old rows,
never read by any future app code or policy.

This also explains why `migrate_luigi_copy.sql`'s copy is keyed on `user_id` only (never filtered by
`student_label`) — it has to be, or the 21 NULL-labeled Module 00 rows would be silently left behind,
repeating the exact gap this section just described.

**Avoiding a duplicate "Luigi" in the supervisor view during the transition** (unchanged from before):
the current supervisor view merges every row sharing a `student_label` into one logical student,
newest-`updated_at`-wins per exercise. A straight copy produces rows with *identical* `updated_at`
timestamps to the originals (deliberately preserved), so labeling the copy `"Luigi"` immediately would
make the merge logic's tie-break arbitrary, with no reliable way to tell which "version" you were
looking at while verifying the copy. The copied rows instead carry a distinct transitional label
(`"Luigi (migrated copy — pending verification)"`), so the supervisor view shows old and new side by
side during testing; only `relabel_and_retire_luigi_anonymous.sql`, once everything is verified,
relabels the copy to `"Luigi"` and retires the original out of that grouping.

## 5. Reusing supervisor auth for student login

The Supabase Auth mechanics in `supervisor.js` are already completely generic and directly reusable:
real email/password sign-in (`signInWithPassword`), `onAuthStateChange` wiring, a sign-out button, and
an error-display pattern for failed logins. None of that is instructor-specific.

The one part that **is** instructor-specific is the authorization check — `supervisor.js` currently
gates access by looking the signed-in user up in the `instructors` allowlist table. For students,
there's no equivalent gate needed in the same sense: any authenticated (non-anonymous) user with a
`profiles` row is already "a valid user" by construction (the new trigger creates that row
automatically on signup). What varies per-student is which `project_memberships` rows they hold,
which determines which project's modules/exercises they should see — not whether they're allowed in
at all.

Practical recommendation: factor the shared email/password login form (markup + submit handler +
sign-out button + error display) out of `supervisor.js` into one small reusable piece, since it's
about to be used in at least two real places, rather than duplicating that logic twice.

**Decided**: sign-in is mandatory for all students — anonymous auth stays enabled at the
database/project level (not disabled, as required), but the site's own front door will require a real
account going forward. This simplifies the future student-login implementation: no
anonymous/permanent coexistence logic is needed in the student-facing UI itself. Accounts and project
memberships continue to be managed directly in Supabase (Dashboard + SQL) rather than through a built
admin interface, for now.

## 6. Scope boundary: this step vs. the next step

This branch currently contains the schema migration, a prepared (not-yet-recommended-to-run) policy
retirement migration, read-only audit/identification/investigation queries, an RLS test script, the
Luigi account-migration scripts (profile/membership setup, copy, verify, relabel-and-retire), and this
plan. No application code (`js/*.js`, `*.html`) has been changed. Specifically **not** yet done,
pending your review:

- The `supervisor.js` NULL-`student_label` bug described in section 4a (currently live on `main`,
  independent of this migration's timeline).
- `sync-adapter.js` changes (localStorage key scoping, `project_id`-aware upsert `onConflict` key,
  removing the hardcoded `student_label: "Luigi"`).
- A student login page/flow (mandatory, not optional — see section 5).
- `supervisor.js`/`supervisor.html` changes to become project-aware and to identify students by
  `user_id`/`project_memberships` rather than `student_label` (see section 4a).
- Any actual Thylacine RNA course content — the schema can host a second project, but building its
  modules/exercises is a separate, much larger content task, not part of this migration.

## 7. RLS review: do the three required guarantees actually hold?

- **"Students can only access their own progress."** Unchanged from today — the original
  `auth.uid() = user_id` policy on `exercise_progress` is untouched, for both read and write. Still
  holds. `queries/rls_tests.sql` TEST 2 proves this directly.
- **"Teachers only access their assigned projects."** Holds for the *new* policy added in `0001`
  (`"Teachers can read progress of their project's students"`), now routed through
  `is_teacher_of_student_in_project()`, which checks both a shared teacher-membership on the exact
  `project_id` of the row *and* the target user's own student-membership on that same project.
  `queries/rls_tests.sql` TEST 3/3b proves both the negative (unrelated student, denied) and positive
  (own project's student, allowed) cases. It does **not yet fully hold** as a platform-wide guarantee,
  because the *old* `instructors`-based policy still grants unconditional, unscoped read access to
  whoever is in the `instructors` table — see risk #2 below. Complete only once `0002` is run.
- **"The administrator can access everything."** Holds via the new unconditional admin-read policies,
  gated on `is_admin()`. `queries/rls_tests.sql` TEST 4 proves an admin can read a project they aren't
  a member of. Requires an actual `profiles` row with `role = 'admin'` to exist for whichever account
  should have that access — not created automatically for anyone; promoting an account is a manual
  `update profiles set role = 'admin' where user_id = '...'` after this migration is applied.
- **"Students cannot change their own role."** Not one of the original three, but explicitly tested
  anyway (`rls_tests.sql` TEST 1) since it was the privilege-escalation bug found in this review.

## 8. Risks and decisions to address before proceeding

1. **Anonymous auth also gets a `profiles` row now.** The new trigger fires for anonymous sign-ins too
   (Supabase doesn't distinguish at the trigger level), so every stray anonymous identity will
   accumulate a default `profiles` row (`role: 'student'`, `display_name: 'New user'`) the same way
   `exercise_progress` already accumulates stray rows today. Harmless, but worth knowing before you
   see them in the table.
2. **The old `instructors`-based "read everything" policy still exists and still works, and is not
   actually project-scoped.** `0002_retire_legacy_instructor_policy.sql` is prepared to retire it, but
   must only be run *after* confirming your own account has working read access through the new model
   (a `profiles` row with `role = 'admin'`, or a `project_memberships` row with `role = 'teacher'` for
   Great Auk) — running it first risks locking the current supervisor view out of its own data. It
   also depends on confirming the old policy's exact name first — `queries/audit_existing_schema.sql`
   confirms it directly, rather than relying on what's assumed in the file.
3. **Who enrolls whom.** `project_memberships` has no insert policy for students or teachers —
   enrollment is SQL-editor-only (by you) for now, confirmed acceptable for the initial rollout.
4. **`exercise_progress`'s upsert conflict key.** It's currently `(user_id, exercise_id)`. Once a
   second project exists, if its exercises ever reused an `exercise_id` string already used by Great
   Auk for the same user (unlikely given the existing `m0-ex01`-style prefixing convention, but not
   impossible), rows could collide. Recommend keeping distinct ID prefixes per project as the
   practical safeguard, and revisiting whether the conflict key should become `(user_id, project_id,
   exercise_id)` when the `sync-adapter.js` changes are actually implemented.
5. **The live `supervisor.js` NULL-`student_label` bug** (section 4a) exists independent of this
   migration and affects production right now. Worth prioritizing on its own timeline, not
   necessarily bundled with the rest of this rollout.
6. **Sequencing discipline matters more than usual here.** Each step in section 2 explicitly depends
   on the one before it having succeeded (audit → schema → account → profile/membership → inspect →
   copy → verify → only then relabel/retire). Running them out of order, or running the relabel/retire
   step before Luigi has actually tested the new account live, is the main way this could go wrong.
7. **The helper functions are a stricter design than the review literally asked for** (see section
   1a's closing note on `_is_student_in_project` not being directly callable) — flagging this as an
   explicit design choice made along the way, not something requested verbatim, in case it should be
   reconsidered.
