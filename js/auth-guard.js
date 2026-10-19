/**
 * auth-guard.js
 *
 * Gatekeeper loaded early (right after supabase-client.js, before storage.js
 * /sync-adapter.js/progress.js) on every student-facing page. Confirms a
 * real, permanent (non-anonymous) Supabase session exists before the page's
 * own content is shown — redirects to login.html otherwise. Anonymous auth
 * itself is not disabled at the project level; this file is what makes it
 * no longer sufficient to use the site.
 *
 * If the page sets `window.GreatAuk.REQUIRED_PROJECT` (a project slug,
 * e.g. "great-auk") before this script runs, also confirms the signed-in
 * user holds a 'student' project_memberships row for that project,
 * redirecting to not-enrolled.html otherwise. Pages with no required
 * project (toolbox/resources/glossary) only check for a real login.
 *
 * Exposes `window.GreatAuk.authReady` — a promise other scripts (notably
 * sync-adapter.js) can await to reuse the session/membership/display-name
 * this file already resolved, instead of re-querying.
 */

(function (global) {
  "use strict";

  const pathname = window.location.pathname;
  const rootPrefix = pathname.includes("/modules/") || pathname.includes("/thylacine/") ? "../" : "";

  const PROJECT_HOME_PAGES = {
    "great-auk": "index.html",
    "thylacine-rna": "thylacine/index.html",
  };

  function loginUrl() {
    const redirect = encodeURIComponent(pathname + window.location.search);
    return `${rootPrefix}login.html?redirect=${redirect}`;
  }

  function notEnrolledUrl() {
    return `${rootPrefix}not-enrolled.html`;
  }

  function populateAccountUI(displayName) {
    const nameEl = document.querySelector('[data-role="account-name"]');
    if (nameEl) nameEl.textContent = displayName;

    const signOutBtn = document.querySelector('[data-role="sign-out-btn"]');
    if (signOutBtn) {
      signOutBtn.addEventListener("click", async () => {
        signOutBtn.disabled = true;
        const client = global.GreatAuk.supabase;
        await client.auth.signOut();
        // No redirect here — the onAuthStateChange("SIGNED_OUT") listener
        // below is the single place that redirects to login, regardless of
        // what triggered the sign-out (this button, another tab, token
        // expiry). Two independent redirect attempts for the same event
        // would race each other.
      });
    }
  }

  // Takes a plain list of {slug, name} projects — for an admin this is
  // every project (they're not restricted to projects they happen to hold
  // a membership row in); for everyone else it's derived from their own
  // student/teacher memberships.
  function populateProjectSwitcher(projectsList) {
    const el = document.querySelector('[data-role="project-switcher"]');
    if (!el) return;

    const currentSlug = global.GreatAuk.REQUIRED_PROJECT || null;
    const seen = new Set();
    const links = [];

    projectsList.forEach((p) => {
      const href = PROJECT_HOME_PAGES[p.slug];
      if (!href || seen.has(p.slug)) return;
      seen.add(p.slug);
      const activeClass = p.slug === currentSlug ? " is-active" : "";
      links.push(`<a href="${rootPrefix}${href}" data-project-slug="${p.slug}" class="${activeClass}">${escapeHtml(p.name)}</a>`);
    });

    if (links.length <= 1) {
      el.hidden = true;
      return;
    }
    el.innerHTML = links.join("");
    el.hidden = false;
  }

  // Dashboard link: visible to a global admin, or anyone holding at least
  // one 'teacher' project membership. Hidden for everyone else (students).
  function populateDashboardLink(profileRole, memberships) {
    const link = document.querySelector('[data-role="dashboard-link"]');
    if (!link) return;
    const isTeacherSomewhere = memberships.some((m) => m.role === "teacher");
    link.hidden = !(profileRole === "admin" || isTeacherSomewhere);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function guard() {
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) {
      window.location.replace(loginUrl());
      return;
    }

    const { data: sessionData } = await client.auth.getSession();
    const session = sessionData && sessionData.session;

    if (!session || session.user.is_anonymous) {
      window.location.replace(loginUrl());
      return;
    }

    const { data: memberships, error: memErr } = await client
      .from("project_memberships")
      .select("project_id, role, projects(slug, name)")
      .eq("user_id", session.user.id);

    if (memErr) {
      console.warn("[GreatAuk] Could not load project memberships.", memErr);
    }
    const myMemberships = memberships || [];

    let displayName = session.user.email || "Signed in";
    let profileRole = "student";
    try {
      const { data: profile } = await client
        .from("profiles")
        .select("display_name, role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (profile && profile.display_name) displayName = profile.display_name;
      if (profile && profile.role) profileRole = profile.role;
    } catch (err) {
      console.warn("[GreatAuk] Could not load profile.", err);
    }

    const requiredProject = global.GreatAuk.REQUIRED_PROJECT;
    if (requiredProject) {
      // A global admin, or a teacher of this specific project, can preview
      // student-facing content too — the enrollment gate exists to keep
      // students out of projects they're not in, not to lock out the
      // people responsible for the project itself.
      const hasAccess =
        profileRole === "admin" ||
        myMemberships.some(
          (m) => (m.role === "student" || m.role === "teacher") && m.projects && m.projects.slug === requiredProject
        );
      if (!hasAccess) {
        window.location.replace(notEnrolledUrl());
        return;
      }
    }

    global.GreatAuk.currentUser = session.user;
    global.GreatAuk.currentMemberships = myMemberships;
    global.GreatAuk.currentDisplayName = displayName;

    // An admin can switch between every project, not just ones they
    // happen to hold a membership row in — fetch the full list for them.
    // Everyone else sees only the projects they're a student or teacher of.
    let switcherProjects = myMemberships
      .filter((m) => m.projects && (m.role === "student" || m.role === "teacher"))
      .map((m) => m.projects);

    if (profileRole === "admin") {
      try {
        const { data: allProjects, error: allProjErr } = await client.from("projects").select("slug, name");
        if (allProjErr) throw allProjErr;
        if (allProjects) switcherProjects = allProjects;
      } catch (err) {
        console.warn("[GreatAuk] Could not load full project list for admin switcher.", err);
      }
    }

    document.body.classList.add("auth-ready");
    populateAccountUI(displayName);
    populateProjectSwitcher(switcherProjects);
    populateDashboardLink(profileRole, myMemberships);

    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        window.location.replace(`${rootPrefix}login.html`);
      }
    });

    return { session, memberships: myMemberships, displayName };
  }

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.authReady = guard();
})(window);
