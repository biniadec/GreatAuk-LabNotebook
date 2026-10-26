/**
 * thylacine-toolbox.js
 *
 * Thylacine RNA's Terminal Toolbox shows the same, project-neutral Linux
 * reference as Great Auk's toolbox.html (one shared source): only the intro
 * and the command groups are taken; Great Auk's sidebar, breadcrumb, footer
 * and scripts are not. If it fails to load, an error with Retry is shown.
 */

(function (global) {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    const GA = global.GreatAuk;
    const root = typeof GA.ROOT_PREFIX === "string" ? GA.ROOT_PREFIX : "../";
    const target = document.querySelector('[data-role="shared-content"]');

    GA.SharedContent.mountSharedContent(
      target,
      { url: root + GA.projectPath("great-auk", "toolbox.html"), pick: [".page-intro", ".toolbox-group"] },
      () => {
        if (GA.injectIcons) GA.injectIcons(target);
      }
    );
  });
})(window);
