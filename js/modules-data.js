/**
 * modules-data.js
 *
 * Single source of truth for the course structure: the nine modules, their
 * status, and (for active modules) the list of exercise IDs they contain.
 * The home dashboard and the sidebar progress indicators both read from
 * this file so that totals stay consistent across pages.
 *
 * When a new module is fully developed, update its `status` to "active"
 * and fill in `exerciseIds` with the exercise IDs used in that module's
 * HTML (the values of each exercise's data-exercise-id attribute).
 */

(function (global) {
  "use strict";

  const MODULES = [
    {
      id: 0,
      slug: "00-getting-started",
      number: "00",
      title: "Getting Started on Mjolnir",
      status: "active",
      summary:
        "Prepare to work independently on the UCPH Mjolnir HPC cluster before starting the Great Auk genomics analysis.",
      exerciseIds: [
        "m0-ex01", "m0-ex02", "m0-ex03", "m0-ex04", "m0-ex05",
        "m0-ex06", "m0-ex07", "m0-ex08", "m0-ex09", "m0-ex10",
        "m0-ex11", "m0-ex12", "m0-ex13", "m0-ex14", "m0-ex15",
        "m0-ex16", "m0-ex17", "m0-ex18", "m0-ex19", "m0-ex20",
        "m0-ex21",
      ],
    },
    {
      id: 1,
      slug: "01-reference-genome",
      number: "01",
      title: "Reference Genome",
      status: "active",
      summary:
        "Investigate Alcidae taxonomy, evaluate candidate genome assemblies, and reproducibly obtain the Great Auk's mapping reference.",
      exerciseIds: [
        "m1-ex01", "m1-ex02", "m1-ex03", "m1-ex04",
        "m1-ex05", "m1-ex06", "m1-ex07", "m1-ex08",
      ],
    },
    {
      id: 2,
      slug: "02-raw-sequencing-data",
      number: "02",
      title: "Raw Sequencing Data",
      status: "placeholder",
      summary:
        "Obtain and organise the raw sequencing reads for the samples used in this project.",
      exerciseIds: [],
    },
    {
      id: 3,
      slug: "03-raw-read-qc",
      number: "03",
      title: "Raw Read QC",
      status: "placeholder",
      summary:
        "Assess the quality of raw reads before any processing is applied.",
      exerciseIds: [],
    },
    {
      id: 4,
      slug: "04-preprocessing",
      number: "04",
      title: "Pre-processing",
      status: "placeholder",
      summary:
        "Trim adapters and low-quality bases, and re-check quality after cleaning.",
      exerciseIds: [],
    },
    {
      id: 5,
      slug: "05-prepare-reference",
      number: "05",
      title: "Prepare Reference",
      status: "placeholder",
      summary:
        "Index and prepare the reference genome for read mapping.",
      exerciseIds: [],
    },
    {
      id: 6,
      slug: "06-mapping",
      number: "06",
      title: "Mapping",
      status: "placeholder",
      summary:
        "Align processed reads against the reference genome.",
      exerciseIds: [],
    },
    {
      id: 7,
      slug: "07-mapping-qc",
      number: "07",
      title: "Mapping QC",
      status: "placeholder",
      summary:
        "Evaluate alignment quality, coverage, and potential mapping artefacts.",
      exerciseIds: [],
    },
    {
      id: 8,
      slug: "08-genomic-diversity",
      number: "08",
      title: "Genomic Diversity",
      status: "placeholder",
      summary:
        "Estimate genetic diversity and related population genomic statistics.",
      exerciseIds: [],
    },
    {
      id: 9,
      slug: "09-mitochondrial-genetics",
      number: "09",
      title: "Mitochondrial Genetics",
      status: "placeholder",
      summary:
        "Extract and analyse mitochondrial genome data separately from the nuclear genome.",
      exerciseIds: [],
    },
  ];

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.MODULES = MODULES;
})(window);
