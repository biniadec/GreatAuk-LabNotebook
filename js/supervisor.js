/**
 * supervisor.js
 *
 * Drives supervisor.html: a read-only instructor view of a student's
 * exercise_progress rows. This file never writes to exercise_progress —
 * only `select` calls are made against it. Authorization is enforced by
 * Supabase RLS (the "Instructors can read all progress rows" policy,
 * backed by the public.instructors allowlist table), not by anything in
 * this script — hiding or showing elements here is presentation only.
 *
 * Exercise text (title, Concept/Task/Check-yourself) is never duplicated
 * here. It is fetched live from each active module's real HTML page and
 * parsed, so the supervisor view always reflects the actual course content.
 */

(function (global) {
  "use strict";

  const TABLE = "exercise_progress";
  const INSTRUCTORS_TABLE = "instructors";

  const el = {
    signOutBtn: document.querySelector('[data-role="sign-out-btn"]'),
    loginView: document.querySelector('[data-role="login-view"]'),
    loginForm: document.querySelector('[data-role="login-form"]'),
    loginError: document.querySelector('[data-role="login-error"]'),
    loginSubmit: document.querySelector('[data-role="login-submit"]'),
    deniedView: document.querySelector('[data-role="denied-view"]'),
    mainView: document.querySelector('[data-role="main-view"]'),
    identityPicker: document.querySelector('[data-role="identity-picker"]'),
    identityNote: document.querySelector('[data-role="identity-note"]'),
    identitySelect: document.querySelector('[data-role="identity-select"]'),
    identityLabel: document.querySelector('[data-role="identity-label"]'),
    filterModule: document.querySelector('[data-role="filter-module"]'),
    filterCompletion: document.querySelector('[data-role="filter-completion"]'),
    filterAnswer: document.querySelector('[data-role="filter-answer"]'),
    modulesContainer: document.querySelector('[data-role="modules-container"]'),
    noDataMessage: document.querySelector('[data-role="no-data-message"]'),
  };

  // identities: Map<user_id, { user_id, student_label, rows: Map<exercise_id, row> }>
  let identities = new Map();
  let selectedUserId = null;
  // exerciseContentCache: Map<exercise_id, { number, title, blocks: [{label, html}] }>
  let exerciseContentCache = new Map();
  let activeModules = [];

  function getClient() {
    return global.GreatAuk && global.GreatAuk.supabase;
  }

  function showOnly(viewEl) {
    [el.loginView, el.deniedView, el.mainView].forEach((v) => {
      if (v) v.hidden = v !== viewEl;
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function shortId(uuid) {
    return uuid ? uuid.slice(0, 8) : "unknown";
  }

  // ---- auth -------------------------------------------------------------

  async function handleSession(session) {
    if (!session) {
      el.signOutBtn.hidden = true;
      showOnly(el.loginView);
      el.loginView.hidden = false;
      return;
    }
    el.signOutBtn.hidden = false;
    const client = getClient();
    try {
      const { data, error } = await client
        .from(INSTRUCTORS_TABLE)
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        showOnly(el.deniedView);
        el.deniedView.hidden = false;
        return;
      }
      showOnly(el.mainView);
      el.mainView.hidden = false;
      await loadAndRender();
    } catch (err) {
      console.error("[Supervisor] Authorization check failed.", err);
      showOnly(el.deniedView);
      el.deniedView.hidden = false;
    }
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
  });

  // ---- data loading -------------------------------------------------------

  async function fetchProgressRows() {
    const client = getClient();
    const { data, error } = await client
      .from(TABLE)
      .select("user_id, exercise_id, completed, notes, student_label, updated_at");
    if (error) throw error;
    return data || [];
  }

  function groupByIdentity(rows) {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.user_id)) {
        map.set(row.user_id, { user_id: row.user_id, student_label: row.student_label, rows: new Map() });
      }
      map.get(row.user_id).rows.set(row.exercise_id, row);
    }
    return map;
  }

  function latestUpdate(identity) {
    let latest = null;
    for (const row of identity.rows.values()) {
      if (row.updated_at && (!latest || row.updated_at > latest)) latest = row.updated_at;
    }
    return latest;
  }

  function renderIdentityPicker() {
    const list = Array.from(identities.values());
    const luigiIdentities = list.filter((i) => i.student_label === "Luigi");

    if (list.length <= 1) {
      el.identityPicker.hidden = true;
      selectedUserId = list.length === 1 ? list[0].user_id : null;
      return;
    }

    el.identityPicker.hidden = false;

    if (luigiIdentities.length > 1) {
      const items = luigiIdentities
        .map((i) => {
          const count = i.rows.size;
          const updated = latestUpdate(i);
          return `<li><code>${shortId(i.user_id)}…</code> — ${count} row(s), last updated ${updated ? escapeHtml(updated) : "never"}</li>`;
        })
        .join("");
      el.identityNote.innerHTML = `
        <div class="callout-warning">
          <strong>More than one anonymous identity is labeled "Luigi".</strong>
          These are separate Supabase users. Their data is shown separately below and is never merged — pick one at a time.
          <ul class="identity-list">${items}</ul>
        </div>`;
    } else {
      el.identityNote.innerHTML = `<p class="supervisor-meta">Multiple identities were found. Select one to view below.</p>`;
    }

    // sort by most recently updated first
    list.sort((a, b) => {
      const au = latestUpdate(a) || "";
      const bu = latestUpdate(b) || "";
      return bu.localeCompare(au);
    });

    el.identitySelect.innerHTML = list
      .map((i) => {
        const label = i.student_label ? escapeHtml(i.student_label) : "Unlabeled identity";
        return `<option value="${i.user_id}">${label} — ${shortId(i.user_id)}… (${i.rows.size} rows)</option>`;
      })
      .join("");

    selectedUserId = list[0].user_id;
    el.identitySelect.value = selectedUserId;
  }

  el.identitySelect.addEventListener("change", () => {
    selectedUserId = el.identitySelect.value;
    renderModules();
  });

  // ---- exercise content (fetched live from the real module pages) -------

  async function loadExerciseContent() {
    const modules = (global.GreatAuk.MODULES || []).filter((m) => m.status === "active" && m.exerciseIds.length > 0);
    activeModules = modules;

    await Promise.all(
      modules.map(async (mod) => {
        try {
          const resp = await fetch(`modules/${mod.slug}.html`);
          const html = await resp.text();
          const doc = new DOMParser().parseFromString(html, "text/html");
          for (const exId of mod.exerciseIds) {
            const content = extractExerciseContent(doc, exId);
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
        .map((m) => `<option value="${m.id}">Module ${m.number} — ${escapeHtml(m.title)}</option>`)
        .join("");
  }

  [el.filterModule, el.filterCompletion, el.filterAnswer].forEach((select) => {
    select.addEventListener("change", renderModules);
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

  function renderModules() {
    const filters = getFilters();
    const identity = selectedUserId ? identities.get(selectedUserId) : null;

    el.identityLabel.textContent = identity
      ? `Showing progress for: ${identity.student_label || "Unlabeled identity"} — ${shortId(identity.user_id)}…`
      : "";

    const rowsMap = identity ? identity.rows : new Map();
    const modulesToShow = filters.module === "all" ? activeModules : activeModules.filter((m) => String(m.id) === filters.module);

    let html = "";
    let anyExerciseShown = false;

    for (const mod of modulesToShow) {
      const total = mod.exerciseIds.length;
      const completedCount = mod.exerciseIds.filter((id) => rowsMap.get(id) && rowsMap.get(id).completed).length;

      const exerciseRowsHtml = mod.exerciseIds
        .map((exId) => {
          const row = rowsMap.get(exId);
          if (!passesFilters(row, filters)) return "";
          anyExerciseShown = true;

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
              <p class="supervisor-response-label">Luigi's response:</p>
              ${notesHtml}
              <p class="supervisor-meta">Last updated: ${escapeHtml(updated)}</p>
            </section>`;
        })
        .join("");

      if (!exerciseRowsHtml.trim()) continue;

      html += `
        <div class="module-progress-heading">
          <h2>Module ${mod.number} — ${escapeHtml(mod.title)}</h2>
          <span class="progress-count">${completedCount} / ${total} complete</span>
        </div>
        ${exerciseRowsHtml}`;
    }

    el.modulesContainer.innerHTML = html;
    el.noDataMessage.hidden = identities.size > 0;
  }

  // ---- orchestration --------------------------------------------------------

  async function loadAndRender() {
    try {
      const rows = await fetchProgressRows();
      identities = groupByIdentity(rows);
      renderIdentityPicker();

      if (exerciseContentCache.size === 0) {
        await loadExerciseContent();
        populateModuleFilter();
      }

      renderModules();
    } catch (err) {
      console.error("[Supervisor] Failed to load progress data.", err);
      el.noDataMessage.hidden = false;
      el.noDataMessage.textContent = "Could not load progress data: " + (err.message || "unknown error.");
    }
  }

  initAuth();
})(window);
