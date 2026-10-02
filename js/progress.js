/**
 * progress.js
 *
 * Wires up the interactive parts of a module page:
 *  - completion checkboxes (persisted via ProgressStore)
 *  - notes textareas (persisted via ProgressStore, debounced)
 *  - copy-to-clipboard buttons on command blocks
 *  - the module's own progress bar
 *
 * Expects each exercise to be a .exercise element with a
 * [data-exercise-id] attribute, containing:
 *   input[type=checkbox][data-role="complete-checkbox"]
 *   textarea[data-role="notes"]
 * and optionally .copy-btn buttons with a sibling .command-block.
 */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    initExercises();
    initCopyButtons();
  });

  function initExercises() {
    const exerciseEls = Array.from(document.querySelectorAll("[data-exercise-id]"));
    if (exerciseEls.length === 0) return;

    const store = window.GreatAuk.ProgressStore;

    exerciseEls.forEach(async (el) => {
      const id = el.getAttribute("data-exercise-id");
      const checkbox = el.querySelector('[data-role="complete-checkbox"]');
      const textarea = el.querySelector('[data-role="notes"]');
      const saveStatus = el.querySelector('[data-role="notes-status"]');

      const [isComplete, notes] = await Promise.all([
        store.isExerciseComplete(id),
        store.getExerciseNotes(id),
      ]);

      if (checkbox) {
        checkbox.checked = isComplete;
        setExerciseVisualState(el, isComplete);
        checkbox.addEventListener("change", async () => {
          await store.setExerciseComplete(id, checkbox.checked);
          setExerciseVisualState(el, checkbox.checked);
          updateModuleProgressBar();
        });
      }

      if (textarea) {
        textarea.value = notes;
        let debounceTimer = null;
        textarea.addEventListener("input", () => {
          if (saveStatus) saveStatus.textContent = "Saving…";
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            await store.setExerciseNotes(id, textarea.value);
            if (saveStatus) {
              saveStatus.textContent = "Saved";
              setTimeout(() => {
                if (saveStatus.textContent === "Saved") saveStatus.textContent = "";
              }, 1500);
            }
          }, 500);
        });
      }
    });

    updateModuleProgressBar();
  }

  function setExerciseVisualState(el, isComplete) {
    el.classList.toggle("is-complete", isComplete);
  }

  async function updateModuleProgressBar() {
    const bar = document.querySelector("[data-role='module-progress']");
    if (!bar) return;

    const exerciseEls = Array.from(document.querySelectorAll("[data-exercise-id]"));
    const ids = exerciseEls.map((el) => el.getAttribute("data-exercise-id"));
    const store = window.GreatAuk.ProgressStore;
    const completed = await store.countCompleted(ids);
    const total = ids.length;
    const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

    const fill = bar.querySelector(".progress-fill");
    const label = bar.querySelector("[data-role='module-progress-label']");
    if (fill) fill.style.width = pct + "%";
    if (label) label.textContent = `${completed} of ${total} exercises complete`;
  }

  function initCopyButtons() {
    document.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const targetSelector = btn.getAttribute("data-copy-target");
        const block = targetSelector
          ? document.querySelector(targetSelector)
          : btn.closest(".command-block");
        if (!block) return;

        const text = block.getAttribute("data-command") || block.innerText;
        try {
          await navigator.clipboard.writeText(text.trim());
        } catch (err) {
          console.warn("[GreatAuk] clipboard copy failed", err);
          return;
        }
        const original = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("copied");
        }, 1400);
      });
    });
  }
})();
