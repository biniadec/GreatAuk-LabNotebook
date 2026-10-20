/**
 * login.js
 *
 * Drives login.html: real email/password sign-in for students and
 * teachers. On success, redirects to wherever auth-guard.js sent the
 * visitor from (the `redirect` query param, a site-root-relative path
 * captured by the guard). If there isn't one — the visitor came to
 * login.html directly, not bounced here from a specific page — the
 * destination is resolved from the signed-in account's actual role and
 * project membership, NOT a hardcoded page: an admin goes to index.html;
 * a teacher goes to supervisor.html; a student goes to their own enrolled
 * project's landing page. A single hardcoded default here would send a
 * Thylacine-only account straight into a page that immediately rejects
 * them (index.html requires the Great Auk project) — exactly the
 * confusing first impression this is meant to avoid.
 *
 * If a real, already-signed-in session exists when this page loads,
 * redirects immediately (through the same logic) without showing the
 * form at all.
 */

(function (global) {
  "use strict";

  const form = document.querySelector('[data-role="login-form"]');
  const errorEl = document.querySelector('[data-role="login-error"]');
  const submitBtn = document.querySelector('[data-role="login-submit"]');

  // Same mapping auth-guard.js uses for its project switcher — duplicated
  // here (not imported) since login.html doesn't load auth-guard.js at all;
  // it would have nothing to guard yet (no session exists before sign-in).
  const PROJECT_HOME_PAGES = {
    "great-auk": "index.html",
    "thylacine-rna": "thylacine/index.html",
  };

  // Mirrors the precedence supervisor.js's determineAccess() actually uses
  // (profiles.role === 'admin' first, then a project_memberships 'teacher'
  // row — never profiles.role === 'teacher', which this platform doesn't
  // even require to be kept in sync with membership rows) so that where a
  // login lands always agrees with what that account can actually do once
  // it gets there.
  async function resolveDefaultLandingPage(client, session) {
    try {
      const { data: profile, error: profileErr } = await client
        .from("profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (profileErr) throw profileErr;

      if (profile && profile.role === "admin") return "index.html";

      const { data: memberships, error: memErr } = await client
        .from("project_memberships")
        .select("role, projects(slug)")
        .eq("user_id", session.user.id);
      if (memErr) throw memErr;

      const rows = memberships || [];
      if (rows.some((m) => m.role === "teacher")) return "supervisor.html";

      const studentRow = rows.find((m) => m.role === "student" && m.projects);
      if (studentRow) return PROJECT_HOME_PAGES[studentRow.projects.slug] || "not-enrolled.html";

      return "not-enrolled.html";
    } catch (err) {
      console.warn("[GreatAuk] Could not resolve a role-aware landing page after login — defaulting to index.html.", err);
      return "index.html";
    }
  }

  async function redirectTarget(client, session) {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("redirect");
    if (explicit) return explicit;
    return resolveDefaultLandingPage(client, session);
  }

  async function redirectIfAlreadySignedIn() {
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) return;
    const { data } = await client.auth.getSession();
    const session = data && data.session;
    if (session && !session.user.is_anonymous) {
      window.location.replace(await redirectTarget(client, session));
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) {
      errorEl.textContent = "Sign-in is unavailable right now — please try again shortly.";
      return;
    }

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    errorEl.textContent = "";
    submitBtn.disabled = true;

    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const session = data && data.session;
      window.location.replace(await redirectTarget(client, session));
    } catch (err) {
      errorEl.textContent = "Sign in failed: " + (err.message || "invalid credentials.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  redirectIfAlreadySignedIn();
})(window);
