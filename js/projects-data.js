/**
 * projects-data.js
 *
 * Platform and project identities for HoloBase. The platform brand is
 * shared (authentication pages, dashboard); each project keeps its own
 * scientific identity on its own pages.
 *
 * Naming convention: every page shows `displayName` (e.g. "Great Auk") and
 * `subtitle` (e.g. "Ancient DNA & Comparative Genomics"); `fullName` joins
 * them. `name` is only the `projects` table's seeded value, kept for
 * reference — it is never shown: the sidebar switcher and the dashboard look
 * the display name up by slug (projectDisplayName), so the convention needs
 * no Supabase change. Slugs never change.
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
      name: "Great Auk Comparative Genomics", // projects.name in Supabase (not displayed)
      displayName: "Great Auk",
      subtitle: "Ancient DNA & Comparative Genomics",
      status: "active",
      basePath: "great-auk/",
      publicDescription:
        "A step-by-step guide to analysing genomic data from the Great Auk and its living relatives.",
      artwork: {
        src: "assets/great-auk-banner.jpg",
        alt: "Illustration of a Great Auk (Pinguinus impennis) standing on snowy rocks above an Arctic shoreline, with a DNA helix, a phylogenetic tree and sequencing traces drawn across the sky.",
        position: "50% 50%",
      },
      accent: "#2f6690",
    },
    {
      slug: "thylacine-rna",
      name: "Thylacine RNA", // projects.name in Supabase (not displayed)
      displayName: "Thylacine",
      subtitle: "Ancient RNA & Transcriptomics",
      status: "active",
      basePath: "thylacine/",
      publicDescription:
        "A step-by-step guide to analysing ancient RNA and transcriptomic data from the Thylacine.",
      artwork: {
        src: "assets/thylacine-banner.jpg",
        alt: "Illustration of a thylacine standing on a rocky outcrop above a Tasmanian landscape, with an RNA helix and sequencing traces drawn across the sky.",
        position: "50% 50%",
      },
      accent: "#9c4727",
    },
  ];

  PROJECTS.forEach((p) => {
    p.homePage = p.basePath + "index.html";
    p.fullName = `${p.displayName} — ${p.subtitle}`;
  });

  // The name to show for a project slug; `fallback` (e.g. the database's
  // projects.name) is used only for a slug this file doesn't know.
  function projectDisplayName(slug, fallback) {
    const project = PROJECTS.find((p) => p.slug === slug);
    return project ? project.displayName : fallback || slug;
  }

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
  global.GreatAuk.projectDisplayName = projectDisplayName;
})(window);
