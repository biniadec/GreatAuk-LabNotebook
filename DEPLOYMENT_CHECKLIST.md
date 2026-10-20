# Multi-user platform — final pre-deployment review

Reviewed: `feature/multi-user-platform` (18 commits ahead of `main`, commit `f40e679`) against `main`
(`71e1dae`). `main` has not moved independently since the branch diverged — this is a clean,
conflict-free merge whenever you decide to run it. Nothing in this review executed SQL, changed
Supabase, merged, or deployed.

## What was checked, and the result

**Security**
- `js/supabase-client.js` (the only file holding Supabase credentials) is **unchanged** by this
  branch. It holds only the project URL and the public, publishable/anon key — confirmed by reading
  it directly, not assumed. No `service_role` key, no other secret, anywhere in the 43 changed files
  (checked the full diff for `service_role`/`secret`/`private key` patterns — none found).
- No absolute, domain-root paths (`href="/..."`) anywhere in the site — everything is relative, so it
  will work correctly whether GitHub Pages serves this at a root domain or a `/RepoName/` subpath.
- `login.html`, `not-enrolled.html`, and `supervisor.html` all carry `noindex, nofollow` — search
  engines won't index pages that only make sense to a signed-in account.
- RLS/policy correctness for this release was already established across several earlier review
  rounds (recursive-policy fix, privilege-escalation fix, project-scoping, the 0002 legacy-policy
  retirement) — not re-litigated here; see `supabase/MIGRATION_PLAN.md` for that history.

**Broken links** — 413 internal links across all 18 HTML files resolve correctly (automated check,
not spot-checked).

**Authentication regressions** — all 113 Playwright checks across four suites pass against the
current branch tip: mandatory login, admin dashboard + project switching, teacher project-scoping
(both Great Auk and Thylacine-only), student access and denial, logout, session persistence,
cross-account localStorage isolation, role-aware post-login routing, and a full regression sweep of
all 10 Great Auk module pages. Zero failures, zero console errors.

**Missing files** — none. No file is deleted or renamed relative to `main` (`git diff --diff-filter=D`
and `--diff-filter=R` both empty); every new page this branch adds (`login.html`, `not-enrolled.html`,
`thylacine/index.html`, their JS) exists and is reachable.

**Anything that could disrupt Luigi's access**
- His real account, its 25 migrated records, and his original anonymous records are all untouched by
  everything in this review — confirmed by the diff touching no SQL migration data, and by his
  original anonymous rows never being part of any script here (the retirement script remains
  unexecuted, per your standing instruction).
- **The one real risk to his access is not technical, it's communication**: once this merges, Luigi
  can no longer continue anonymously — he must sign in with his real account. If he doesn't already
  know that email/password, his very first visit after deploy will be a dead end. Put "Luigi has his
  credentials in hand" on the checklist below as a hard gate, not an afterthought.
- There is currently **no self-service "forgot password" flow** anywhere in the UI (checked
  `login.html`/`js/login.js` directly — no `resetPasswordForEmail` call exists). If Luigi loses or
  forgets his password post-deploy, the only recovery path today is you resetting it manually via the
  Supabase Dashboard. Not a blocker, but worth knowing before go-live, not after a support request.

**A correction this review found and already fixed in the docs** (not a deploy blocker, since Emilio's
account doesn't exist yet): `MIGRATION_PLAN.md`'s teacher-onboarding steps previously recommended
Supabase's "Invite user" flow for a new teacher. That wouldn't actually work with this app as it
stands — `supabase-client.js` sets `detectSessionInUrl: false`, so the session an invite link's
redirect carries is never picked up, and `login.html` has no set-password step to hand off to. Fixed
in both `MIGRATION_PLAN.md` and `setup_emilio_teacher.sql` to recommend "Add user" (you set a
password, relay it directly) instead — the only method that actually works today.

## Deployment checklist

Work through this in order. Nothing here should be run until you're ready for the live site to
require login immediately — **merging `main` *is* the deploy**; there's no separate build/publish
step (no GitHub Actions workflow, no CNAME — Pages serves straight from `main`).

1. **Confirm Luigi has his real login credentials in hand** (email + password he can actually use
   right now), not just that the account exists in Supabase. This is the one step that actually
   protects his access — everything else here is technical.
2. **Tell Luigi, before or at the moment of deploy**, that the site now requires a real login and
   give him the URL — don't let him discover a login wall unannounced.
3. **Re-confirm current Supabase state** (quick Dashboard glance, no SQL needed): migrations 0001 and
   0002 applied (already confirmed earlier), Luigi's profile/membership/25 records intact, his
   original anonymous records still present and untouched, anonymous auth still enabled at the
   project level (it was deliberately never disabled — that's fine and doesn't need to change for
   this deploy).
4. **Pick a low-traffic moment** — while there's no real "downtime" (GitHub Pages keeps serving the
   old version until the new build is ready, typically a few minutes), the cutover to mandatory login
   is immediate and global once it propagates, with no gradual rollout.
5. **Merge `feature/multi-user-platform` into `main`** and push. This is the deploy.
6. **Within the next few minutes**, verify the live site directly (not localhost): the home page
   requires login, `login.html` loads with neutral "Lab Notebooks" branding, and a real sign-in as
   yourself (admin) reaches the dashboard and can switch projects.
7. **Have Luigi sign in on the live site** as soon as practical after step 6, and confirm he sees his
   25 real records. This is the actual proof the deploy succeeded for the person it matters most to.
8. **Do not invite Emilio yet, and do not run `relabel_and_retire_luigi_anonymous.sql` yet** — both
   remain your explicit, separate calls, unconnected to this deploy.

## Rollback procedure

If something goes wrong after merging, the fix is a **frontend-only git revert** — no Supabase
changes are needed or recommended as part of rolling back:

1. `git revert` the merge commit on `main` (or reset `main` back to `71e1dae` and force-push, if you'd
   rather have a clean history — revert is gentler and doesn't rewrite history, so it's the safer
   default) and push. GitHub Pages redeploys automatically, the same few-minutes propagation as any
   other push.
2. **Why this is safe on its own, with nothing to undo in Supabase**: migrations 0001 and 0002 were
   deliberately designed to be backward-compatible with the pre-migration anonymous-auth flow — the
   "legacy write allowance" in 0001 (section 4b) specifically keeps an unenrolled, anonymous session's
   writes into the default Great Auk project working. Rolling the frontend back to the old
   anonymous-auth code means it talks to the same (already-migrated) schema exactly as it did before
   any of this branch's work began. No data is lost by a frontend rollback: anything written by a real
   account in the meantime (Luigi's account, any Test Teacher activity) simply stays in
   `exercise_progress`, untouched, available again whenever you redeploy forward.
3. If the problem is narrower than "revert everything" — e.g. one broken page, not the whole
   login requirement — a targeted fix-forward commit on `main` is usually faster and less disruptive
   than a full revert. Use judgment; the revert path above is the guaranteed-safe fallback, not the
   only option.
4. Luigi's original anonymous records and his migrated real-account records are never touched by
   either a forward deploy or a rollback — both are pure frontend/git operations.
