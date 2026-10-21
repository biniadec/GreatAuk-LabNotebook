/**
 * projects-data.js
 *
 * Platform and project identities for HoloBase. The platform brand is
 * shared (authentication pages, dashboard); each project keeps its own
 * scientific identity on its own pages. `name` matches the `projects`
 * table's seeded rows (shown in the dashboard); `subtitle` is frontend-only.
 * Module lists live in modules-data.js (Great Auk) and
 * thylacine-modules-data.js (Thylacine RNA).
 *
 * This is the ONE place a project's location on the site is defined:
 * `basePath` is its folder relative to the site root, and `homePage` is
 * derived from it. auth-guard.js, landing-page.js, supervisor.js and the
 * Thylacine shared-content loaders all resolve project paths through
 * PROJECT_HOME_PAGES / projectPath() below — so moving a project means
 * changing its basePath here and nothing else in the JavaScript.
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
      basePath: "",
    },
    {
      slug: "thylacine-rna",
      name: "Thylacine RNA",
      displayName: "Thylacine RNA",
      subtitle: "Ancient Transcriptomics",
      status: "active",
      basePath: "thylacine/",
    },
  ];

  PROJECTS.forEach((p) => {
    p.homePage = p.basePath + "index.html";
  });

  // slug -> home page, relative to the site root.
  const PROJECT_HOME_PAGES = {};
  PROJECTS.forEach((p) => {
    PROJECT_HOME_PAGES[p.slug] = p.homePage;
  });

  // A page inside a project, relative to the site root:
  // projectPath("great-auk", "modules/00-getting-started.html").
  function projectPath(slug, relativePath) {
    const project = PROJECTS.find((p) => p.slug === slug);
    if (!project) throw new Error(`Unknown project slug: ${slug}`);
    return project.basePath + relativePath;
  }

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.PLATFORM = PLATFORM;
  global.GreatAuk.PROJECTS = PROJECTS;
  global.GreatAuk.PROJECT_HOME_PAGES = PROJECT_HOME_PAGES;
  global.GreatAuk.projectPath = projectPath;
})(window);
