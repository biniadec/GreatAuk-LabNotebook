# Multi-user platform migration plan

Status: **draft, nothing applied**. This document describes what `0001_multi_user_platform.sql`
does and how the account migration and app-code changes would proceed once reviewed and approved.
Nothing in this document has been run against the live database or deployed to GitHub Pages.

## 1. What the schema migration adds

- `profiles` — one row per `auth.users` row: `display_name`, `role` (`student` / `teacher` / `admin`).
  Auto-created for every new signup (including anonymous ones) via an `on_auth_user_created` trigger.
- `projects` — the set of courses hosted on this platform. Seeded with `great-auk` and `thylacine-rna`.
- `project_memberships` — who belongs to which project, as a `student` or `teacher`.
- `exercise_progress.project_id` — new column, backfilled to the Great Auk project for every
  existing row, then made `not null` for all future rows.
- A new, **additive** teacher-read policy on `exercise_progress`, scoped to only the students who
  share a project with that teacher — this is what satisfies "teachers can only access students
  belonging to their assigned projects."
- A new admin-read policy, unconditional, on `profiles`, `projects`, `project_memberships`, and
  `exercise_progress` — this is what satisfies "the administrator can access everything."

Nothing existing is renamed, dropped, or altered in place except the one `alter table ... add
column` / backfill / `set not null` sequence on `exercise_progress`, which only adds a column and
fills it in — no existing column, row, or policy is touched.

## 2. Transferring Luigi's progress to a permanent account

**Decided (supersedes the in-place-upgrade recommendation originally proposed here): create a new,
separate permanent account and copy his 25 confirmed-genuine records across, rather than upgrading
his existing anonymous session in place.**

Investigation established that all 25 genuine records (Module 00: 21 completed; Module 01: 4 with
written answers, 3 completed, one — Exercise 04 — genuine but not marked complete) belong to a single
identity, `d303c036-37ce-4723-876d-c207c706cf5c`. The other identities found along the way
(`4c7e0f1a…`, `5b9feb4e…`, and the three from early October) were either empty or test pollution from
automated regression testing, not additional genuine work. Nothing from those needs preserving.

Sequencing, each step gated on the one before it:

1. Apply `migrations/0001_multi_user_platform.sql` (profiles/projects/project_memberships/`project_id`).
2. Create Luigi's new permanent account via the Supabase Dashboard (Authentication → Users → Add
   user — the same method already used for the instructor account; not SQL, since `auth.users` is
   managed by Supabase Auth itself, not something to insert into directly).
3. Run `queries/setup_luigi_profile_membership.sql` (sets his real display name, enrolls him in the
   Great Auk project) — the account's `profiles` row already exists by this point, created
   automatically by the new trigger.
4. Run `queries/migrate_luigi_copy.sql` — copies (does not move) all 25 rows from
   `d303c036-37ce-4723-876d-c207c706cf5c` to the new account's `user_id`, preserving `completed`,
   `notes`, and `updated_at` exactly. The original rows are untouched. See the file itself for the
   trigger-interference check that should be run first.
5. Run `queries/verify_luigi_migration.sql` — row count, a full field-by-field comparison, and an
   explicit check on the Exercise 04 genuine-but-incomplete case.
6. Only once (5) passes AND Luigi has logged into the new account on the live, tested app and
   confirmed his progress/notes appear correctly: run
   `queries/relabel_and_retire_luigi_anonymous.sql`, which relabels the copy to `"Luigi"` and retires
   (relabels, does not delete) the original anonymous rows out of that grouping.

The copied rows are deliberately given a distinct transitional label rather than `"Luigi"` —
see section 3a below for why.

**Why a copy instead of the in-place upgrade originally proposed:** the in-place approach (calling
`supabase.auth.updateUser({ email, password })` on an already-signed-in anonymous session) is still
technically the simpler operation when it applies cleanly, but you've chosen the explicit new-account
path instead, which has its own advantage here: it keeps the original anonymous rows completely
inert and untouched throughout testing (requirement to "preserve the original anonymous records
until the new account and website have been tested successfully"), rather than converting the one
identity you'd be testing against in place, with no separate fallback copy if something about the new
login flow doesn't work as expected.

## 3a. Avoiding a duplicate "Luigi" in the supervisor view during the transition

The supervisor view already merges every row sharing a `student_label` into one logical student,
newest-`updated_at`-wins per exercise, with older versions kept in an expandable reveal — this is
exactly the mechanism built for exactly this kind of duplicate-identity situation. The complication
here: a straight copy produces rows with **identical** `updated_at` timestamps to the originals (we're
deliberately preserving them exactly), so if the copies were labeled `"Luigi"` immediately, the merge
logic's tie-break between two identical timestamps would be arbitrary — there'd be no reliable way to
tell, while trying to verify the copy, which "version" you were actually looking at.

The fix used throughout the scripts above: the copied rows carry a distinct, obviously-transitional
label (`"Luigi (migrated copy — pending verification)"`) instead of `"Luigi"` during steps 4–5. The
supervisor view's identity picker will then show the original anonymous identity and the new copy as
two clearly separate, clearly named entries side by side — which is actually useful here, since it
lets you visually compare old vs. new in the same UI you'd normally use, rather than having them
silently merged where you couldn't confirm the copy worked. Only in step 6, once everything is
verified, does `relabel_and_retire_luigi_anonymous.sql` relabel the copy to `"Luigi"` and move the
original out of that grouping — at which point the supervisor view goes back to showing exactly one
"Luigi," cleanly, with no duplicate versions.

## 3. Making localStorage user-specific

Today, `storage.js`'s `STORAGE_KEYS` are flat, global strings (`greatauk_exercise_completion_v1`,
`greatauk_exercise_notes_v1`) with no account scoping at all — fine while there was exactly one
(invisible, anonymous) identity per browser, but not once real, nameable accounts can share a
machine (e.g. a shared lab computer, or Luigi testing on a machine he also uses for something else).

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
sidesteps that entire class of bug rather than requiring careful manual resets of that state, and
matches how most web apps already handle account switches.

**Specifically for Luigi's own transition**: when he first signs into his new permanent account on
his usual browser, that browser's existing (unscoped) local cache still holds his anonymous
identity's data. This turns out not to be a problem in practice, by virtue of the copy already having
happened server-side first: `HybridAdapter`'s existing "Supabase has no rows yet → migrate up from
local" branch only triggers when Supabase is *empty* for that `user_id`; since step 4 above copies his
25 rows to the new account before he ever logs in, Supabase will already be authoritative and non-empty
the first time he signs in, so his old anonymous local cache is simply overwritten with the correct
(copied) data rather than read from. The key-scoping change is still the right long-term fix — this
just means Luigi's own transition doesn't depend on it being done first.

## 4. Reusing supervisor auth for student login

The Supabase Auth mechanics in `supervisor.js` are already completely generic and directly reusable:
real email/password sign-in (`signInWithPassword`), `onAuthStateChange` wiring, a sign-out button,
and an error-display pattern for failed logins. None of that is instructor-specific.

The one part that **is** instructor-specific is the authorization check — `supervisor.js` currently
gates access by looking the signed-in user up in the `instructors` allowlist table. For students,
there's no equivalent gate needed in the same sense: any authenticated (non-anonymous) user with a
`profiles` row is already "a valid user" by construction (the new trigger creates that row
automatically on signup). What varies per-student is which `project_memberships` rows they hold,
which determines which project's modules/exercises they should see — not whether they're allowed in
at all.

Practical recommendation: factor the shared email/password login form (markup + submit handler +
sign-out button + error display) out of `supervisor.js` into one small reusable piece, since it's
about to be used in at least two real places (the supervisor view and the future student login),
rather than duplicating that logic twice.

**Decided**: sign-in is mandatory for all students (not the optional-upgrade alternative this section
originally raised as an open question) — anonymous auth stays enabled at the database/project level
(not disabled, as required), but the site's own front door will require a real account going forward.
This simplifies the future student-login implementation: no anonymous/permanent coexistence logic is
needed in the student-facing UI itself, since every session is expected to be a real, logged-in
account from that point on. Accounts and project memberships continue to be managed directly in
Supabase (Dashboard + SQL) rather than through a built admin interface, for now.

## 5. Scope boundary: this step vs. the next step

This branch currently contains the schema migration, a prepared (not-yet-recommended-to-run) policy
retirement migration, the read-only identification/investigation queries, the Luigi account-migration
scripts (profile/membership setup, copy, verify, relabel-and-retire), and this plan. No application
code (`js/*.js`, `*.html`) has been changed. Specifically **not** yet done, pending your review:

- `sync-adapter.js` changes (localStorage key scoping, `project_id`-aware upsert `onConflict` key,
  removing the hardcoded `student_label: "Luigi"`).
- A student login page/flow (now known to be mandatory, not optional — see section 4).
- `supervisor.js`/`supervisor.html` changes to become project-aware (currently it assumes a single
  project and a single student unconditionally).
- Any actual Thylacine RNA course content — the schema can host a second project, but building its
  modules/exercises is a separate, much larger content task, not part of this migration.

## 5a. RLS review: do the three required guarantees actually hold?

- **"Students can only access their own progress."** Unchanged from today — the original
  `auth.uid() = user_id` policy on `exercise_progress` is untouched by this migration, for both read
  and write. Still holds.
- **"Teachers only access their assigned projects."** Holds for the *new* policy added in `0001`
  (`"Teachers can read progress of their project's students"`), which joins through
  `project_memberships` on a matching `project_id` on both sides. It does **not yet fully hold** as a
  platform-wide guarantee, because the *old* `instructors`-based policy from before this migration
  still grants unconditional, unscoped read access to whoever is in the `instructors` table — see risk
  #2 below. The guarantee becomes complete only once `0002` is run, after your own access is confirmed
  under the new model.
- **"The administrator can access everything."** Holds via the new unconditional admin-read policies
  on `profiles`, `projects`, `project_memberships`, and `exercise_progress`, gated on
  `profiles.role = 'admin'`. Requires an actual `profiles` row with `role = 'admin'` to exist for
  whichever account should have that access — not created automatically for anyone (the trigger
  defaults every new signup to `role: 'student'`); promoting an account to admin is a manual
  `update profiles set role = 'admin' where user_id = '...'` after this migration is applied.

## 6. Risks and decisions to address before proceeding

1. **Anonymous auth also gets a `profiles` row now.** The new trigger fires for anonymous sign-ins
   too (Supabase doesn't distinguish at the trigger level), so every stray anonymous identity will
   accumulate a default `profiles` row (`role: 'student'`, `display_name: 'New user'`) the same way
   `exercise_progress` already accumulates stray rows today. Harmless, but worth knowing before you
   see them in the table.
2. **The old `instructors`-based "read everything" policy still exists and still works, and is not
   actually project-scoped.** `0002_retire_legacy_instructor_policy.sql` is prepared to retire it, but
   must only be run *after* confirming your own account has working read access through the new
   model (a `profiles` row with `role = 'admin'`, or a `project_memberships` row with `role =
   'teacher'` for Great Auk) — running it first risks locking the current supervisor view out of its
   own data. It also depends on confirming the old policy's exact name first (query included in that
   file) — it was never saved from when it was originally created in an earlier, ad hoc SQL-editor
   session.
3. **Who enrolls whom.** `project_memberships` has no insert policy for students or teachers —
   enrollment is SQL-editor-only (by you) for now, confirmed acceptable for the initial rollout.
4. **`exercise_progress`'s upsert conflict key.** It's currently `(user_id, exercise_id)`. Once a
   second project exists, if its exercises ever reused an `exercise_id` string already used by Great
   Auk for the same user (unlikely given the existing `m0-ex01`-style prefixing convention, but not
   impossible), rows could collide. Recommend keeping distinct ID prefixes per project as the
   practical safeguard, and revisiting whether the conflict key should become `(user_id, project_id,
   exercise_id)` when the `sync-adapter.js` changes are actually implemented.
5. **Trigger interference with preserved timestamps.** The copy script's `ALTER TABLE ... DISABLE/
   ENABLE TRIGGER USER` guards against an `updated_at`-setting trigger firing on `INSERT` and
   overwriting the preserved timestamps — but whether such a trigger even exists wasn't re-confirmed
   in this investigation (it predates any version-controlled migration). `migrate_luigi_copy.sql`'s
   Step 0 query checks this before the copy runs; read its result before proceeding to Step 1.
6. **Sequencing discipline matters more than usual here.** Each script in section 2 explicitly
   depends on the one before it having succeeded (schema → account → profile/membership → copy →
   verify → only then relabel/retire). Running them out of order, or running the relabel/retire step
   before Luigi has actually tested the new account live, is the main way this could go wrong.
