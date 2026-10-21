/**
 * projects-data.js
 *
 * Platform and project identities for HoloBase. The platform brand is
 * shared (authentication pages, dashboard); each project keeps its own
 * scientific identity on its own pages. `name` matches the `projects`
 * table's seeded rows (shown in the dashboard); `subtitle` is frontend-only.
 * Module lists live in modules-data.js (Great Auk) and
 * thylacine-modules-data.js (Thylacine RNA).
 */

(function (global) {
  "use strict";

  const PLATFORM = {
    name: "HoloBase",
    tagline: "Evolutionary Hologenomics Training Hub",
  };

  const PROJECTS = [
    {
      slug: "great-auk",
      name: "Great Auk Comparative Genomics",
      displayName: "Great Auk",
      subtitle: "Comparative Genomics",
      status: "active",
      homePage: "index.html",
    },
    {
      slug: "thylacine-rna",
      name: "Thylacine RNA",
      displayName: "Thylacine RNA",
      subtitle: "Ancient Transcriptomics",
      status: "active",
      homePage: "thylacine/index.html",
    },
  ];

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.PLATFORM = PLATFORM;
  global.GreatAuk.PROJECTS = PROJECTS;
})(window);
