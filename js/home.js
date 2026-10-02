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

    const allExerciseIds = MODULES.flatMap((m) => m.exerciseIds);
    const completedMap = await store.getCompletionMap();

    renderOverallProgress(MODULES, allExerciseIds, completedMap);
    renderModuleGrid(MODULES, completedMap);
    renderContinueLearning(MODULES, completedMap);
  });

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

  function renderModuleGrid(modules, completedMap) {
    const grid = document.getElementById("module-grid");
    if (!grid) return;

    const icons = window.GreatAuk.ICONS;

    grid.innerHTML = modules.map((mod) => {
      const iconKey = "module-" + mod.number;
      const thumbIcon = icons[iconKey] || "";
      const total = mod.exerciseIds.length;

      let footBlock;
      if (mod.status === "active" && total > 0) {
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
              <h3>${mod.title}</h3>
            </span>
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

    const activeModule = modules.find((m) => m.status === "active" && m.exerciseIds.length > 0);
    if (!activeModule) return;

    const firstIncompleteIndex = activeModule.exerciseIds.findIndex((id) => !completedMap[id]);
    const labelEl = compactLink.querySelector("[data-role='continue-label']");
    const titleEl = compactLink.querySelector("[data-role='continue-title']");
    const subEl = compactLink.querySelector("[data-role='continue-sub']");
    const ctaEl = compactLink.querySelector("[data-role='continue-cta']");

    if (firstIncompleteIndex === -1) {
      labelEl.textContent = `Module ${activeModule.number} complete`;
      titleEl.textContent = "Nice work — every exercise is done";
      subEl.textContent = "Module 02 is still a placeholder — check back once it has been developed.";
      ctaEl.textContent = "Review Module 01 →";
      compactLink.href = `modules/${activeModule.slug}.html`;
      if (heroLink) heroLink.href = `modules/${activeModule.slug}.html`;
      return;
    }

    const exerciseNumber = firstIncompleteIndex + 1;
    const exerciseId = activeModule.exerciseIds[firstIncompleteIndex];
    const isFirst = firstIncompleteIndex === 0;
    const href = `modules/${activeModule.slug}.html#${exerciseId}`;

    labelEl.textContent = `Module ${activeModule.number}`;
    titleEl.textContent = isFirst ? "Start with Exercise 1" : `Exercise ${exerciseNumber}`;
    subEl.textContent = activeModule.summary;
    ctaEl.textContent = "Go to Exercise →";
    compactLink.href = href;
    if (heroLink) heroLink.href = href;
  }
})();
