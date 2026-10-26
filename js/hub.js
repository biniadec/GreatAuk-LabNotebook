/**
 * hub.js
 *
 * Drives the public HoloBase homepage (index.html).
 *
 * Signed out (or a leftover anonymous session): shows the public project
 * cards from projects-data.js and a Sign in option. Makes NO database
 * requests at all — there is nothing for an anonymous visitor to read.
 *
 * Signed in: reads only the visitor's OWN profile role and OWN project
 * memberships (both already limited to the visitor by Row Level Security)
 * and marks each card accordingly, using the same precedence as
 * auth-guard.js and supervisor.js (profiles.role === 'admin' first, then
 * project_memberships rows):
 *   - administrator: every project — "Administrator", View project + Open dashboard
 *   - teacher of the project: "Teacher", View project + Open dashboard
 *   - student of the project: "Student", Enter project
 *   - a teacher account (profiles.role 'teacher', or a teacher membership
 *     anywhere) not assigned to the project: locked, "No teaching access"
 *   - anyone else without a membership: locked, "Not enrolled"
 * The badges only describe access the account already has; the pages behind
 * the buttons enforce it themselves.
 * It never requests progress, answers, rosters or anyone else's data; the
 * pages behind these links stay protected by auth-guard.js and RLS. If
 * access can't be checked, no card opens (fail closed).
 */

(function (global) {
  "use strict";

  const GA = global.GreatAuk || {};
  const PROJECTS = GA.PROJECTS || [];

  const el = {
    projects: document.querySelector('[data-role="hub-projects"]'),
    status: document.querySelector('[data-role="hub-status"]'),
    signIn: document.querySelector('[data-role="hub-sign-in"]'),
    name: document.querySelector('[data-role="hub-account-name"]'),
    dashboard: document.querySelector('[data-role="hub-dashboard-link"]'),
    changePassword: document.querySelector('[data-role="hub-change-password"]'),
    signOut: document.querySelector('[data-role="hub-sign-out"]'),
  };

  const LOCK_SVG =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5Z"/></svg>';

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function link(text, href, primary) {
    const a = make("a", `btn ${primary ? "btn-primary" : "btn-secondary"} btn-small`, text);
    a.href = href;
    return a;
  }

  function setStatus(text, isError) {
    el.status.textContent = text;
    el.status.classList.toggle("hub-status--error", Boolean(isError));
  }

  // access: null (signed out) | "loading" | "error" |
  //         { isAdmin, isTeacherAccount, roles: {slug: Set(role)} }
  function cardFor(project, access) {
    const card = make("article", "hub-card");
    card.setAttribute("data-project-card", project.slug);
    if (project.accent) card.style.setProperty("--hub-card-accent", project.accent);

    const img = make("img", "hub-card-art");
    img.src = project.artwork.src;
    img.alt = project.artwork.alt;
    img.loading = "lazy";
    if (project.artwork.position) img.style.objectPosition = project.artwork.position;
    card.appendChild(img);

    const body = make("div", "hub-card-body");
    const head = make("div", "hub-card-head");
    const titles = make("div");
    titles.appendChild(make("h3", "", project.displayName));
    titles.appendChild(make("span", "hub-card-subtitle", project.subtitle));
    head.appendChild(titles);
    body.appendChild(head);
    body.appendChild(make("p", "", project.publicDescription));

    const home = project.homePage;
    const dashboard = `supervisor.html?project=${encodeURIComponent(project.slug)}`;
    const actions = make("div", "hub-card-actions");
    let chip = null;
    let state;

    if (access === null) {
      state = "public";
      actions.appendChild(link("Sign in to enter", `login.html?redirect=${encodeURIComponent(home)}`, true));
    } else if (access === "loading" || access === "error") {
      state = access;
      body.appendChild(make("p", "hub-card-note", access === "loading" ? "Checking access…" : "Access could not be checked."));
    } else {
      const roles = access.roles[project.slug] || new Set();
      const isStudent = roles.has("student");
      const isTeacher = roles.has("teacher");
      if (access.isAdmin || isTeacher || isStudent) {
        state = access.isAdmin ? "admin" : isTeacher ? "teacher" : "student";
        chip = make("span", "hub-chip hub-chip--member", access.isAdmin ? "Administrator" : isTeacher ? "Teacher" : "Student");
        if (isStudent) actions.appendChild(link("Enter project", home, true));
        else actions.appendChild(link("View project", home, false));
        if (access.isAdmin || isTeacher) actions.appendChild(link("Open dashboard", dashboard, !isStudent));
      } else {
        const teacher = access.isTeacherAccount;
        state = teacher ? "no-teaching" : "locked";
        card.classList.add("hub-card--locked");
        chip = make("span", "hub-chip");
        chip.innerHTML = LOCK_SVG;
        chip.appendChild(document.createTextNode(teacher ? " No teaching access" : " Not enrolled"));
        body.appendChild(make("p", "hub-card-note", teacher
          ? "This project is not assigned to you. Contact the HoloBase administrator if you need access."
          : "You're not enrolled in this project. Please contact your supervisor if you believe you should have access."));
      }
    }

    card.setAttribute("data-access", state);
    if (chip) head.appendChild(chip);
    if (actions.childNodes.length) body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function renderCards(access) {
    el.projects.replaceChildren(...PROJECTS.filter((p) => p.status === "active").map((p) => cardFor(p, access)));
  }

  function renderSignedOut() {
    el.signIn.hidden = false;
    el.name.hidden = true;
    el.dashboard.hidden = true;
    el.changePassword.hidden = true;
    el.signOut.hidden = true;
    setStatus("Sign in to open the projects you're enrolled in.");
    renderCards(null);
  }

  function renderSignedIn(displayName, access) {
    el.signIn.hidden = true;
    el.name.textContent = displayName;
    el.name.hidden = false;
    el.changePassword.hidden = false;
    el.signOut.hidden = false;
    if (access === "error") {
      el.dashboard.hidden = true;
      setStatus("We couldn't check your project access right now. Please reload the page to try again.", true);
    } else {
      const teachesSomewhere = Object.values(access.roles).some((r) => r.has("teacher"));
      el.dashboard.hidden = !(access.isAdmin || teachesSomewhere);
      const open = PROJECTS.filter((p) => access.isAdmin || (access.roles[p.slug] && access.roles[p.slug].size));
      setStatus(open.length
        ? `Welcome back, ${displayName}. Choose a project to continue.`
        : access.isTeacherAccount
          ? `Welcome, ${displayName}. No projects are assigned to you yet — contact the HoloBase administrator.`
          : `Welcome, ${displayName}. You're not enrolled in a project yet — contact your supervisor.`);
    }
    renderCards(access);
  }

  async function loadAccess(client, userId) {
    const [{ data: profile, error: profileErr }, { data: memberships, error: memErr }] = await Promise.all([
      client.from("profiles").select("display_name, role").eq("user_id", userId).maybeSingle(),
      client.from("project_memberships").select("role, projects(slug)").eq("user_id", userId),
    ]);
    if (profileErr) throw profileErr;
    if (memErr) throw memErr;
    const roles = {};
    (memberships || []).forEach((m) => {
      if (!m.projects || !m.projects.slug) return;
      (roles[m.projects.slug] = roles[m.projects.slug] || new Set()).add(m.role);
    });
    const isAdmin = Boolean(profile && profile.role === "admin");
    const isTeacherAccount = !isAdmin && (
      Boolean(profile && profile.role === "teacher") || (memberships || []).some((m) => m.role === "teacher"));
    return {
      displayName: (profile && profile.display_name) || null,
      access: { isAdmin, isTeacherAccount, roles },
    };
  }

  async function init() {
    const year = document.querySelector("[data-current-year]");
    if (year) year.textContent = String(new Date().getFullYear());

    const client = GA.supabase;
    if (!client) {
      renderSignedOut();
      return;
    }

    let session = null;
    try {
      const { data } = await client.auth.getSession();
      session = data && data.session;
    } catch (err) {
      console.warn("[HoloBase] Could not read the session.", err);
    }

    if (!session || session.user.is_anonymous) {
      renderSignedOut();
    } else {
      const fallbackName = session.user.email || "Signed in";
      setStatus("Checking your projects…");
      renderCards("loading"); // nothing opens until access is known
      try {
        const { displayName, access } = await loadAccess(client, session.user.id);
        renderSignedIn(displayName || fallbackName, access);
      } catch (err) {
        console.warn("[HoloBase] Could not load project access.", err);
        renderSignedIn(fallbackName, "error");
      }
    }

    el.signOut.addEventListener("click", async () => {
      el.signOut.disabled = true;
      try {
        await client.auth.signOut();
      } finally {
        el.signOut.disabled = false;
        renderSignedOut();
      }
    });

    client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") renderSignedOut();
    });
  }

  init();
})(window);
