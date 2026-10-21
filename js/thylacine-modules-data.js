/**
 * thylacine-modules-data.js
 *
 * Module list for Thylacine RNA — Ancient Transcriptomics, in the agreed
 * order: Module 00 (Mjolnir, shared with Great Auk), then the workflow
 * without UMIs (01 preprocessing, 02 analysis) before the workflow with UMIs
 * (03 preprocessing, 04 analysis).
 *
 * Must load AFTER modules-data.js: Module 00's exercise IDs are derived from
 * Great Auk's Module 00 list, so adding or removing an exercise there flows
 * through here automatically. Every Thylacine exercise ID starts with
 * "thy-" (Module 00: m0-exNN -> thy-m00-exNN), keeping them collision-free
 * under exercise_progress's (user_id, exercise_id) unique constraint and
 * fully independent of a student's Great Auk progress.
 *
 * Modules 01-04 are placeholders on purpose: their exercises will be written
 * from Emilio's actual data, scripts and workflows, and reviewed separately.
 * Nothing scientific here is invented — only titles, order and the
 * computing environment each module uses.
 */

(function (global) {
  "use strict";

  const registry = (global.GreatAuk && global.GreatAuk.MODULES_BY_PROJECT) || {};
  const greatAukModules = registry["great-auk"];
  if (!greatAukModules) {
    throw new Error("thylacine-modules-data.js requires modules-data.js to be loaded first.");
  }
  const sharedModule00 = greatAukModules.find((m) => m.id === 0);

  const ENVIRONMENTS = {
    mjolnir: { kind: "mjolnir", label: "Mjolnir · terminal" },
    localR: { kind: "local-r", label: "Local · R + RStudio" },
  };

  const MODULES = [
    {
      id: 0,
      slug: "00-getting-started",
      number: "00",
      title: "Getting Started on Mjolnir",
      status: "active",
      summary:
        "Prepare to work independently on the UCPH Mjolnir HPC cluster before starting the Thylacine RNA analysis.",
      environment: ENVIRONMENTS.mjolnir,
      exerciseIds: sharedModule00.exerciseIds.map((id) => id.replace(/^m0-/, "thy-m00-")),
      // Teaching content comes from Great Auk's Module 00 page (one shared
      // source); `path` is relative to that project's folder, resolved
      // through GreatAuk.projectPath() in projects-data.js.
      sharedContent: {
        project: "great-auk",
        path: "modules/00-getting-started.html",
        sourceIdFor: (id) => id.replace(/^thy-m00-/, "m0-"),
      },
    },
    {
      id: 1,
      slug: "01-without-umi-preprocessing",
      number: "01",
      title: "Without UMI: Preprocessing",
      status: "placeholder",
      summary:
        "Terminal-based preprocessing on Mjolnir of the project's ancient RNA data generated without UMIs, following Emilio's workflow.",
      environment: ENVIRONMENTS.mjolnir,
      icon: "toolbox",
      exerciseIds: [],
    },
    {
      id: 2,
      slug: "02-without-umi-analysis",
      number: "02",
      title: "Without UMI: Analysis",
      status: "placeholder",
      summary:
        "Downstream analysis in R and RStudio on your own computer, working with the processed outputs from Module 01.",
      environment: ENVIRONMENTS.localR,
      icon: "module-03",
      exerciseIds: [],
    },
    {
      id: 3,
      slug: "03-with-umi-preprocessing",
      number: "03",
      title: "With UMI: Preprocessing",
      status: "placeholder",
      summary:
        "Terminal-based preprocessing on Mjolnir that introduces the additional requirements of UMI-tagged data, building on Module 01.",
      environment: ENVIRONMENTS.mjolnir,
      icon: "toolbox",
      exerciseIds: [],
    },
    {
      id: 4,
      slug: "04-with-umi-analysis",
      number: "04",
      title: "With UMI: Analysis",
      status: "placeholder",
      summary:
        "Downstream analysis in R and RStudio of the UMI-processed data, using Emilio's scripts and processed datasets.",
      environment: ENVIRONMENTS.localR,
      icon: "module-03",
      exerciseIds: [],
    },
  ];

  global.GreatAuk.MODULES_BY_PROJECT = Object.assign(registry, { "thylacine-rna": MODULES });
  global.GreatAuk.THYLACINE_ENVIRONMENTS = ENVIRONMENTS;
})(window);
