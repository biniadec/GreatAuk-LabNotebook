/**
 * projects-data.js
 *
 * Describes the projects (courses) this platform hosts, matching the
 * `projects` table's seeded rows. Great Auk reuses the existing
 * modules-data.js (its MODULES array) unchanged — this file doesn't
 * duplicate that, it just records where to find it and what to call it.
 * Thylacine RNA has no module content yet by design (see thylacine/
 * index.html) — its exercises will be designed later with real data.
 */

(function (global) {
  "use strict";

  const PROJECTS = [
    {
      slug: "great-auk",
      name: "Great Auk Comparative Genomics",
      status: "active",
      homePage: "index.html",
    },
    {
      slug: "thylacine-rna",
      name: "Thylacine RNA",
      status: "placeholder",
      homePage: "thylacine/index.html",
    },
  ];

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.PROJECTS = PROJECTS;
})(window);
