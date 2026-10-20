/**
 * landing-page.js
 *
 * Resolves where a signed-in session should land when there's no specific
 * destination already in mind — used by login.js (no explicit `redirect`
 * param), set-password.js (just finished a recovery/invite flow), and
 * change-password.js ("continue" after a successful password change).
 * One shared implementation so these three places can't drift out of sync
 * with each other or with the authorization rules they're meant to mirror.
 *
 * Mirrors the exact precedence supervisor.js's determineAccess() actually
 * uses (profiles.role === 'admin' first, then a project_memberships
 * 'teacher' row — never profiles.role === 'teacher', which this platform
 * doesn't require to be kept in sync with membership rows), so where
 * someone lands always agrees with what their account can actually do
 * once they get there. An account with no role === 'admin' and no
 * membership at all (e.g. invited but not yet enrolled in any project)
 * correctly resolves to not-enrolled.html — there is nowhere else honest
 * to send them yet.
 */

(function (global) {
  "use strict";

  const PROJECT_HOME_PAGES = {
    "great-auk": "index.html",
    "thylacine-rna": "thylacine/index.html",
  };

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
      console.warn("[GreatAuk] Could not resolve a role-aware landing page — defaulting to index.html.", err);
      return "index.html";
    }
  }

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.PROJECT_HOME_PAGES = PROJECT_HOME_PAGES;
  global.GreatAuk.resolveDefaultLandingPage = resolveDefaultLandingPage;
})(window);
