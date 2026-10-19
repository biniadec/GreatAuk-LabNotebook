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

**Recommended approach: upgrade his existing anonymous identity in place, not a data copy.**

Supabase Auth supports converting an already-signed-in anonymous session directly into a permanent
one, by calling (from the browser, while his existing anonymous session is active):

```js
await supabase.auth.updateUser({ email: "luigi@...", password: "..." });
```

This keeps the exact same `auth.users.id` — it does not create a new user and move data across. His
`exercise_progress` rows already reference that `user_id`, so **zero rows need to be touched**. No
`UPDATE`, no risk of violating the `(user_id, exercise_id)` uniqueness constraint, no risk of
overwriting anything. His `updated_at` timestamps, `completed` states, and notes are untouched
because nothing about them changes.

The practical requirement: Luigi needs to run this from the **same browser** that already holds his
real anonymous session — the one identified in the read-only query as `4c7e0f1a-a2d1-4ad7-82ba-5010fa209854`
(1 row, dated 2026-10-05, not part of any duplicate — almost certainly his one genuine saved answer
so far). As long as that browser's local storage hasn't been cleared, this is a single in-app action,
not a database operation at all.

**Fallback approach (only if his original browser/session is no longer available):**

If his anonymous session can no longer be recovered, the alternative is a manual re-key of his
existing rows onto a newly created permanent account's `user_id`:

```sql
begin;

update exercise_progress
set user_id = '<new-permanent-account-user_id>'
where user_id = '<old-anonymous-user_id>';

commit;
```

This is deliberately **not** included as a ready-to-run file, because it is only safe under specific
conditions:
- it must run before the new permanent account has written any rows of its own (otherwise it can
  collide with the `(user_id, exercise_id)` unique constraint on an exercise he's touched under both
  identities);
- it should be preceded by the full export in `queries/identify_luigi_progress.sql` as a backup;
- the exact old/new UUIDs need to be filled in by hand, which is intentionally not something to
  automate or run unreviewed.

Prefer the in-place upgrade. Reach for the fallback only if that genuinely isn't possible.

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

**This is also where a real product decision is needed, not just a code question**: introducing
real student logins changes the site's front door. Today, anyone landing on `index.html` starts
working immediately with zero friction (invisible anonymous auth). Once permanent accounts exist,
does the main site:

- (a) require sign-in before any exercise content is shown at all, or
- (b) keep anonymous-first-use as the default, with an optional "save your progress permanently"
  upgrade prompt shown later?

This isn't something to decide unilaterally in code — see the decisions list below.

## 5. Scope boundary: this step vs. the next step

This branch currently contains **only** the schema migration, the read-only identification query,
and this plan. No application code (`js/*.js`, `*.html`) has been changed. Specifically **not** yet
done, pending your review of this package:

- `sync-adapter.js` changes (localStorage key scoping, `project_id`-aware upsert `onConflict` key,
  removing the hardcoded `student_label: "Luigi"`).
- A student login page/flow.
- `supervisor.js`/`supervisor.html` changes to become project-aware (currently it assumes a single
  project and a single student unconditionally).
- Any actual Thylacine RNA course content — the schema can host a second project, but building its
  modules/exercises is a separate, much larger content task, not part of this migration.

## 6. Risks and decisions to address before proceeding

1. **Anonymous auth also gets a `profiles` row now.** The new trigger fires for anonymous sign-ins
   too (Supabase doesn't distinguish at the trigger level), so every stray anonymous identity will
   accumulate a default `profiles` row (`role: 'student'`, `display_name: 'New user'`) the same way
   `exercise_progress` already accumulates stray rows today. Harmless, but worth knowing before you
   see them in the table.
2. **The old `instructors`-based "read everything" policy still exists and still works.** This
   migration adds the new project-scoped teacher policy *alongside* it, deliberately not replacing
   it, so nothing breaks mid-transition. Dropping the old policy is a **separate, later decision** —
   don't do it until your own account has a working `profiles` row (`role: 'admin'` or `role:
   'teacher'` with the right `project_memberships` row) and you've confirmed the new policy actually
   grants you equivalent access. Dropping it first would be able to lock the current supervisor view
   out of its own data.
3. **Who enrolls whom.** `project_memberships` has no insert policy for students or teachers —
   enrollment is SQL-editor-only (by you) for now. Decide whether that's acceptable long-term or
   whether an admin UI for enrollment is a near-term need.
4. **The front-door UX decision from section 4** — sign-in-required vs. optional-upgrade — affects
   how much new code the student-login step actually needs, so it's worth deciding before that step
   starts, not during it.
5. **`exercise_progress`'s upsert conflict key.** It's currently `(user_id, exercise_id)`. Once a
   second project exists, if its exercises ever reused an `exercise_id` string already used by Great
   Auk for the same user (unlikely given the existing `m0-ex01`-style prefixing convention, but not
   impossible), rows could collide. Recommend keeping distinct ID prefixes per project as the
   practical safeguard, and revisiting whether the conflict key should become `(user_id, project_id,
   exercise_id)` when the `sync-adapter.js` changes are actually implemented.
6. **Fallback re-key risk.** As noted in section 2, the manual `UPDATE ... set user_id` fallback is
   only safe before the new account has written anything of its own. If the in-place upgrade path
   turns out not to be possible, sequence carefully.
