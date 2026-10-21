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
    homePage: "index.html",
  };

  // `publicDescription` and `artwork` are shown on the public HoloBase
  // homepage to visitors who are not signed in — keep them to wording
  // approved for public view. Nothing else about a project is public.

  const PROJECTS = [
    {
      slug: "great-auk",
      name: "Great Auk Comparative Genomics",
      displayName: "Great Auk",
      subtitle: "Comparative Genomics",
      status: "active",
      basePath: "great-auk/",
      publicDescription:
        "A step-by-step guide to analysing genomic data from the Great Auk and its living relatives.",
      artwork: {
        src: "assets/great-auk-hero.png",
        alt: "A Great Auk (Pinguinus impennis) standing on snow and ice, with mountains in the background",
        position: "50% 6%",
      },
      accent: "#2f6690",
    },
    {
      slug: "thylacine-rna",
      name: "Thylacine RNA",
      displayName: "Thylacine RNA",
      subtitle: "Ancient Transcriptomics",
      status: "active",
      basePath: "thylacine/",
      publicDescription:
        "A step-by-step training notebook for the Thylacine RNA ancient transcriptomics project.",
      artwork: {
        src: "assets/thylacine-banner.jpg",
        alt: "Illustration of a thylacine standing on a rocky outcrop above a Tasmanian landscape, with an RNA helix and sequencing traces drawn across the sky.",
        position: "22% 50%",
      },
      accent: "#9c4727",
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
