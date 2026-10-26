/**
 * supervisor.js
 *
 * Drives supervisor.html: a read-only teacher/admin view of students'
 * exercise_progress rows, scoped by real project membership. This file
 * never writes to exercise_progress — only `select` calls are made.
 * Authorization and project scoping are enforced by Supabase RLS
 * (is_teacher_of_student_in_project / is_admin); hiding or showing
 * elements here is presentation only.
 *
 * Students are identified by their real, permanent user_id joined to
 * profiles.display_name and project_memberships — never by the
 * student_label column, which predates real accounts, was written
 * inconsistently (some historical rows have it NULL), and is kept only as
 * inert legacy metadata. Because every real account has at most one
 * exercise_progress row per exercise_id (enforced by the table's own
 * unique constraint), there is no more "merge duplicate anonymous
 * identities" concern the way there was before real accounts existed.
 *
 * Exercise text (title, Concept/Task/Check-yourself) is never duplicated
 * here. For the Great Auk project it is fetched live from each active
 * module's real HTML page and parsed, exactly as before. Other projects
 * (Thylacine RNA, for now) have no module content yet, by design — the
 * view says so plainly rather than silently showing nothing.
 */

(function (global) {
  "use strict";

  const TABLE = "exercise_progress";

  const el = {
    dashboardHeading: document.querySelector('[data-role="dashboard-heading"]'),
    changePasswordLink: document.querySelector('[data-role="change-password-link"]'),
    signOutBtn: document.querySelector('[data-role="sign-out-btn"]'),
    loginView: document.querySelector('[data-role="login-view"]'),
    loginForm: document.querySelector('[data-role="login-form"]'),
    loginError: document.querySelector('[data-role="login-error"]'),
    loginSubmit: document.querySelector('[data-role="login-submit"]'),
    deniedView: document.querySelector('[data-role="denied-view"]'),
    errorView: document.querySelector('[data-role="error-view"]'),
    errorMessage: document.querySelector('[data-role="error-message"]'),
    mainView: document.querySelector('[data-role="main-view"]'),
    roleLabel: document.querySelector('[data-role="role-label"]'),
    projectPicker: document.querySelector('[data-role="project-picker"]'),
    projectSelect: document.querySelector('[data-role="project-select"]'),
    teachersNote: document.querySelector('[data-role="teachers-note"]'),
    rosterContainer: document.querySelector('[data-role="roster-container"]'),
    studentPicker: document.querySelector('[data-role="student-picker"]'),
    studentSelect: document.querySelector('[data-role="student-select"]'),
    studentLabel: document.querySelector('[data-role="student-label"]'),
    filtersRow: document.querySelector('[data-role="filters-row"]'),
    filterModule: document.querySelector('[data-role="filter-module"]'),
    filterCompletion: document.querySelector('[data-role="filter-completion"]'),
    filterAnswer: document.querySelector('[data-role="filter-answer"]'),
    modulesContainer: document.querySelector('[data-role="modules-container"]'),
    noDataMessage: document.querySelector('[data-role="no-data-message"]'),
  };

  let accessMode = null; // "admin" | "teacher"
  let availableProjects = []; // [{id, slug, name}]
  let selectedProject = null;
  let roster = []; // [{user_id, display_name}]
  let selectedStudentId = null;
  // progressByUser: Map<user_id, Map<exercise_id, row>>
  let progressByUser = new Map();
  // exerciseContentCache: Map<exercise_id, { number, title, blocks }>
  let exerciseContentCache = new Map();
  let activeModules = [];

  function getClient() {
    return global.GreatAuk && global.GreatAuk.supabase;
  }

  function showOnly(viewEl) {
    [el.loginView, el.deniedView, el.errorView, el.mainView].forEach((v) => {
      if (v) v.hidden = v !== viewEl;
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Distinct from "Access denied": this is for when we genuinely don't know
  // whether the account is authorized, because a query failed outright
  // (database/network error), not because the account was checked and
  // found lacking. The full error is always logged to the console for
  // debugging — it never contains credentials, only Postgres/PostgREST
  // error details (message/code/hint) — while the on-screen text stays
  // generic, non-technical.
  function showError(message, err) {
    if (err) console.error("[Supervisor]", message, err);
    showOnly(el.errorView);
    el.errorView.hidden = false;
    el.errorMessage.textContent = message;
  }

  // ---- auth ---------------------------------------------------------------

  async function handleSession(session) {
    if (!session || session.user.is_anonymous) {
      el.signOutBtn.hidden = true;
      el.changePasswordLink.hidden = true;
      showOnly(el.loginView);
      el.loginView.hidden = false;
      return;
    }
    el.signOutBtn.hidden = false;
    el.changePasswordLink.hidden = false;

    // Step 1: determine authorization. A thrown error here means a query
    // genuinely failed (database/network problem) — we don't know the
    // account's real status, so this is NOT the same as "denied" and must
    // not be shown as such.
    let access;
    try {
      access = await determineAccess(session);
    } catch (err) {
      showError(
        "We couldn't check your account's authorization right now. This looks like a temporary database or network problem, not a permissions issue — please try reloading.",
        err
      );
      return;
    }

    if (access.mode === "denied") {
      showOnly(el.deniedView);
      el.deniedView.hidden = false;
      return;
    }

    accessMode = access.mode;
    availableProjects = access.projects;
    showOnly(el.mainView);
    el.mainView.hidden = false;
    el.roleLabel.textContent =
      accessMode === "admin"
        ? "Signed in as administrator — all projects."
        : "Signed in as teacher.";

    populateProjectPicker();

    // Step 2: load the first project's roster/progress. Authorization is
    // already confirmed at this point — a failure here is a data-loading
    // problem for this specific project, not a reason to say "denied".
    try {
      // ?project=<slug> (the HoloBase homepage's "Open dashboard") picks the
      // starting project, but only among those this account may see.
      const wanted = new URLSearchParams(window.location.search).get("project");
      const initial = availableProjects.find((p) => p.slug === wanted) || availableProjects[0];
      await selectProject(initial.id);
    } catch (err) {
      showError(
        "You're authorized, but we couldn't load this project's data due to a database or network error. Please try reloading.",
        err
      );
    }
  }

  async function determineAccess(session) {
    const client = getClient();

    const { data: profile, error: profileErr } = await client
      .from("profiles")
      .select("role")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (profileErr) throw profileErr;

    if (profile && profile.role === "admin") {
      const { data: allProjects, error: projErr } = await client
        .from("projects")
        .select("id, slug, name")
        .order("name");
      if (projErr) throw projErr;
      if (!allProjects || allProjects.length === 0) return { mode: "denied", projects: [] };
      return { mode: "admin", projects: allProjects };
    }

    const { data: memberships, error: memErr } = await client
      .from("project_memberships")
      .select("project_id, role, projects(id, slug, name)")
      .eq("user_id", session.user.id)
      .eq("role", "teacher");
    if (memErr) throw memErr;

    const teacherProjects = (memberships || []).map((m) => m.projects).filter(Boolean);
    if (teacherProjects.length === 0) return { mode: "denied", projects: [] };
    return { mode: "teacher", projects: teacherProjects };
  }

  async function initAuth() {
    const client = getClient();
    if (!client) {
      el.loginError.textContent = "Supabase client unavailable.";
      showOnly(el.loginView);
      el.loginView.hidden = false;
      return;
    }

    client.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    const { data } = await client.auth.getSession();
    handleSession(data && data.session);
  }

  el.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = getClient();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    el.loginError.textContent = "";
    el.loginSubmit.disabled = true;
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange will pick up the new session and re-render.
    } catch (err) {
      el.loginError.textContent = "Sign in failed: " + (err.message || "invalid credentials.");
    } finally {
      el.loginSubmit.disabled = false;
    }
  });

  el.signOutBtn.addEventListener("click", async () => {
    const client = getClient();
    await client.auth.signOut();
    // onAuthStateChange("SIGNED_OUT") drives handleSession(null) -> login view.
  });

  // ---- project selection ---------------------------------------------------

  function populateProjectPicker() {
    if (availableProjects.length <= 1) {
      el.projectPicker.hidden = true;
      return;
    }
    el.projectPicker.hidden = false;
    el.projectSelect.innerHTML = availableProjects
      .map((p) => `<option value="${p.id}">${escapeHtml(displayName(p))}</option>`)
      .join("");
  }

  el.projectSelect.addEventListener("change", async () => {
    try {
      await selectProject(el.projectSelect.value);
    } catch (err) {
      showError(
        "We couldn't load this project's data due to a database or network error. Please try reloading.",
        err
      );
    }
  });

  // Display names follow the naming convention in projects-data.js (by
  // slug); the database's projects.name is only a fallback.
  function displayName(project) {
    const lookup = global.GreatAuk.projectDisplayName;
    return lookup ? lookup(project.slug, project.name) : project.name;
  }

  async function selectProject(projectId) {
    selectedProject = availableProjects.find((p) => p.id === projectId) || availableProjects[0];
    el.projectSelect.value = selectedProject.id;

    // The heading previously hardcoded "Great Auk" regardless of which
    // project was actually being viewed — wrong for a Thylacine-only
    // teacher, and wrong for an admin who has switched away from Great
    // Auk. Keep it accurate for both roles and both projects instead.
    const roleName = accessMode === "admin" ? "Administrator" : "Teacher";
    const headingText = `${displayName(selectedProject)} — ${roleName} Dashboard`;
    el.dashboardHeading.textContent = headingText;
    document.title = `${headingText} | HoloBase`;

    if (accessMode === "admin") {
      await renderTeachersNote(selectedProject.id);
    } else {
      el.teachersNote.hidden = true;
    }

    await loadRosterAndProgress(selectedProject.id);

    // Each project's own visual theme (css/theme-thylacine.css is scoped to
    // this attribute; Great Auk has no theme rules, so it renders as before).
    document.documentElement.setAttribute("data-project-theme", selectedProject.slug);

    // activeModules must be recomputed on every project visit, not only the
    // first — switching away and back must not leave it stale or empty just
    // because the exercise content is already cached.
    const projectModules = (global.GreatAuk.MODULES_BY_PROJECT || {})[selectedProject.slug] || [];
    activeModules = projectModules.filter((m) => m.status === "active" && m.exerciseIds.length > 0);
    if (activeModules.length > 0) {
      await loadExerciseContent(activeModules);
      populateModuleFilter();
      el.filtersRow.hidden = false;
    } else {
      el.filtersRow.hidden = true;
    }

    renderRoster();
    renderStudentDetail();
  }

  // Looks up display names for a set of user_ids via a plain, separate
  // query against profiles, joined to the caller's rows by user_id in
  // JS — NOT via Supabase's embedded-resource select syntax. That syntax
  // (`project_memberships.select("profiles(display_name)")`) requires a
  // direct foreign key between the two tables for PostgREST to auto-
  // discover the join; project_memberships.user_id and profiles.user_id
  // both reference auth.users independently, with no FK directly linking
  // the two, so the embed fails outright with PGRST200 ("could not find a
  // relationship"). Two plain queries, joined here, sidesteps that without
  // touching the schema.
  async function fetchDisplayNames(userIds) {
    if (userIds.length === 0) return new Map();
    const client = getClient();
    const { data, error } = await client.from("profiles").select("user_id, display_name").in("user_id", userIds);
    if (error) throw error;
    return new Map((data || []).map((p) => [p.user_id, p.display_name]));
  }

  async function renderTeachersNote(projectId) {
    const client = getClient();
    const { data: memberships, error } = await client
      .from("project_memberships")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("role", "teacher");
    if (error) throw error;

    const userIds = (memberships || []).map((m) => m.user_id);
    const namesByUserId = await fetchDisplayNames(userIds);
    const names = userIds.map((uid) => namesByUserId.get(uid) || "Unnamed teacher");

    el.teachersNote.hidden = false;
    el.teachersNote.textContent = names.length > 0 ? `Teachers for this project: ${names.join(", ")}` : "No teachers assigned to this project yet.";
  }

  // ---- roster + progress loading --------------------------------------------

  async function loadRosterAndProgress(projectId) {
    const client = getClient();

    const [{ data: membershipRows, error: membershipErr }, { data: progressRows, error: progressErr }] = await Promise.all([
      client
        .from("project_memberships")
        .select("user_id")
        .eq("project_id", projectId)
        .eq("role", "student"),
      client
        .from(TABLE)
        .select("user_id, exercise_id, completed, notes, updated_at")
        .eq("project_id", projectId),
    ]);

    if (membershipErr) throw membershipErr;
    if (progressErr) throw progressErr;

    const studentUserIds = (membershipRows || []).map((m) => m.user_id);
    const namesByUserId = await fetchDisplayNames(studentUserIds);

    roster = studentUserIds.map((uid) => ({
      user_id: uid,
      display_name: namesByUserId.get(uid) || "Unnamed student",
    }));

    progressByUser = new Map();
    for (const row of progressRows || []) {
      if (!progressByUser.has(row.user_id)) progressByUser.set(row.user_id, new Map());
      progressByUser.get(row.user_id).set(row.exercise_id, row);
    }

    selectedStudentId = roster.length > 0 ? roster[0].user_id : null;
  }

  // Archived modules (the original Great Auk Module 00) are still shown in
  // the student detail, so existing answers stay visible, but they no
  // longer count towards completion: nobody can complete them any more.
  const countedModules = () => activeModules.filter((m) => !m.archived);

  function rosterCompletedCount(userId) {
    const rows = progressByUser.get(userId);
    if (!rows || activeModules.length === 0) return 0;
    let count = 0;
    for (const mod of countedModules()) {
      for (const exId of mod.exerciseIds) {
        const row = rows.get(exId);
        if (row && row.completed) count++;
      }
    }
    return count;
  }

  // Historical training in archived modules, per student, from their rows.
  function historyLines(userId) {
    const rows = progressByUser.get(userId);
    if (!rows) return [];
    return activeModules.filter((m) => m.archived).map((m) => {
      const done = m.exerciseIds.filter((id) => rows.get(id) && rows.get(id).completed).length;
      const any = done > 0 || m.exerciseIds.some((id) => rows.get(id) && rows.get(id).notes);
      return any ? `${m.historyLabel || `Module ${m.number} (archived)`} — ${done}/${m.exerciseIds.length} exercises completed · Archived` : null;
    }).filter(Boolean);
  }

  function totalExerciseCount() {
    return countedModules().reduce((sum, m) => sum + m.exerciseIds.length, 0);
  }

  function renderRoster() {
    if (roster.length === 0) {
      el.rosterContainer.innerHTML = `<p class="supervisor-empty-state">No students are enrolled in this project yet.</p>`;
      el.studentPicker.hidden = true;
      return;
    }

    const total = totalExerciseCount();
    const items = roster
      .map((s) => {
        const isSelected = s.user_id === selectedStudentId;
        const countText = total > 0 ? `${rosterCompletedCount(s.user_id)} / ${total} complete` : "No modules yet";
        return `
          <li class="roster-item${isSelected ? " is-selected" : ""}" data-user-id="${s.user_id}">
            <span class="roster-item-name">${escapeHtml(s.display_name)}</span>
            <span class="roster-item-progress">${countText}</span>${historyLines(s.user_id).map((t) => `
            <span class="roster-item-history" data-role="roster-history">${escapeHtml(t)}</span>`).join("")}
          </li>`;
      })
      .join("");
    el.rosterContainer.innerHTML = `<ul class="roster-list">${items}</ul>`;

    el.rosterContainer.querySelectorAll(".roster-item").forEach((li) => {
      li.addEventListener("click", () => {
        selectedStudentId = li.getAttribute("data-user-id");
        el.studentSelect.value = selectedStudentId;
        renderRoster();
        renderStudentDetail();
      });
    });

    if (roster.length <= 1) {
      el.studentPicker.hidden = true;
    } else {
      el.studentPicker.hidden = false;
      el.studentSelect.innerHTML = roster.map((s) => `<option value="${s.user_id}">${escapeHtml(s.display_name)}</option>`).join("");
      el.studentSelect.value = selectedStudentId;
    }
  }

  el.studentSelect.addEventListener("change", () => {
    selectedStudentId = el.studentSelect.value;
    renderRoster();
    renderStudentDetail();
  });

  // ---- exercise content (fetched live from the real module pages) -------

  // A module's text comes from its own page (Great Auk: modules/<slug>.html),
  // or from a shared source page (Thylacine Module 00 reads Great Auk's
  // Module 00, mapping thy-m00-exNN back to the source's m0-exNN). The cache
  // is keyed by the project's OWN exercise IDs, which never collide across
  // projects, so each module is fetched at most once per page load.
  async function loadExerciseContent(modules) {
    const toLoad = modules.filter((mod) => mod.exerciseIds.some((id) => !exerciseContentCache.has(id)));
    await Promise.all(
      toLoad.map(async (mod) => {
        try {
          const path = mod.sharedContent
            ? global.GreatAuk.projectPath(mod.sharedContent.project, mod.sharedContent.path)
            : global.GreatAuk.projectPath(selectedProject.slug, `modules/${mod.slug}.html`);
          const sourceIdFor = mod.sharedContent ? mod.sharedContent.sourceIdFor : (id) => id;
          const resp = await fetch(path);
          const html = await resp.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          for (const exId of mod.exerciseIds) {
            const content = extractExerciseContent(doc, sourceIdFor(exId));
            if (content) exerciseContentCache.set(exId, content);
          }
        } catch (err) {
          console.warn(`[Supervisor] Could not load content for module ${mod.slug}.`, err);
        }
      })
    );
  }

  function extractExerciseContent(doc, exerciseId) {
    const section = doc.querySelector(`[data-exercise-id="${exerciseId}"]`);
    if (!section) return null;

    const numberEl = section.querySelector(".exercise-number");
    const titleEl = section.querySelector(".exercise-title h3");
    const blocks = [];

    section.querySelectorAll(":scope > .exercise-block").forEach((block) => {
      const label = block.querySelector(":scope > .block-label");
      if (!label) return;
      const cls = label.classList;
      if (cls.contains("hint") || cls.contains("doc") || cls.contains("notes") || cls.contains("solution")) return;

      const labelText = cls.contains("check") ? "Check yourself" : label.textContent.trim();
      const clone = block.cloneNode(true);
      const cloneLabel = clone.querySelector(":scope > .block-label");
      if (cloneLabel) cloneLabel.remove();
      blocks.push({ label: labelText, html: clone.innerHTML.trim() });
    });

    return {
      number: numberEl ? numberEl.textContent.trim() : "",
      title: titleEl ? titleEl.textContent.trim() : exerciseId,
      blocks,
    };
  }

  // ---- filters ------------------------------------------------------------

  function populateModuleFilter() {
    el.filterModule.innerHTML =
      '<option value="all">All modules</option>' +
      activeModules
        .map((m) => `<option value="${m.id}">Module ${m.number} — ${escapeHtml(m.title)}${m.archived ? " (archived)" : ""}</option>`)
        .join("");
  }

  [el.filterModule, el.filterCompletion, el.filterAnswer].forEach((select) => {
    select.addEventListener("change", renderStudentDetail);
  });

  function getFilters() {
    return {
      module: el.filterModule.value,
      completion: el.filterCompletion.value,
      answer: el.filterAnswer.value,
    };
  }

  function passesFilters(row, filters) {
    const completed = Boolean(row && row.completed);
    const hasAnswer = Boolean(row && row.notes && row.notes.trim().length > 0);

    if (filters.completion === "completed" && !completed) return false;
    if (filters.completion === "incomplete" && completed) return false;
    if (filters.answer === "has-answer" && !hasAnswer) return false;
    if (filters.answer === "no-answer" && hasAnswer) return false;
    return true;
  }

  // ---- rendering ------------------------------------------------------------

  function renderStudentDetail() {
    if (!selectedProject) return;

    if (roster.length === 0) {
      // The roster panel (renderRoster(), above) already shows "No students
      // are enrolled in this project yet." in its own empty state — showing
      // the identical sentence again here as well was a genuine duplicate,
      // not two different pieces of information. Nothing more to say in
      // this panel when there's no student to show detail for.
      el.studentLabel.textContent = "";
      el.modulesContainer.innerHTML = "";
      el.noDataMessage.hidden = true;
      return;
    }

    const student = roster.find((s) => s.user_id === selectedStudentId);
    el.studentLabel.textContent = student ? `Showing progress for: ${student.display_name}` : "";

    if (activeModules.length === 0) {
      el.modulesContainer.innerHTML = "";
      el.noDataMessage.hidden = false;
      el.noDataMessage.textContent = "No modules have been built yet for this project.";
      return;
    }

    const rowsMap = progressByUser.get(selectedStudentId) || new Map();
    const filters = getFilters();
    const modulesToShow = filters.module === "all" ? activeModules : activeModules.filter((m) => String(m.id) === filters.module);

    let html = "";

    for (const mod of modulesToShow) {
      const total = mod.exerciseIds.length;
      const completedCount = mod.exerciseIds.filter((id) => {
        const row = rowsMap.get(id);
        return row && row.completed;
      }).length;

      const exerciseRowsHtml = mod.exerciseIds
        .map((exId) => {
          const row = rowsMap.get(exId);
          if (!passesFilters(row, filters)) return "";

          const content = exerciseContentCache.get(exId);
          const number = content ? content.number : "";
          const title = content ? content.title : exId;
          const isComplete = Boolean(row && row.completed);
          const blocksHtml = content
            ? content.blocks
                .map(
                  (b) =>
                    `<div class="exercise-block"><span class="block-label">${escapeHtml(b.label)}</span>${b.html}</div>`
                )
                .join("")
            : "";

          const notes = row && row.notes ? row.notes.trim() : "";
          const notesHtml = notes
            ? `<div class="readonly-notes">${escapeHtml(notes)}</div>`
            : `<div class="readonly-notes is-empty">No answer yet.</div>`;
          const updated = row && row.updated_at ? new Date(row.updated_at).toLocaleString() : "—";

          return `
            <section class="exercise${isComplete ? " is-complete" : ""}">
              <div class="exercise-header">
                <div class="exercise-title"><span class="exercise-number">${escapeHtml(number)}</span><h3>${escapeHtml(title)}</h3></div>
                <span class="exercise-complete-badge">✓ Complete</span>
              </div>
              ${blocksHtml}
              <p class="supervisor-response-label">Student's response:</p>
              ${notesHtml}
              <p class="supervisor-meta">Last updated: ${escapeHtml(updated)}</p>
            </section>`;
        })
        .join("");

      if (!exerciseRowsHtml.trim()) continue;

      html += `
        <div class="module-progress-heading">
          <h2>Module ${mod.number} — ${escapeHtml(mod.title)}${mod.archived ? ' <span class="archived-tag">Archived original · read-only</span>' : ""}</h2>
          <span class="progress-count">${completedCount} / ${total} complete</span>
        </div>
        ${exerciseRowsHtml}`;
    }

    el.modulesContainer.innerHTML = html;
    el.noDataMessage.hidden = Boolean(html.trim());
    if (!html.trim()) el.noDataMessage.textContent = "No exercises match the current filters.";
    markScrollableRegions(el.modulesContainer);
  }

  // Same as markScrollableRegions in app.js (not loaded on this page): a
  // keyboard stop on copied code blocks, diagrams and tables only while they
  // overflow sideways, re-checked by a ResizeObserver whenever their size
  // changes. Only tabindex values set here are ever removed.
  const scrollObserver = "ResizeObserver" in global
    ? new ResizeObserver((entries) => entries.forEach((entry) => updateScrollFocus(entry.target)))
    : null;

  function markScrollableRegions(root) {
    if (scrollObserver) scrollObserver.disconnect(); // blocks from the previous render are gone
    root.querySelectorAll(".command-block, .fastq-anatomy, .comparison-table-wrap").forEach((node) => {
      updateScrollFocus(node);
      if (scrollObserver) scrollObserver.observe(node);
    });
  }

  function updateScrollFocus(node) {
    const overflows = node.scrollWidth > node.clientWidth + 1;
    if (overflows && !node.hasAttribute("tabindex")) {
      node.setAttribute("tabindex", "0");
      node.setAttribute("data-scroll-focus", "");
    } else if (!overflows && node.hasAttribute("data-scroll-focus")) {
      node.removeAttribute("tabindex");
      node.removeAttribute("data-scroll-focus");
    }
  }

  initAuth();
})(window);
