/**
 * thylacine-module00.js
 *
 * Builds Thylacine RNA's Module 00 from Great Auk's Module 00 page — one
 * shared source of teaching content — with Thylacine's own header, progress
 * bar, footer and navigation around it, and every exercise ID rewritten
 * from m0-exNN to thy-m00-exNN so progress and answers stay independent.
 *
 * The page sets GreatAuk.DEFER_MODULE_INIT, so progress tracking starts only
 * here, after the content has loaded AND its IDs have been rewritten and
 * validated against Thylacine's module list. If loading or validation fails,
 * shared-content.js shows an error with a Retry button and no exercises —
 * nothing is initialised and nothing is saved.
 */

(function (global) {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const GA = global.GreatAuk;
    const mod = GA.MODULES.find((m) => m.id === 0);
    const root = typeof GA.ROOT_PREFIX === "string" ? GA.ROOT_PREFIX : "../../";

    const target = document.querySelector('[data-role="shared-content"]');
    const header = document.querySelector('[data-role="module-header"]');
    const objectivesSlot = document.querySelector('[data-role="shared-objectives"]');
    const progressBar = document.querySelector('[data-role="module-progress"]');

    GA.SharedContent.mountSharedContent(
      target,
      {
        url: root + mod.sharedContent.path,
        pick: [".module-header .module-intro", ".objectives-card", "section.exercise", ".summary-card"],
        rewrite: { pattern: /\bm0-ex(\d{2})\b/g, replace: "thy-m00-ex$1" },
        validation: {
          requiredPrefix: "thy-m00-",
          expectedIds: mod.exerciseIds,
          forbiddenPattern: /\bm0-ex\d{2}\b/,
        },
        // Same layout as Great Auk's page: intro inside the header,
        // objectives above the progress bar, exercises and summary below it.
        place(fragment, container) {
          for (const node of Array.from(fragment.childNodes)) {
            if (node.nodeType !== 1) continue;
            if (node.matches(".module-intro")) header.appendChild(node);
            else if (node.matches(".objectives-card")) objectivesSlot.appendChild(node);
            else container.appendChild(node);
          }
        },
      },
      async () => {
        if (GA.injectIcons) GA.injectIcons(document);
        progressBar.hidden = false;
        await GA.initModulePage();
      }
    );
  });
})(window);
