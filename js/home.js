/**
 * home.js
 *
 * Populates the dynamic parts of the home dashboard: the overall-progress
 * donut, the module card grid (with embedded icons and progress bars),
 * and the "Continue Learning" card + hero CTA — all computed from
 * ProgressStore + MODULES data.
 */

(function () {
  "use strict";

  const DONUT_CIRCUMFERENCE = 213.6; // 2 * PI * r(34), matches the inline SVG in index.html

  document.addEventListener("DOMContentLoaded", async () => {
    const { MODULES, ProgressStore: store } = window.GreatAuk;

    // Archived modules (the original Great Auk Module 00) can't be completed
    // any more, so they don't count towards progress or "continue learning".
    const countable = MODULES.filter((m) => !m.archived);
    const allExerciseIds = countable.flatMap((m) => m.exerciseIds);
    const [completedMap, notesMap] = await Promise.all([store.getCompletionMap(), store.getNotesMap()]);

    renderOverallProgress(countable, allExerciseIds, completedMap);
    renderModuleGrid(MODULES, completedMap, notesMap);
    renderContinueLearning(countable, completedMap);
  });

  // Card for the shared HoloBase course, shown first in every project.
  function sharedFoundationCard(icons) {
    const f = window.GreatAuk.SHARED_FOUNDATION;
    if (!f) return "";
    const root = typeof window.GreatAuk.ROOT_PREFIX === "string" ? window.GreatAuk.ROOT_PREFIX : "../";
    return `
        <a class="card module-card module-card--shared" href="${root}${f.path}" data-module-card="shared-foundation">
          <span class="module-thumb">${icons["module-00"] || ""}</span>
          <span class="module-card-body">
            <span class="module-card-title-row">
              <span class="module-number">${f.number}</span>
              <h3>${f.title}</h3>
            </span>
            <span class="module-card-tags"><span class="module-tag">Shared · all projects</span><span class="module-tag module-tag--status">${f.status}</span></span>
            <p>${f.summary}</p>
            <div class="module-card-foot"><span class="placeholder-note">HoloBase course · progress saved in this browser for now</span></div>
          </span>
          <span class="module-chevron">${icons.chevronRight}</span>
        </a>`;
  }

  function renderOverallProgress(modules, allExerciseIds, completedMap) {
    const total = allExerciseIds.length;
    const completed = allExerciseIds.filter((id) => completedMap[id]).length;
    const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

    const donutFill = document.querySelector("[data-role='donut-fill']");
    const bigNumber = document.querySelector("[data-role='overall-progress-number']");
    const sub = document.querySelector("[data-role='overall-progress-sub']");
    const startedLabel = document.querySelector("[data-role='modules-started-label']");

    if (donutFill) {
      const offset = DONUT_CIRCUMFERENCE * (1 - pct / 100);
      donutFill.style.strokeDashoffset = String(offset);
    }
    if (bigNumber) bigNumber.textContent = pct + "%";
    if (sub) sub.textContent = `${completed} / ${total} exercises complete`;

    const modulesStarted = modules.filter((m) =>
      m.exerciseIds.some((id) => completedMap[id])
    ).length;
    if (startedLabel) startedLabel.textContent = `${modulesStarted} / ${modules.length} modules started`;
  }

  function renderModuleGrid(modules, completedMap, notesMap) {
    const grid = document.getElementById("module-grid");
    if (!grid) return;

    const icons = window.GreatAuk.ICONS;
    // An archived module is listed only for someone with saved work in it.
    const hasSavedWork = (mod) => mod.exerciseIds.some((id) => completedMap[id] || (notesMap && notesMap[id]));
    const visible = modules.filter((m) => !m.archived || hasSavedWork(m));

    grid.innerHTML = sharedFoundationCard(icons) + visible.map((mod) => {
      const iconKey = mod.icon || "module-" + mod.number;
      const thumbIcon = icons[iconKey] || "";
      const total = mod.exerciseIds.length;
      // Optional: which computing environment a module needs (Thylacine
      // modules define this; Great Auk's don't, so their cards are unchanged).
      const envBadge = mod.environment
        ? `<span class="env-badge env-badge--${mod.environment.kind}">${mod.environment.label}</span>`
        : "";

      let footBlock;
      if (mod.archived) {
        const completed = mod.exerciseIds.filter((id) => completedMap[id]).length;
        footBlock = `
          <div class="module-card-foot">
            <span class="exercises-count" data-role="card-progress-label">Archived original · read-only · ${completed} / ${total} exercises</span>
          </div>`;
      } else if (mod.status === "active" && total > 0) {
        const completed = mod.exerciseIds.filter((id) => completedMap[id]).length;
        const pct = Math.round((completed / total) * 100);
        footBlock = `
          <div class="module-card-foot">
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span class="exercises-count" data-role="card-progress-label">${completed} / ${total} exercises</span>
          </div>`;
      } else {
        footBlock = `
          <div class="module-card-foot">
            <span class="placeholder-note">Coming soon</span>
          </div>`;
      }

      return `
        <a class="card module-card" href="modules/${mod.slug}.html" data-module-card="${mod.slug}">
          <span class="module-thumb">${thumbIcon}</span>
          <span class="module-card-body">
            <span class="module-card-title-row">
              <span class="module-number">${mod.number}</span>
              <h3>${mod.title}${mod.archived ? " (archived original)" : ""}</h3>
            </span>${envBadge}
            <p>${mod.summary}</p>
            ${footBlock}
          </span>
          <span class="module-chevron">${icons.chevronRight}</span>
        </a>`;
    }).join("");
  }

  function renderContinueLearning(modules, completedMap) {
    const compactLink = document.querySelector("[data-role='continue-link']");
    const heroLink = document.querySelector("[data-role='continue-link-hero']");
    if (!compactLink) return;

    const activeModules = modules.filter((m) => m.status === "active" && m.exerciseIds.length > 0);
    if (activeModules.length === 0) {
      // No project module is ready yet: start with the shared course.
      const f = window.GreatAuk.SHARED_FOUNDATION;
      if (!f) return;
      const root = typeof window.GreatAuk.ROOT_PREFIX === "string" ? window.GreatAuk.ROOT_PREFIX : "../";
      const set = (role, text) => { const n = compactLink.querySelector(`[data-role='${role}']`); if (n) n.textContent = text; };
      set("continue-label", "Start here");
      set("continue-title", `Module ${f.number}: ${f.title}`);
      set("continue-sub", "Shared HoloBase training for all projects — the first step before any project module.");
      set("continue-cta", "Open Module 00 →");
      compactLink.href = root + f.path;
      if (heroLink) heroLink.href = root + f.path;
      return;
    }

    const labelEl = compactLink.querySelector("[data-role='continue-label']");
    const titleEl = compactLink.querySelector("[data-role='continue-title']");
    const subEl = compactLink.querySelector("[data-role='continue-sub']");
    const ctaEl = compactLink.querySelector("[data-role='continue-cta']");

    // Find the first active module (in course order) that still has an
    // incomplete exercise, so progress naturally advances from one active
    // module to the next rather than getting stuck on the first one.
    let targetModule = null;
    let firstIncompleteIndex = -1;
    for (const mod of activeModules) {
      const idx = mod.exerciseIds.findIndex((id) => !completedMap[id]);
      if (idx !== -1) {
        targetModule = mod;
        firstIncompleteIndex = idx;
        break;
      }
    }

    if (!targetModule) {
      // Every active module is fully complete.
      const lastActive = activeModules[activeModules.length - 1];
      labelEl.textContent = "All active modules complete";
      titleEl.textContent = "Nice work — every exercise so far is done";
      subEl.textContent = "The next module is still a placeholder — check back once it has been developed.";
      ctaEl.textContent = `Review Module ${lastActive.number} →`;
      compactLink.href = `modules/${lastActive.slug}.html`;
      if (heroLink) heroLink.href = `modules/${lastActive.slug}.html`;
      return;
    }

    const exerciseNumber = firstIncompleteIndex + 1;
    const exerciseId = targetModule.exerciseIds[firstIncompleteIndex];
    const isFirst = firstIncompleteIndex === 0;
    const href = `modules/${targetModule.slug}.html#${exerciseId}`;

    labelEl.textContent = `Module ${targetModule.number}`;
    titleEl.textContent = isFirst ? "Start with Exercise 1" : `Exercise ${exerciseNumber}`;
    subEl.textContent = targetModule.summary;
    ctaEl.textContent = "Go to Exercise →";
    compactLink.href = href;
    if (heroLink) heroLink.href = href;
  }
})();
