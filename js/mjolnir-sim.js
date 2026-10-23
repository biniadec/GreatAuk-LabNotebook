/**
 * mjolnir-sim.js — the HoloBase Mjolnir training simulator (engine only).
 *
 * A SIMULATION for practice. It has a fictional filesystem, a fictional
 * user (sim123), a fictional project (hb_training) and fictional compute
 * nodes (simnode01-04). It never connects to Mjolnir or anywhere else:
 * this file makes no network requests, runs no real commands, evaluates
 * no code, and touches no credentials. Everything happens in memory.
 *
 * Mjolnir-specific behaviour follows Bent Petersen's Mjolnir Knowledge Base
 * (https://mjolnir-ucph.dk/docs/), checked 2026-10-22:
 *   - login node "mjolnirgate"; no computation on the login node
 *   - Slurm: --qos is mandatory; partitions cpuqueue (default), gpuqueue,
 *     lazyqueue, filetransfer and teaching (the last two restricted);
 *     defaults 1 hour and 2G per CPU; QoS normal allows 48 CPUs per job
 *   - reply "Submitted batch job <jobid>"; squeue states PD / R / CG
 *   - Environment Modules 4.5.2 (not Lmod): no "module spider"
 *   - /home/<KU-ID> (100 GB, not for data); work in
 *     /projects/<project>/people/<KU-ID>/
 *   - du -sh --apparent-size for storage reporting
 *   - seff / sacct for efficiency; srun ... --pty bash for interactive work
 * Where the Knowledge Base does not say (for example exact error texts),
 * the simulator explains in its own words and says it is a simulation; it
 * never pretends to quote the real system. Module names other than
 * samtools/1.21 and all file sizes are examples.
 *
 * Works in the browser (window.MjolnirSim) and in Node (module.exports),
 * so it can be unit-tested without a page.
 */
(function (root) {
  "use strict";

  const USER = "sim123";
  const PROJECT = "hb_training";
  const HOME = `/home/${USER}`;
  const PEOPLE = `/projects/${PROJECT}/people/${USER}`;
  const LOGIN_NODE = "mjolnirgate";
  const NODES = ["simnode01", "simnode02", "simnode03", "simnode04"];
  const SPEED = 5; // simulated seconds per real second while a job runs
  const PENDING_MS = 4000;
  const COMPLETING_MS = 1500;
  const FIRST_JOB_ID = 4200101;

  const PARTITIONS = {
    cpuqueue: { maxSec: 14 * 86400, restricted: false },
    gpuqueue: { maxSec: 14 * 86400, restricted: false },
    lazyqueue: { maxSec: 14 * 86400, restricted: false },
    filetransfer: { maxSec: 4 * 86400, restricted: true },
    teaching: { maxSec: 86400, restricted: true },
  };
  const QOS = { normal: { maxCpus: 48 }, lazy: { maxCpus: Infinity }, teaching: { maxCpus: 48, restricted: true }, filetransfer: { maxCpus: 1, restricted: true } };

  // Example module catalogue (only samtools/1.21 is named in the Knowledge Base).
  const MODULES = {
    samtools: { versions: ["1.17", "1.21"], def: "1.21", provides: ["samtools"], what: "Tools for SAM/BAM/CRAM alignment files" },
    fastqc: { versions: ["0.12.1"], def: "0.12.1", provides: ["fastqc"], what: "Quality control for sequencing reads" },
    multiqc: { versions: ["1.25"], def: "1.25", provides: ["multiqc"], what: "Aggregates QC reports into one summary" },
    bwa: { versions: ["0.7.18"], def: "0.7.18", provides: ["bwa"], what: "Short-read aligner" },
    python: { versions: ["3.11", "3.12"], def: "3.12", provides: ["python", "python3"], what: "Python interpreter" },
  };
  const HEAVY_TOOLS = ["samtools", "fastqc", "multiqc", "bwa", "python", "python3"];

  const TEMPLATE = [
    "#!/bin/bash",
    "#SBATCH --job-name=first-job",
    "#SBATCH --partition=cpuqueue",
    "#SBATCH --nodes=1",
    "#SBATCH --cpus-per-task=1",
    "#SBATCH --mem-per-cpu=1G",
    "#SBATCH --time=00:05:00",
    "#SBATCH --output=first-job-%j.out",
    "",
    'echo "Job ID: $SLURM_JOB_ID"',
    'echo "Running on: $(hostname)"',
    'echo "Working directory: $(pwd)"',
    'echo "CPUs allocated: $SLURM_CPUS_PER_TASK"',
    "sleep 30",
    'echo "Finished at: $(date)"',
    "",
  ].join("\n");

  function initialFiles() {
    return {
      [`${HOME}/.bashrc`]: { content: "# ~/.bashrc (simulated)\n", size: 231 },
      [`${HOME}/welcome.txt`]: {
        content: "Welcome to the HoloBase Mjolnir SIMULATION.\n\nYour home directory (/home/sim123) is for small configuration files\nand scripts. It has a 100 GB limit and isn't meant for data or job\noutput. Work in /projects/hb_training/people/sim123 instead.\n\nType 'help' to see what this simulation supports.\n",
        size: 312,
      },
      [`/projects/${PROJECT}/README.txt`]: {
        content: "hb_training — a FICTIONAL project for the HoloBase Mjolnir simulation.\n\ndata/     shared datasets and reference files (read, don't copy around)\npeople/   one working folder per person\napps/     shared software and scripts for the project\nscratch/  temporary files only — not backed up\n",
        size: 268,
      },
      [`/projects/${PROJECT}/data/README.txt`]: {
        content: "Example reads for practice. These files are fictional.\nsample_R1.fastq.gz and sample_R2.fastq.gz are paired-end reads.\n",
        size: 118,
      },
      [`/projects/${PROJECT}/data/sample_R1.fastq.gz`]: { content: null, binary: "gzip compressed data, from Unix", size: 1288490188 },
      [`/projects/${PROJECT}/data/sample_R2.fastq.gz`]: { content: null, binary: "gzip compressed data, from Unix", size: 1301234567 },
      [`/projects/${PROJECT}/data/sample_preview.fastq`]: {
        content: [
          "@SIM:1:FCX:1:1101:1000:2000 1:N:0:ACGT", "GATTACAGATTACAGATTACAGATTACAGATTACA", "+", "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
          "@SIM:1:FCX:1:1101:1000:2100 1:N:0:ACGT", "CCGTTAGGCATTACGGATCCAGTTAGCATGCATCG", "+", "IIIIIHHHHHGGGGGFFFFFEEEEEDDDDDCCCCC",
          "@SIM:1:FCX:1:1101:1000:2200 1:N:0:ACGT", "TTGACCATGGCAAGTTCGAACGTATCGGATCAGTC", "+", "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
        ].join("\n") + "\n",
        size: 312,
      },
      [`/projects/${PROJECT}/data/templates/first-job.sh`]: { content: TEMPLATE, size: TEMPLATE.length },
      [`/projects/${PROJECT}/apps/README.txt`]: { content: "Shared scripts maintained for the project live here.\n", size: 54 },
      [`/projects/${PROJECT}/scratch/README.txt`]: { content: "Temporary files only. Not backed up. Keep only what you can recreate.\n", size: 70 },
      [`/datasets/globe_databases/README.txt`]: { content: "Shared reference databases (read-only). Not a place for your own data.\n", size: 72 },
    };
  }
  const INITIAL_DIRS = ["/", "/home", HOME, "/projects", `/projects/${PROJECT}`, `/projects/${PROJECT}/data`,
    `/projects/${PROJECT}/data/templates`, `/projects/${PROJECT}/people`, PEOPLE, `/projects/${PROJECT}/apps`,
    `/projects/${PROJECT}/scratch`, "/datasets", "/datasets/globe_databases"];
  const READ_ONLY = ["/", "/home", "/projects", `/projects/${PROJECT}`, `/projects/${PROJECT}/data`, `/projects/${PROJECT}/people`, "/datasets"];
  const PROTECTED = [...READ_ONLY, HOME, PEOPLE, `/projects/${PROJECT}/apps`, `/projects/${PROJECT}/scratch`, "/datasets/globe_databases"];

  // ---------------------------------------------------------------- paths

  function normalise(path) {
    const parts = [];
    for (const p of path.split("/")) {
      if (!p || p === ".") continue;
      if (p === "..") parts.pop();
      else parts.push(p);
    }
    return "/" + parts.join("/");
  }

  function basename(p) { return p === "/" ? "/" : p.slice(p.lastIndexOf("/") + 1); }
  function dirname(p) { const i = p.lastIndexOf("/"); return i <= 0 ? "/" : p.slice(0, i); }
  function pad(s, n, left) { s = String(s); if (s.length >= n) return s.slice(0, n); return left ? " ".repeat(n - s.length) + s : s + " ".repeat(n - s.length); }

  function humanSize(bytes) {
    const u = ["", "K", "M", "G", "T"]; let v = bytes, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return i === 0 ? String(bytes) : (v < 10 ? v.toFixed(1) : String(Math.round(v))) + u[i];
  }

  function parseTime(s) {
    // [D-]HH:MM:SS, HH:MM:SS, MM:SS, or minutes
    let m = /^(\d+)-(\d{1,2}):(\d{2}):(\d{2})$/.exec(s);
    if (m) return ((+m[1] * 24 + +m[2]) * 60 + +m[3]) * 60 + +m[4];
    m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(s); if (m) return (+m[1] * 60 + +m[2]) * 60 + +m[3];
    m = /^(\d{1,4}):(\d{2})$/.exec(s); if (m) return +m[1] * 60 + +m[2];
    m = /^(\d+)$/.exec(s); if (m) return +m[1] * 60;
    return null;
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return d ? `${d}-${hms}` : hms;
  }
  function fmtSqueueTime(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  function parseMem(s) { const m = /^(\d+(?:\.\d+)?)([KMGT]?)B?$/i.exec(s || ""); if (!m) return null; const f = { "": 1 / 1024, K: 1 / 1048576, M: 1 / 1024, G: 1, T: 1024 }[m[2].toUpperCase()]; return +m[1] * f; }

  // ------------------------------------------------------------- tokenise

  // Splits a command line into words, honouring quotes. Returns pipeline
  // segments and an optional output redirect.
  function tokenise(line) {
    const segs = [[]]; let cur = "", inS = false, inD = false, has = false, redirect = null;
    const push = () => { if (has) segs[segs.length - 1].push(cur); cur = ""; has = false; };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inS) { if (ch === "'") inS = false; else cur += ch; continue; }
      if (inD) { if (ch === '"') inD = false; else cur += ch; continue; }
      if (ch === "'") { inS = true; has = true; continue; }
      if (ch === '"') { inD = true; has = true; continue; }
      if (ch === " " || ch === "\t") { push(); continue; }
      if (ch === "|") { push(); segs.push([]); continue; }
      if (ch === ">") { push(); const append = line[i + 1] === ">"; if (append) i++; redirect = { append, target: null }; segs.push(["__REDIRECT__"]); continue; }
      cur += ch; has = true;
    }
    push();
    if (inS || inD) return { error: "unterminated quote" };
    if (redirect) {
      const last = segs.pop();
      redirect.target = last.slice(1)[0] || null;
      if (!redirect.target) return { error: "missing file name after >" };
    }
    return { segments: segs.filter((s) => s.length), redirect };
  }

  // ------------------------------------------------------------ simulator

  function createSimulator(options) {
    const opts = options || {};
    const clock = opts.clock || { now: () => Date.now() };

    let s; // state (serialisable)
    function fresh() {
      const dirs = {}; INITIAL_DIRS.forEach((d) => { dirs[d] = true; });
      return { v: 1, cwd: HOME, oldpwd: HOME, dirs, files: initialFiles(), modules: [], jobs: [], nextJob: FIRST_JOB_ID,
        interactive: null, history: [], events: [], lastSeq: 0 };
    }
    s = fresh();
    if (opts.state) { try { if (opts.state.v === 1) s = JSON.parse(JSON.stringify(opts.state)); } catch (e) { s = fresh(); } }

    const host = () => (s.interactive ? s.interactive.node : LOGIN_NODE);
    const env = () => ({ USER, HOME, PWD: s.cwd, HOSTNAME: host(), SHELL: "/bin/bash" });
    function record(ev) { s.lastSeq++; s.events.push(Object.assign({ seq: s.lastSeq, at: clock.now(), host: host(), cwd: s.cwd }, ev)); if (s.events.length > 500) s.events.splice(0, s.events.length - 500); }

    function resolve(p) {
      if (!p || p === "~") return HOME;
      if (p.startsWith("~/")) return normalise(HOME + "/" + p.slice(2));
      if (p.startsWith("~")) return null; // other users' homes are not available
      return normalise(p.startsWith("/") ? p : s.cwd + "/" + p);
    }
    const isDir = (p) => Boolean(s.dirs[p]);
    const isFile = (p) => Boolean(s.files[p]);
    const exists = (p) => isDir(p) || isFile(p);
    const childrenOf = (p) => {
      const prefix = p === "/" ? "/" : p + "/";
      const names = new Set();
      for (const d of Object.keys(s.dirs)) if (d !== p && d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) names.add(d.slice(prefix.length));
      for (const f of Object.keys(s.files)) if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) names.add(f.slice(prefix.length));
      return Array.from(names).sort((a, b) => a.localeCompare(b));
    };
    const fileSize = (p) => { const f = s.files[p]; return f.size != null ? f.size : (f.content || "").length; };
    const treeSize = (p) => { if (isFile(p)) return fileSize(p); let t = 4096; const pre = p === "/" ? "/" : p + "/"; for (const f of Object.keys(s.files)) if (f.startsWith(pre)) t += fileSize(f); for (const d of Object.keys(s.dirs)) if (d.startsWith(pre)) t += 4096; return t; };
    const writable = (p) => !READ_ONLY.includes(p) && (p === HOME || p.startsWith(HOME + "/") || p.startsWith(`/projects/${PROJECT}/people/${USER}`) || p.startsWith(`/projects/${PROJECT}/scratch`));
    function writeFile(p, content) { s.files[p] = { content, size: content.length }; }

    // --------------------------------------------------------- jobs

    function scriptDuration(script) {
      let sec = 1;
      for (const line of script.split("\n")) { const m = /^\s*sleep\s+(\d+)\s*$/.exec(line); if (m) sec += +m[1]; }
      return sec;
    }
    function jobTimes(j) {
      const start = j.submittedAt + PENDING_MS;
      const simRun = Math.min(j.durationSec, j.timeSec);
      const end = start + (simRun * 1000) / SPEED;
      return { start, end, done: end + COMPLETING_MS };
    }
    function jobState(j, now) {
      if (j.cancelledAt != null) {
        const t = jobTimes(j);
        return { code: "CA", long: "CANCELLED", started: j.cancelledAt >= t.start, finalAt: j.cancelledAt };
      }
      const t = jobTimes(j);
      if (now < t.start) return { code: "PD", long: "PENDING" };
      if (now < t.end) return { code: "R", long: "RUNNING" };
      if (now < t.done) return { code: "CG", long: "COMPLETING" };
      if (j.durationSec > j.timeSec) return { code: "TO", long: "TIMEOUT", finalAt: t.end };
      return j.exitCode === 0 ? { code: "CD", long: "COMPLETED", finalAt: t.end } : { code: "F", long: "FAILED", finalAt: t.end };
    }
    function elapsedSec(j, now) {
      const t = jobTimes(j); const st = jobState(j, now);
      const stop = st.code === "CA" ? j.cancelledAt : Math.min(now, t.end);
      return Math.max(0, ((stop - t.start) / 1000) * SPEED);
    }
    const active = (j, now) => ["PD", "R", "CG"].includes(jobState(j, now).code);

    // Run the job script "on" a compute node, producing stdout/stderr lines
    // with the simulated time at which each appears.
    function interpret(j) {
      const out = [], err = []; let t = 0, exit = 0; const loaded = [];
      const subst = (str) => str
        .replace(/\$\(hostname\)/g, j.node).replace(/\$\(pwd\)/g, j.cwd).replace(/\$\(date\)/g, () => new Date(j.submittedAt + PENDING_MS + (t * 1000) / SPEED).toUTCString())
        .replace(/\$\{?SLURM_JOB_ID\}?/g, String(j.id)).replace(/\$\{?SLURM_CPUS_PER_TASK\}?/g, String(j.cpus)).replace(/\$\{?SLURM_JOB_NAME\}?/g, j.name)
        .replace(/\$\{?USER\}?/g, USER).replace(/\$\{?HOME\}?/g, HOME);
      for (const raw of j.script.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const words = line.split(/\s+/);
        const cmd = words[0];
        if (cmd === "echo") { out.push({ t, text: subst(line.replace(/^echo\s*/, "").replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1")) }); continue; }
        if (cmd === "sleep") { t += +words[1] || 0; continue; }
        if (cmd === "hostname") { out.push({ t, text: j.node }); continue; }
        if (cmd === "pwd") { out.push({ t, text: j.cwd }); continue; }
        if (cmd === "date") { out.push({ t, text: subst("$(date)") }); continue; }
        if (cmd === "cd") continue;
        if (cmd === "exit") { exit = +words[1] || 0; break; }
        if (cmd === "module" && words[1] === "load" && words[2]) {
          const [name] = words[2].split("/");
          if (MODULES[name]) loaded.push(name); else { err.push({ t, text: `ERROR: Unable to locate a modulefile for '${words[2]}' (simulated)` }); exit = 1; break; }
          continue;
        }
        if (cmd === "module") continue;
        const provider = Object.keys(MODULES).find((m) => MODULES[m].provides.includes(cmd));
        if (provider) {
          if (!loaded.includes(provider)) { err.push({ t, text: `${cmd}: command not found` }); exit = 127; break; }
          if (words[1] === "--version") out.push({ t, text: `${cmd} ${MODULES[provider].def}${provider === "samtools" ? "\nUsing htslib " + MODULES[provider].def : ""}` });
          else { out.push({ t, text: `[simulated ${cmd} run on ${j.node}: no real data is processed]` }); t += 20; }
          continue;
        }
        err.push({ t, text: `${cmd}: command not found` }); exit = 127; break;
      }
      return { out, err, exit, durationSec: Math.max(1, Math.round(t + 1)) };
    }

    // Write each job's output/error files as far as the job has got.
    function syncJobs() {
      const now = clock.now();
      for (const j of s.jobs) {
        const st = jobState(j, now);
        if (st.code === "PD") continue;
        const t = jobTimes(j);
        const simNow = st.finalAt != null ? ((st.finalAt - t.start) / 1000) * SPEED : ((Math.min(now, t.end) - t.start) / 1000) * SPEED;
        const run = interpret(j);
        const show = (lines) => lines.filter((l) => l.t <= simNow + 1e-9).map((l) => l.text);
        let outLines = show(run.out), errLines = show(run.err);
        if (st.code === "TO") errLines = errLines.concat([`slurmstepd: error: *** JOB ${j.id} ON ${j.node} CANCELLED DUE TO TIME LIMIT *** (simulated)`]);
        if (st.code === "CA" && st.started) errLines = errLines.concat([`slurmstepd: error: *** JOB ${j.id} ON ${j.node} CANCELLED *** (simulated)`]);
        if (st.code === "CA" && !st.started) continue;
        const outPath = j.outPath, errPath = j.errPath;
        if (errPath && errPath !== outPath) {
          writeFile(outPath, outLines.join("\n") + (outLines.length ? "\n" : ""));
          writeFile(errPath, errLines.join("\n") + (errLines.length ? "\n" : ""));
        } else {
          const all = outLines.concat(errLines);
          writeFile(outPath, all.join("\n") + (all.length ? "\n" : ""));
        }
      }
    }

    function parseSbatchOptions(words, script) {
      const o = {}; const unknown = [];
      const take = (flag, val) => {
        const f = flag.replace(/^--?/, "");
        const map = { "job-name": "name", J: "name", partition: "partition", p: "partition", qos: "qos", q: "qos", nodes: "nodes", N: "nodes",
          "cpus-per-task": "cpus", c: "cpus", "mem-per-cpu": "memPerCpu", mem: "mem", time: "time", t: "time", output: "output", o: "output",
          error: "error", e: "error", ntasks: "ntasks", n: "ntasks", gres: "gres", account: "account", A: "account", pty: "pty" };
        if (map[f] === undefined) unknown.push(flag); else o[map[f]] = val;
      };
      const parseList = (list) => {
        for (let i = 0; i < list.length; i++) {
          const w = list[i];
          if (!w.startsWith("-")) continue;
          if (w.includes("=")) { const [k, ...v] = w.split("="); take(k, v.join("=")); }
          else if (/^-[A-Za-z]$/.test(w) && list[i + 1] && !list[i + 1].startsWith("-")) { take(w, list[i + 1]); i++; }
          else if (w === "--pty") take(w, true);
          else if (list[i + 1] && !list[i + 1].startsWith("-")) { take(w, list[i + 1]); i++; }
          else take(w, true);
        }
      };
      if (script) for (const line of script.split("\n")) { const m = /^#SBATCH\s+(.*)$/.exec(line.trim()); if (m) parseList(m[1].trim().split(/\s+/)); }
      parseList(words); // command-line options override script directives
      return { o, unknown };
    }

    // Returns an error message (string) or the validated request.
    function validateRequest(o, kind) {
      const partition = o.partition || "cpuqueue";
      const name = (o.name && String(o.name)) || null;
      if (!PARTITIONS[partition]) return `Simulation: "${partition}" is not a partition on Mjolnir. The partitions are cpuqueue (the default), gpuqueue and lazyqueue, plus filetransfer and teaching for specific accounts — see "Partitions, QoS, and fairshare" in the Knowledge Base.`;
      if (PARTITIONS[partition].restricted) return `Simulation: the ${partition} partition is restricted to specific accounts, and sim123 is not one of them. Use cpuqueue for ordinary work.`;
      if (!o.qos || o.qos === true) return `Simulation: this ${kind} was rejected because it has no QoS. On Mjolnir, --qos is mandatory — jobs submitted without it are rejected. Add --qos=normal (for cpuqueue) and try again. (Knowledge Base: "Partitions, QoS, and fairshare".)`;
      if (!QOS[o.qos]) return `Simulation: "${o.qos}" is not a QoS on Mjolnir. For ordinary cpuqueue work use --qos=normal.`;
      if (QOS[o.qos].restricted) return `Simulation: the ${o.qos} QoS is restricted to specific accounts. Use --qos=normal.`;
      if (partition === "lazyqueue" && o.qos !== "lazy") return "Simulation: lazyqueue jobs use --qos=lazy.";
      if (o.qos === "lazy" && partition !== "lazyqueue") return "Simulation: --qos=lazy belongs with --partition=lazyqueue.";
      const cpus = o.cpus ? parseInt(o.cpus, 10) : 1;
      if (!(cpus >= 1)) return `Simulation: --cpus-per-task needs a whole number (got "${o.cpus}").`;
      if (cpus > QOS[o.qos].maxCpus) return `Simulation: the ${o.qos} QoS allows at most ${QOS[o.qos].maxCpus} CPUs per job; you asked for ${cpus}.`;
      const timeSec = o.time ? parseTime(String(o.time)) : 3600;
      if (timeSec == null) return `Simulation: couldn't read --time=${o.time}. Use HH:MM:SS (for example 00:05:00) or D-HH:MM:SS.`;
      if (timeSec > PARTITIONS[partition].maxSec) return `Simulation: ${partition} allows at most ${fmtDuration(PARTITIONS[partition].maxSec)}; you asked for ${fmtDuration(timeSec)}.`;
      if (partition === "gpuqueue" && !o.gres) return "Simulation: GPU jobs also request a GPU with --gres=gpu:1. This training simulation has no GPUs, so practise with cpuqueue.";
      let memG = 2 * cpus;
      if (o.mem) { const m = parseMem(String(o.mem)); if (m == null) return `Simulation: couldn't read --mem=${o.mem}.`; memG = m; }
      else if (o.memPerCpu) { const m = parseMem(String(o.memPerCpu)); if (m == null) return `Simulation: couldn't read --mem-per-cpu=${o.memPerCpu}.`; memG = m * cpus; }
      return { partition, qos: o.qos, cpus, timeSec, memG, name };
    }

    // --------------------------------------------------------- commands

    const O = (text, kind) => ({ text, kind: kind || "out" });
    const ERR = (text) => O(text, "err");
    const INFO = (text) => O(text, "info");
    const WARN = (text) => O(text, "warn");

    function needArg(args, usage) { return args.length ? null : [ERR(`Usage: ${usage}`)]; }

    const commands = {
      help() {
        return [INFO("SIMULATION — nothing here touches the real Mjolnir. Supported commands:"),
          O("  Files:    pwd  ls [-l -a -h]  cd  mkdir [-p]  touch  cat  head  tail  less  file  cp [-r]  mv  rm [-r]  echo [> file]"),
          O("  Info:     whoami  hostname  date  history  clear  du -sh --apparent-size <dir>"),
          O("  Editing:  nano <file>   (opens a simple editor)"),
          O("  Software: module avail|list|load|unload|switch|purge|display|whatis|apropos   which <cmd>"),
          O("  Slurm:    sbatch <script>  squeue -u $USER  sacct -j <id>  seff <id>  scontrol show job <id>  scancel <id>"),
          O("            srun --partition=cpuqueue --qos=normal --cpus-per-task=2 --mem-per-cpu=2G --time=01:00:00 --pty bash"),
          INFO("Tips: ↑/↓ recall earlier commands, Tab completes names. Press Escape then Tab to leave the terminal.")];
      },
      pwd() { return [O(s.cwd)]; },
      whoami() { return [O(USER)]; },
      hostname() { return [O(host())]; },
      date() { return [O(new Date(clock.now()).toUTCString())]; },
      history() { return s.history.map((h, i) => O(`${pad(i + 1, 5, true)}  ${h}`)); },
      cd(args) {
        let target = args[0];
        if (target === "-") target = s.oldpwd;
        const p = resolve(target);
        if (p == null) return [ERR(`cd: ${target}: other users' home directories aren't part of this simulation`)];
        if (isFile(p)) return [ERR(`cd: ${target}: Not a directory`)];
        if (!isDir(p)) return [ERR(`cd: ${target}: No such file or directory`)];
        s.oldpwd = s.cwd; s.cwd = p;
        return args[0] === "-" ? [O(p)] : [];
      },
      ls(args) {
        const flags = args.filter((a) => a.startsWith("-")).join("");
        const long = flags.includes("l"), all = flags.includes("a"), human = flags.includes("h");
        const targets = args.filter((a) => !a.startsWith("-"));
        const list = targets.length ? targets : ["."];
        const res = [];
        list.forEach((t, idx) => {
          const p = resolve(t);
          if (p == null || !exists(p)) { res.push(ERR(`ls: cannot access '${t}': No such file or directory`)); return; }
          if (isFile(p)) { res.push(O(long ? lsLine(p, basename(p), human) : t)); return; }
          if (list.length > 1) res.push(O(`${t}:`));
          let names = childrenOf(p).filter((n) => all || !n.startsWith("."));
          if (all) names = [".", ".."].concat(names);
          if (long) { res.push(O(`total ${names.length * 4}`)); names.forEach((n) => res.push(O(lsLine(n === "." ? p : n === ".." ? dirname(p) : (p === "/" ? "/" : p + "/") + n, n, human)))); }
          else if (names.length) res.push(O(names.map((n) => (isDir((p === "/" ? "/" : p + "/") + n) ? n + "/" : n)).join("  ")));
          if (list.length > 1 && idx < list.length - 1) res.push(O(""));
        });
        return res;
      },
      mkdir(args) {
        const parents = args.includes("-p"); const names = args.filter((a) => !a.startsWith("-"));
        const bad = needArg(names, "mkdir [-p] <directory>"); if (bad) return bad;
        const res = [];
        for (const n of names) {
          const p = resolve(n);
          if (p == null) { res.push(ERR(`mkdir: cannot create directory '${n}'`)); continue; }
          if (exists(p)) { if (!parents) res.push(ERR(`mkdir: cannot create directory '${n}': File exists`)); continue; }
          if (!writable(p)) { res.push(ERR(`mkdir: cannot create directory '${n}': Permission denied`), INFO(`Simulation: you can create folders in ${HOME}, ${PEOPLE} and the project scratch folder. Shared folders such as data/ are managed for the project — and if your own project or people folder is missing on the real cluster, don't create it: ask through the Support Center.`)); continue; }
          if (!isDir(dirname(p))) {
            if (!parents) { res.push(ERR(`mkdir: cannot create directory '${n}': No such file or directory`), INFO("Tip: mkdir -p creates any missing parent folders too.")); continue; }
            let cur = ""; for (const part of p.split("/").filter(Boolean)) { cur += "/" + part; if (!isDir(cur)) s.dirs[cur] = true; }
          } else s.dirs[p] = true;
          record({ type: "mkdir", path: p });
        }
        return res;
      },
      touch(args) {
        const bad = needArg(args, "touch <file>"); if (bad) return bad;
        const res = [];
        for (const n of args) {
          const p = resolve(n);
          if (p == null || !isDir(dirname(p))) { res.push(ERR(`touch: cannot touch '${n}': No such file or directory`)); continue; }
          if (!writable(p)) { res.push(ERR(`touch: cannot touch '${n}': Permission denied`)); continue; }
          if (!exists(p)) writeFile(p, "");
          record({ type: "touch", path: p });
        }
        return res;
      },
      cat(args) {
        const bad = needArg(args, "cat <file>"); if (bad) return bad;
        const res = [];
        for (const n of expandGlobs(args)) {
          const p = resolve(n);
          if (p == null || !exists(p)) { res.push(ERR(`cat: ${n}: No such file or directory`)); continue; }
          if (isDir(p)) { res.push(ERR(`cat: ${n}: Is a directory`)); continue; }
          const f = s.files[p];
          if (f.binary) { res.push(WARN(`Simulation: ${n} is compressed (binary) data — cat would fill your screen with unreadable characters. Use 'file' to check what it is, or zcat ${n} | head on the real cluster.`)); continue; }
          (f.content || "").replace(/\n$/, "").split("\n").forEach((l) => res.push(O(l)));
          record({ type: "read", path: p, via: "cat" });
        }
        return res;
      },
      head(args) { return headTail(args, "head"); },
      tail(args) {
        if (args.includes("-f")) {
          const res = headTail(args.filter((a) => a !== "-f"), "tail");
          res.push(INFO("Simulation: on the real cluster, tail -f keeps following the file as it grows until you press Ctrl+C. Here it shows the last lines once."));
          return res;
        }
        return headTail(args, "tail");
      },
      less(args) {
        const bad = needArg(args, "less <file>"); if (bad) return bad;
        const res = commands.cat(args.slice(0, 1));
        if (res.length && res[0].kind !== "err" && res[0].kind !== "warn") { const p = resolve(args[0]); s.events[s.events.length - 1].via = "less"; res.push(INFO("Simulation: less shows a long file one screen at a time (Space for the next page, q to quit). Here the whole file is printed.")); void p; }
        return res;
      },
      more(args) { return commands.less(args); },
      file(args) {
        const bad = needArg(args, "file <path>"); if (bad) return bad;
        return args.map((n) => {
          const p = resolve(n);
          if (p == null || !exists(p)) return ERR(`${n}: cannot open (No such file or directory)`);
          record({ type: "file", path: p });
          if (isDir(p)) return O(`${n}: directory`);
          const f = s.files[p];
          if (f.binary) return O(`${n}: ${f.binary}`);
          if ((f.content || "").startsWith("#!/bin/bash")) return O(`${n}: Bourne-Again shell script, ASCII text executable`);
          return O(`${n}: ${f.content ? "ASCII text" : "empty"}`);
        });
      },
      cp(args) {
        const rec = args.some((a) => /^-[a-zA-Z]*r/i.test(a)); const names = args.filter((a) => !a.startsWith("-"));
        if (names.length < 2) return [ERR("Usage: cp [-r] <source> <destination>")];
        const dest = names.pop(); const dp = resolve(dest);
        const res = [];
        for (const n of names) {
          const sp = resolve(n);
          if (sp == null || !exists(sp)) { res.push(ERR(`cp: cannot stat '${n}': No such file or directory`)); continue; }
          let target = dp != null && isDir(dp) ? (dp === "/" ? "/" : dp + "/") + basename(sp) : dp;
          if (target == null || !isDir(dirname(target))) { res.push(ERR(`cp: cannot create '${dest}': No such file or directory`)); continue; }
          if (!writable(target)) { res.push(ERR(`cp: cannot create '${dest}': Permission denied`)); continue; }
          if (isDir(sp)) {
            if (!rec) { res.push(ERR(`cp: -r not specified; omitting directory '${n}'`)); continue; }
            s.dirs[target] = true;
            const pre = sp + "/";
            for (const d of Object.keys(s.dirs)) if (d.startsWith(pre)) s.dirs[target + d.slice(sp.length)] = true;
            for (const f of Object.keys(s.files)) if (f.startsWith(pre)) s.files[target + f.slice(sp.length)] = JSON.parse(JSON.stringify(s.files[f]));
          } else {
            s.files[target] = JSON.parse(JSON.stringify(s.files[sp]));
            if (s.files[sp].binary) res.push(INFO(`Simulation: that copied ${humanSize(fileSize(sp))} of shared data. On the real cluster, avoid duplicate copies of datasets — read them from data/ instead.`));
          }
          record({ type: "cp", from: sp, to: target });
        }
        return res;
      },
      mv(args) {
        const names = args.filter((a) => !a.startsWith("-"));
        if (names.length !== 2) return [ERR("Usage: mv <source> <destination>")];
        const sp = resolve(names[0]); const dp0 = resolve(names[1]);
        if (sp == null || !exists(sp)) return [ERR(`mv: cannot stat '${names[0]}': No such file or directory`)];
        if (!writable(sp)) return [ERR(`mv: cannot move '${names[0]}': Permission denied`)];
        const dp = dp0 != null && isDir(dp0) ? (dp0 === "/" ? "/" : dp0 + "/") + basename(sp) : dp0;
        if (dp == null || !isDir(dirname(dp))) return [ERR(`mv: cannot move '${names[0]}' to '${names[1]}': No such file or directory`)];
        if (!writable(dp)) return [ERR(`mv: cannot move to '${names[1]}': Permission denied`)];
        if (isDir(sp)) {
          const pre = sp + "/";
          for (const d of Object.keys(s.dirs)) if (d === sp || d.startsWith(pre)) { s.dirs[dp + d.slice(sp.length)] = true; delete s.dirs[d]; }
          for (const f of Object.keys(s.files)) if (f.startsWith(pre)) { s.files[dp + f.slice(sp.length)] = s.files[f]; delete s.files[f]; }
          if (s.cwd === sp || s.cwd.startsWith(pre)) s.cwd = dp + s.cwd.slice(sp.length);
        } else { s.files[dp] = s.files[sp]; delete s.files[sp]; }
        record({ type: "mv", from: sp, to: dp });
        return [];
      },
      rm(args) {
        const rec = args.some((a) => /^-[a-zA-Z]*r/i.test(a)); const names = args.filter((a) => !a.startsWith("-"));
        const bad = needArg(names, "rm [-r] <path>"); if (bad) return bad;
        const res = [];
        for (const n of names) {
          const p = resolve(n);
          if (p == null || !exists(p)) { res.push(ERR(`rm: cannot remove '${n}': No such file or directory`)); continue; }
          if (PROTECTED.includes(p)) { res.push(WARN(`Simulation: stopped — '${n}' is ${p === HOME ? "your home directory" : p === PEOPLE ? "your whole working folder" : "a shared folder"}. On a Linux cluster rm deletes at once, without asking and without a recycle bin, so double-check paths first. (Whether anything can be recovered is covered in the Knowledge Base page "Snapshots and recovery".)`)); continue; }
          if (!writable(p)) { res.push(ERR(`rm: cannot remove '${n}': Permission denied`)); continue; }
          if (isDir(p)) {
            if (!rec) { res.push(ERR(`rm: cannot remove '${n}': Is a directory`), INFO("Tip: rm -r removes a folder and everything in it — check the path first.")); continue; }
            if (s.cwd === p || s.cwd.startsWith(p + "/")) { res.push(ERR(`rm: refusing to remove '${n}': you're inside it (simulation)`)); continue; }
            const pre = p + "/";
            for (const d of Object.keys(s.dirs)) if (d === p || d.startsWith(pre)) delete s.dirs[d];
            for (const f of Object.keys(s.files)) if (f.startsWith(pre)) delete s.files[f];
          } else delete s.files[p];
          record({ type: "rm", path: p });
        }
        return res;
      },
      echo(args) { return [O(args.map(expandVars).join(" "))]; },
      du(args) {
        const human = args.some((a) => /^-[a-zA-Z]*h/.test(a)); const summary = args.some((a) => /^-[a-zA-Z]*s/.test(a));
        const apparent = args.includes("--apparent-size");
        const depthArg = args.find((a) => a.startsWith("--max-depth="));
        const targets = args.filter((a) => !a.startsWith("-")); const t = targets[0] || ".";
        const p = resolve(t);
        if (p == null || !exists(p)) return [ERR(`du: cannot access '${t}': No such file or directory`)];
        record({ type: "du", path: p, apparent, summary, depth: depthArg ? +depthArg.split("=")[1] : null });
        const fmt = (bytes) => (human ? humanSize(bytes) : String(Math.ceil(bytes / 1024)));
        const res = [];
        if (!summary && depthArg) for (const n of childrenOf(p)) { const c = (p === "/" ? "/" : p + "/") + n; if (isDir(c)) res.push(O(`${fmt(treeSize(c))}\t${t.replace(/\/$/, "")}/${n}`)); }
        res.push(O(`${fmt(treeSize(p))}\t${t}`));
        if (!apparent) res.push(INFO("Note: the Knowledge Base recommends du -sh --apparent-size when reporting storage use."));
        return res;
      },
      nano(args) { return openEditor(args, "nano"); },
      vi(args) { return openEditor(args, "vi"); },
      vim(args) { return openEditor(args, "vim"); },
      clear() { return [{ clear: true }]; },
      ssh(args) {
        record({ type: "ssh" });
        return [INFO("Simulation: you are already 'connected' here, and this page can never connect to the real Mjolnir."),
          INFO("For real: join the UCPH VPN, then run  ssh <KU-ID>@mjolnirgate.unicph.domain  — Bent's First 15 Minutes guide walks you through it once your account is approved.")];
      },
      sudo() { return [ERR("Simulation: sudo isn't available — ordinary users don't have administrator rights on a shared cluster. Ask through the Support Center if you need software installed.")]; },
      exit() {
        if (s.interactive) { const node = s.interactive.node; s.interactive = null; record({ type: "srun-exit", node }); return [O("exit"), INFO(`Simulation: left the interactive session on ${node}; its resources are released. You're back on the login node ${LOGIN_NODE}.`)]; }
        return [INFO("Simulation: on the real cluster this would log you out. Here the session simply stays open.")];
      },
      logout() { return commands.exit([]); },
      which(args) {
        const bad = needArg(args, "which <command>"); if (bad) return bad;
        return args.map((c) => {
          const m = s.modules.find((x) => MODULES[x.split("/")[0]].provides.includes(c));
          record({ type: "which", cmd: c, found: Boolean(m) });
          if (m) return O(`/opt/software/${m}/bin/${c}`);
          if (["ls", "cd", "pwd", "cat", "cp", "mv", "rm", "mkdir", "sbatch", "squeue", "sacct", "seff", "scancel", "srun"].includes(c)) return O(`/usr/bin/${c}`);
          return ERR(`which: no ${c} in (/usr/local/bin:/usr/bin:/bin)`);
        });
      },
      module(args) { return moduleCmd(args); },
      sbatch(args) { return sbatchCmd(args); },
      squeue(args) { return squeueCmd(args); },
      sacct(args) { return sacctCmd(args); },
      seff(args) { return seffCmd(args); },
      scontrol(args) { return scontrolCmd(args); },
      scancel(args) { return scancelCmd(args); },
      srun(args) { return srunCmd(args); },
      salloc() { return [INFO("Simulation: salloc is an alternative, but the Knowledge Base recommends srun ... --pty bash for most interactive work. Try:"), O("  srun --partition=cpuqueue --qos=normal --nodes=1 --cpus-per-task=2 --mem-per-cpu=2G --time=01:00:00 --pty bash")]; },
      sinfo() { return [INFO("Simulation: sinfo isn't part of this training. To see how busy Mjolnir is, the Knowledge Base has a page called \"What's happening on Mjolnir right now?\".")]; },
      grep(args, input) { return filterCmd("grep", args, input); },
      wc(args, input) { return filterCmd("wc", args, input); },
      sort(args, input) { return filterCmd("sort", args, input); },
    };

    function expandVars(str) {
      const e = env();
      return str.replace(/\$\{?(USER|HOME|PWD|HOSTNAME|SHELL)\}?/g, (m, k) => e[k]);
    }
    function expandGlobs(args) {
      const out = [];
      for (const a of args) {
        if (!a.includes("*")) { out.push(a); continue; }
        const p = resolve(a); const dir = dirname(p); const pat = basename(p);
        const re = new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        const matches = isDir(dir) ? childrenOf(dir).filter((n) => re.test(n)) : [];
        if (!matches.length) { out.push(a); continue; }
        const prefix = a.includes("/") ? a.slice(0, a.lastIndexOf("/") + 1) : "";
        matches.forEach((m) => out.push(prefix + m));
      }
      return out;
    }

    function lsLine(p, name, human) {
      const dir = isDir(p);
      const perms = dir ? "drwxr-xr-x" : (s.files[p] && (s.files[p].content || "").startsWith("#!") ? "-rwxr-xr-x" : "-rw-r--r--");
      const owner = p.startsWith(HOME) || p.startsWith(PEOPLE) ? USER : "hbadmin";
      const size = dir ? 4096 : fileSize(p);
      return `${perms} 1 ${pad(owner, 7)} ${pad(PROJECT, 11)} ${pad(human ? humanSize(size) : size, human ? 5 : 11, true)} Oct 22 09:00 ${dir ? name + "/" : name}`;
    }

    function headTail(args, which) {
      let n = 10; const rest = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-n" && args[i + 1]) { n = parseInt(args[i + 1], 10); i++; }
        else if (/^-\d+$/.test(args[i])) n = parseInt(args[i].slice(1), 10);
        else if (/^-n\d+$/.test(args[i])) n = parseInt(args[i].slice(2), 10);
        else rest.push(args[i]);
      }
      const bad = needArg(rest, `${which} [-n N] <file>`); if (bad) return bad;
      const res = [];
      for (const name of expandGlobs(rest)) {
        const p = resolve(name);
        if (p == null || !exists(p)) { res.push(ERR(`${which}: cannot open '${name}' for reading: No such file or directory`)); continue; }
        if (isDir(p)) { res.push(ERR(`${which}: error reading '${name}': Is a directory`)); continue; }
        const f = s.files[p];
        if (f.binary) { res.push(WARN(`Simulation: ${name} is compressed. On the real cluster you'd look inside with zcat ${name} | ${which}. Try ${which} on data/sample_preview.fastq instead.`)); continue; }
        const lines = (f.content || "").replace(/\n$/, "").split("\n");
        (which === "head" ? lines.slice(0, n) : lines.slice(-n)).forEach((l) => res.push(O(l)));
        record({ type: "read", path: p, via: which, n });
      }
      return res;
    }

    function filterCmd(cmd, args, input) {
      if (!input) return [ERR(`Simulation: ${cmd} works here only after a pipe, for example: du -h --apparent-size --max-depth=1 . | sort -h`)];
      let lines = input.filter((l) => l.kind === "out").map((l) => l.text);
      if (cmd === "grep") { const pat = args.find((a) => !a.startsWith("-")) || ""; const inv = args.includes("-v"); lines = lines.filter((l) => l.includes(pat) !== inv); }
      if (cmd === "wc") lines = [String(lines.length)];
      if (cmd === "sort") {
        const toBytes = (v) => { const m = /^([\d.]+)([KMGT]?)/.exec(v); if (!m) return 0; return +m[1] * ({ "": 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 }[m[2]]); };
        lines = lines.slice().sort(args.includes("-h") ? (a, b) => toBytes(a) - toBytes(b) : (a, b) => a.localeCompare(b));
        if (args.includes("-r")) lines.reverse();
      }
      return lines.map((l) => O(l)).concat(input.filter((l) => l.kind !== "out"));
    }

    function openEditor(args, which) {
      const bad = needArg(args, `${which} <file>`); if (bad) return bad;
      const p = resolve(args[0]);
      if (p == null || isDir(p)) return [ERR(`${which}: '${args[0]}' is not a file`)];
      if (!isDir(dirname(p))) return [ERR(`${which}: the folder for '${args[0]}' doesn't exist`)];
      if (!writable(p)) return [ERR(`${which}: '${args[0]}' is read-only here (Permission denied)`), INFO("Tip: copy it into your own working folder first, then edit the copy.")];
      const f = s.files[p];
      if (f && f.binary) return [WARN(`Simulation: ${args[0]} is binary data — not something to open in an editor.`)];
      record({ type: "edit-open", path: p });
      const note = which === "nano" ? null : INFO(`Simulation: ${which} is a powerful editor with its own keys; here it opens the same simple editor as nano.`);
      return (note ? [note] : []).concat([{ openEditor: { path: p, display: args[0], content: f ? f.content || "" : "" } }]);
    }

    // ---------------------------------------------------------- modules

    function moduleCmd(args) {
      const sub = args[0]; const rest = args.slice(1);
      const res = [];
      const find = (spec) => { const [name, ver] = spec.split("/"); const m = MODULES[name]; if (!m) return null; const v = ver || m.def; return m.versions.includes(v) ? `${name}/${v}` : null; };
      switch (sub) {
        case "avail": case "av": {
          record({ type: "module", sub: "avail", arg: rest[0] || null });
          const names = Object.keys(MODULES).filter((n) => !rest[0] || n.includes(rest[0]));
          if (!names.length) return [O(`No modules match "${rest[0]}" in this simulation.`)];
          res.push(O("---------------------------- /opt/software/modulefiles (SIMULATED, examples only) ----------------------------"));
          res.push(O(names.flatMap((n) => MODULES[n].versions.map((v) => `${n}/${v}${v === MODULES[n].def ? "(default)" : ""}`)).join("  ")));
          return res;
        }
        case "spider":
          record({ type: "module", sub: "spider" });
          return [ERR("module: spider: command not available"), INFO("Simulation: 'module spider' belongs to Lmod. Mjolnir uses Environment Modules 4.5.2, where it doesn't exist — use 'module avail <name>' (or 'module apropos <keyword>') instead.")];
        case "load": case "add": {
          const bad = needArg(rest, "module load <name>[/version]"); if (bad) return bad;
          for (const spec of rest) {
            const full = find(spec);
            if (!full) { res.push(ERR(`ERROR: Unable to locate a modulefile for '${spec}'`), INFO("Tip: 'module avail' lists what's installed (in this simulation: examples only).")); continue; }
            const name = full.split("/")[0];
            const already = s.modules.find((m) => m.startsWith(name + "/"));
            if (already && already !== full) { res.push(ERR(`Loading ${full}: conflicts with loaded ${already}. Use 'module switch ${name}/${full.split("/")[1]}'.`)); continue; }
            if (!already) s.modules.push(full);
            record({ type: "module", sub: "load", module: full, pinned: spec.includes("/") });
          }
          return res;
        }
        case "list": {
          record({ type: "module", sub: "list" });
          if (!s.modules.length) return [O("No Modulefiles Currently Loaded.")];
          return [O("Currently Loaded Modulefiles:"), O(s.modules.map((m, i) => ` ${i + 1}) ${m}`).join("   "))];
        }
        case "unload": case "rm": {
          for (const spec of rest) { const name = spec.split("/")[0]; s.modules = s.modules.filter((m) => !m.startsWith(name + "/")); record({ type: "module", sub: "unload", module: name }); }
          return [];
        }
        case "purge": s.modules = []; record({ type: "module", sub: "purge" }); return [];
        case "switch": case "swap": {
          const spec = rest[rest.length - 1]; const full = spec && find(spec);
          if (!full) return [ERR(`ERROR: Unable to locate a modulefile for '${spec}'`)];
          const name = full.split("/")[0]; s.modules = s.modules.filter((m) => !m.startsWith(name + "/")).concat([full]);
          record({ type: "module", sub: "switch", module: full });
          return [];
        }
        case "display": case "show": case "whatis": {
          const full = rest[0] && find(rest[0]); if (!full) return [ERR(`ERROR: Unable to locate a modulefile for '${rest[0] || ""}'`)];
          const name = full.split("/")[0];
          record({ type: "module", sub, module: full });
          if (sub === "whatis") return [O(`${pad(full, 18)}: ${MODULES[name].what}`)];
          return [O("-------------------------------------------------------------------"), O(`/opt/software/modulefiles/${full}: (simulated)`), O(`module-whatis   {${MODULES[name].what}}`), O(`prepend-path    PATH /opt/software/${full}/bin`), O("-------------------------------------------------------------------")];
        }
        case "apropos": case "keyword": {
          const k = (rest[0] || "").toLowerCase();
          const hits = Object.keys(MODULES).filter((n) => MODULES[n].what.toLowerCase().includes(k) || n.includes(k));
          record({ type: "module", sub: "apropos" });
          return hits.length ? hits.map((n) => O(`${pad(n + "/" + MODULES[n].def, 18)}: ${MODULES[n].what}`)) : [O(`No modules match "${rest[0] || ""}".`)];
        }
        default:
          return [ERR(`module: unknown subcommand '${sub || ""}'`), INFO("Try: module avail, module load <name>/<version>, module list, module purge.")];
      }
    }

    // ------------------------------------------------------------ slurm

    function findJob(idArg) { const id = parseInt(String(idArg || "").replace(/\..*$/, ""), 10); return s.jobs.find((j) => j.id === id) || null; }

    function sbatchCmd(args) {
      const scriptArg = args.find((a) => !a.startsWith("-") && !/^\d/.test(a) && !args[args.indexOf(a) - 1]?.match(/^-[A-Za-z]$/));
      if (!scriptArg) return [ERR("Usage: sbatch [options] <script>"), INFO("Simulation: give the name of your job script, for example: sbatch first-job.sh")];
      const p = resolve(scriptArg);
      if (p == null || !isFile(p)) return [ERR(`sbatch: error: Unable to open file ${scriptArg}`)];
      const script = s.files[p].content || "";
      if (!script.startsWith("#!")) return [ERR("sbatch: error: This does not look like a batch script. The first line must start with #! (for example #!/bin/bash)")];
      if (s.interactive) return [WARN("Simulation: you're inside an interactive session. Submit batch jobs from the login node — type exit first.")];
      const before = args.slice(0, args.indexOf(scriptArg));
      const { o, unknown } = parseSbatchOptions(before, script);
      if (unknown.length) return [ERR(`Simulation: this training doesn't recognise the option ${unknown[0]}. Supported: --job-name --partition --qos --nodes --cpus-per-task --mem-per-cpu --mem --time --output --error.`)];
      const v = validateRequest(o, "job");
      if (typeof v === "string") { record({ type: "job-rejected", path: p, reason: !o.qos ? "qos" : "other", message: v }); return [ERR(v)]; }
      const id = s.nextJob++;
      const run = interpret({ id, script, node: "simnode00", cwd: s.cwd, cpus: v.cpus, name: v.name || basename(p), submittedAt: clock.now() });
      const name = v.name || basename(p);
      const outPath = resolve((o.output ? String(o.output) : "slurm-%j.out").replace(/%j/g, String(id)).replace(/%x/g, name));
      const errPath = o.error ? resolve(String(o.error).replace(/%j/g, String(id)).replace(/%x/g, name)) : null;
      const job = { id, name, partition: v.partition, qos: v.qos, cpus: v.cpus, memG: v.memG, timeSec: v.timeSec, script, scriptPath: p, cwd: s.cwd,
        node: NODES[id % NODES.length], submittedAt: clock.now(), cancelledAt: null, durationSec: run.durationSec, exitCode: run.exit,
        outPath, errPath, outputDefaulted: !o.output };
      s.jobs.push(job);
      record({ type: "job-submitted", id, path: p, qos: v.qos, partition: v.partition, script });
      const res = [O(`Submitted batch job ${id}`)];
      if (!o.output) res.push(INFO(`Simulation: no --output was given, so (as usual for Slurm) the output will go to slurm-${id}.out in this folder.`));
      return res;
    }

    function squeueFields(j, now) {
      const st = jobState(j, now);
      const reason = st.code === "PD" ? (j.id % 2 ? "(Priority)" : "(Resources)") : j.node;
      return { i: String(j.id), P: j.partition, j: j.name, u: USER, t: st.code, T: st.long, M: fmtSqueueTime(elapsedSec(j, now)), D: "1", R: reason, N: st.code === "PD" ? "" : j.node, l: fmtDuration(j.timeSec), C: String(j.cpus) };
    }
    function squeueCmd(args) {
      const now = clock.now();
      let fmt = null; let jobFilter = null; let user = USER;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "-o" || a === "--format") { fmt = args[i + 1]; i++; }
        else if (a.startsWith("--format=")) fmt = a.slice(9);
        else if (a === "-j" || a === "--jobs") { jobFilter = args[i + 1]; i++; }
        else if (a === "-u") { user = expandVars(args[i + 1] || ""); i++; }
        else if (a === "--me") user = USER;
      }
      const jobs = s.jobs.filter((j) => active(j, now) && (!jobFilter || String(j.id) === jobFilter) && user === USER);
      record({ type: "squeue", user, formatted: Boolean(fmt), visible: jobs.map((j) => ({ id: j.id, st: jobState(j, now).code })) });
      if (user !== USER) return [O("             JOBID PARTITION     NAME     USER ST       TIME  NODES NODELIST(REASON)"), INFO(`Simulation: other users' jobs aren't part of this training. Try squeue -u $USER.`)];
      if (fmt) {
        const specs = []; const re = /%(\.?)(\d*)([a-zA-Z])/g; let m;
        while ((m = re.exec(fmt))) specs.push({ right: m[1] === ".", w: m[2] ? +m[2] : null, f: m[3] });
        const head = { i: "JOBID", P: "PARTITION", j: "NAME", u: "USER", t: "ST", T: "STATE", M: "TIME", D: "NODES", R: "NODELIST(REASON)", N: "NODELIST", l: "TIME_LIMIT", C: "CPUS" };
        const row = (vals) => specs.map((sp) => (sp.w ? pad(vals[sp.f] != null ? vals[sp.f] : "?", sp.w, sp.right) : vals[sp.f] || "")).join(" ");
        return [O(row(head))].concat(jobs.map((j) => O(row(squeueFields(j, now)))));
      }
      const res = [O("             JOBID PARTITION     NAME     USER ST       TIME  NODES NODELIST(REASON)")];
      for (const j of jobs) { const f = squeueFields(j, now); res.push(O(`${pad(f.i, 18, true)} ${pad(f.P, 9, true)} ${pad(f.j, 8, true)} ${pad(f.u, 8, true)} ${pad(f.t, 2, true)} ${pad(f.M, 10, true)} ${pad(f.D, 6, true)} ${f.R}`)); }
      if (!jobs.length && s.jobs.length) res.push(INFO("Simulation: no jobs in the queue — an empty list means your jobs have finished. Check their output files or sacct."));
      return res;
    }

    function sacctRows(j, now) {
      const st = jobState(j, now); const el = elapsedSec(j, now);
      const used = Math.min(el, 1 + el * 0.04); // the example scripts are mostly sleep: low CPU use
      const base = { JobID: String(j.id), JobName: j.name, Partition: j.partition, State: st.long, Elapsed: fmtDuration(el), AllocCPUS: String(j.cpus), ReqMem: `${j.memG}G`,
        Timelimit: fmtDuration(j.timeSec), TotalCPU: fmtDuration(used), CPUTime: fmtDuration(el * j.cpus), MaxRSS: "", ExitCode: st.code === "F" ? `${j.exitCode}:0` : st.code === "CA" || st.code === "TO" ? "0:15" : "0:0",
        ReqTRES: `billing=${j.cpus},cpu=${j.cpus},mem=${j.memG}G,node=1`, NodeList: st.code === "PD" ? "None assigned" : j.node, Start: st.code === "PD" ? "Unknown" : "today" };
      const rows = [base];
      if (!["PD"].includes(st.code) && !(st.code === "CA" && !st.started)) rows.push(Object.assign({}, base, { JobID: `${j.id}.batch`, JobName: "batch", Partition: "", MaxRSS: "4892K", ReqTRES: "" }));
      return rows;
    }
    function sacctCmd(args) {
      const now = clock.now(); syncJobs();
      let jobArg = null, fields = ["JobID", "JobName", "Partition", "State", "AllocCPUS", "Elapsed", "ExitCode"], X = false, units = null, today = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "-j" || a === "--jobs") { jobArg = args[i + 1]; i++; }
        else if (a.startsWith("--jobs=")) jobArg = a.slice(7);
        else if (a.startsWith("--format=")) fields = a.slice(9).split(",");
        else if (a === "--format" || a === "-o") { fields = (args[i + 1] || "").split(","); i++; }
        else if (a === "-X" || a === "--allocations") X = true;
        else if (a.startsWith("--units=")) units = a.slice(8);
        else if (a === "--starttime") { today = true; i++; }
        else if (a === "-u") i++;
      }
      let jobs = jobArg ? s.jobs.filter((j) => String(j.id) === String(jobArg).replace(/\..*$/, "")) : s.jobs;
      if (jobArg && !jobs.length) return [ERR(`Simulation: no job ${jobArg} in this session. Your job IDs come from the "Submitted batch job …" line.`)];
      void today; void units;
      record({ type: "sacct", jobs: jobs.map((j) => j.id), fields, X });
      const specs = fields.map((f) => { const m = /^([A-Za-z]+)(?:%(\d+))?$/.exec(f.trim()); return m ? { f: m[1], w: m[2] ? +m[2] : 10 } : { f: f.trim(), w: 10 }; });
      const known = Object.keys(sacctRows({ id: 1, name: "x", partition: "cpuqueue", cpus: 1, memG: 1, timeSec: 60, submittedAt: 0, durationSec: 1, cancelledAt: null, exitCode: 0, node: "n" }, 0)[0]);
      const bad = specs.find((sp) => !known.includes(sp.f));
      if (bad) return [ERR(`sacct: error: Invalid field requested: "${bad.f}" (simulation supports ${known.join(",")})`)];
      // Like sacct, a value wider than its column is cut and marked with "+".
      const cell = (v, w) => { v = String(v); return v.length > w ? v.slice(0, w - 1) + "+" : pad(v, w, false); };
      const line = (vals) => specs.map((sp) => cell(vals[sp.f] != null ? vals[sp.f] : "", sp.w)).join(" ");
      const res = [O(line(Object.fromEntries(specs.map((sp) => [sp.f, sp.f])))), O(specs.map((sp) => "-".repeat(sp.w)).join(" "))];
      for (const j of jobs) for (const r of sacctRows(j, now).slice(0, X ? 1 : undefined)) res.push(O(line(r)));
      return res;
    }

    function seffCmd(args) {
      const now = clock.now(); const j = findJob(args[0]);
      if (!args[0]) return [ERR("Usage: seff <jobid>")];
      if (!j) return [ERR(`Simulation: no job ${args[0]} in this session.`)];
      const st = jobState(j, now);
      record({ type: "seff", id: j.id, state: st.code });
      if (["PD", "R", "CG"].includes(st.code)) return [WARN(`Simulation: job ${j.id} is still ${st.long.toLowerCase()} — efficiency is only meaningful once it has finished. Try again in a few seconds.`)];
      const el = elapsedSec(j, now); const used = Math.min(el, 1 + el * 0.04); const core = el * j.cpus;
      const pct = core ? ((used / core) * 100).toFixed(2) : "0.00";
      const memUsed = 0.005;
      return [O(`Job ID: ${j.id}`), O("Cluster: simulation"), O(`User/Group: ${USER}/users`), O(`State: ${st.long} (exit code ${st.code === "F" ? j.exitCode : 0})`), O("Nodes: 1"), O(`Cores per node: ${j.cpus}`),
        O(`CPU Utilized: ${fmtDuration(used)}`), O(`CPU Efficiency: ${pct}% of ${fmtDuration(core)} core-walltime`), O(`Job Wall-clock time: ${fmtDuration(el)}`),
        O(`Memory Utilized: ${(memUsed * 1024).toFixed(2)} MB`), O(`Memory Efficiency: ${((memUsed / j.memG) * 100).toFixed(2)}% of ${j.memG.toFixed(2)} GB`),
        INFO("Simulation: this job mostly slept, so it used very little of what it reserved. For real jobs, compare these numbers with what you requested — see \"Check job efficiency\" in the Knowledge Base.")];
    }

    function scontrolCmd(args) {
      if (args[0] !== "show" || args[1] !== "job") return [ERR("Simulation: this training supports 'scontrol show job <jobid>'.")];
      const now = clock.now(); const j = findJob(args[2]);
      if (!j) return [ERR(`Simulation: no job ${args[2] || ""} in this session.`)];
      const st = jobState(j, now);
      record({ type: "scontrol", id: j.id });
      return [O(`JobId=${j.id} JobName=${j.name}`), O(`   UserId=${USER} JobState=${st.long} Reason=${st.code === "PD" ? (j.id % 2 ? "Priority" : "Resources") : "None"}`),
        O(`   Partition=${j.partition} QOS=${j.qos} NumNodes=1 NumCPUs=${j.cpus} TimeLimit=${fmtDuration(j.timeSec)} RunTime=${fmtDuration(elapsedSec(j, now))}`),
        O(`   NodeList=${st.code === "PD" ? "(null)" : j.node} MinMemoryNode=${j.memG}G`), O(`   Command=${j.scriptPath}`), O(`   WorkDir=${j.cwd}`), O(`   StdOut=${j.outPath}`)];
    }

    function scancelCmd(args) {
      const now = clock.now();
      if (!args.length) return [ERR("Usage: scancel <jobid>")];
      const res = [];
      for (const a of args) {
        const j = findJob(a);
        if (!j) { res.push(ERR(`Simulation: no job ${a} in this session (scancel only acts on your own jobs).`)); continue; }
        if (!active(j, now)) { res.push(INFO(`Simulation: job ${j.id} has already finished (${jobState(j, now).long}), so there is nothing to cancel.`)); continue; }
        const wasRunning = jobState(j, now).code !== "PD";
        j.cancelledAt = now;
        record({ type: "scancel", id: j.id, wasRunning });
      }
      return res;
    }

    function srunCmd(args) {
      if (s.interactive) return [WARN(`Simulation: you're already in an interactive session on ${s.interactive.node}. Type exit to release it first.`)];
      const { o } = parseSbatchOptions(args, null);
      if (!o.pty || !args.includes("bash")) return [INFO("Simulation: this training supports interactive sessions in the form:"), O("  srun --partition=cpuqueue --qos=normal --nodes=1 --cpus-per-task=2 --mem-per-cpu=2G --time=01:00:00 --pty bash")];
      const v = validateRequest(o, "interactive session");
      if (typeof v === "string") { record({ type: "srun-rejected", reason: !o.qos ? "qos" : "other" }); return [ERR(v)]; }
      const node = NODES[(s.nextJob + 1) % NODES.length]; const id = s.nextJob++;
      s.interactive = { node, id, cpus: v.cpus, startedAt: clock.now() };
      record({ type: "srun-start", node, id, cpus: v.cpus });
      return [O(`srun: job ${id} queued and waiting for resources`), O(`srun: job ${id} has been allocated resources`),
        INFO(`Simulation: you're now on compute node ${node}. Run hostname to check. The allocation lasts until you type exit or the time limit — idle sessions still block resources, so exit when you're done.`)];
    }

    // ------------------------------------------------------------- run

    function loginNodeComputeWarning(cmd, args) {
      const provider = Object.keys(MODULES).find((m) => MODULES[m].provides.includes(cmd));
      if (!provider) return null;
      const loaded = s.modules.some((m) => m.startsWith(provider + "/"));
      if (!loaded) return [ERR(`${cmd}: command not found`), INFO(`Tip: software is provided as modules. Try: module avail ${provider}, then module load ${provider}/${MODULES[provider].def}`)];
      if (args.length === 1 && ["--version", "-v", "-V", "--help"].includes(args[0])) {
        return [O(`${cmd} ${MODULES[provider].def}`)];
      }
      if (!args.length && provider === "samtools") return [O(""), O(`Program: samtools (Tools for alignments in the SAM format)`), O(`Version: ${MODULES.samtools.def} (simulated)`), O(""), O("Usage:   samtools <command> [options]")];
      if (s.interactive) { record({ type: "compute", cmd, host: s.interactive.node }); return [INFO(`Simulation: ${cmd} would run here on compute node ${s.interactive.node}, inside your allocation. (No real data is processed.)`)]; }
      record({ type: "login-compute", cmd });
      return [WARN(`Simulation: stopped. ${cmd} ${args.join(" ")} is real computation, and you're on the login node ${LOGIN_NODE}.`),
        WARN('On Mjolnir, computation isn\'t allowed on the login node, and repeated misuse can mean losing your access (Knowledge Base: "Login nodes vs compute nodes"). Put it in a Slurm job (sbatch) or an interactive session (srun ... --pty bash).')];
    }

    function runSegment(words, input) {
      const cmd = words[0]; const args = words.slice(1).map((a) => (cmd === "echo" ? a : expandVars(a)));
      if (commands[cmd]) {
        if (HEAVY_TOOLS.includes(cmd)) return loginNodeComputeWarning(cmd, args);
        return commands[cmd](args, input);
      }
      if (HEAVY_TOOLS.includes(cmd)) return loginNodeComputeWarning(cmd, args);
      if (cmd === "zcat" || cmd === "gunzip" || cmd === "gzip") return [INFO(`Simulation: ${cmd} isn't simulated. data/sample_preview.fastq is an uncompressed preview you can read with head.`)];
      if (cmd.startsWith("./") || cmd.endsWith(".sh")) return [WARN(`Simulation: running a script directly (${cmd}) would run it on the login node. Submit it to Slurm instead: sbatch ${cmd.replace(/^\.\//, "")}`)];
      return [ERR(`${cmd}: command not found`), INFO("Simulation: type help to see the commands this training supports.")];
    }

    function run(line) {
      const text = String(line || "");
      syncJobs();
      const trimmed = text.trim();
      if (!trimmed) return { output: [] };
      s.history.push(trimmed); if (s.history.length > 200) s.history.shift();
      const tok = tokenise(trimmed);
      if (tok.error) return { output: [ERR(`Simulation: ${tok.error}`)] };
      let input = null; let out = [];
      for (const seg of tok.segments) {
        const res = runSegment(seg, input) || [];
        record({ type: "cmd", name: seg[0], args: seg.slice(1) });
        input = res; out = res;
      }
      if (tok.redirect) {
        const p = resolve(tok.redirect.target);
        if (p == null || !isDir(dirname(p))) return { output: [ERR(`bash: ${tok.redirect.target}: No such file or directory`)] };
        if (!writable(p)) return { output: [ERR(`bash: ${tok.redirect.target}: Permission denied`)] };
        const text2 = out.filter((l) => l.kind === "out").map((l) => l.text).join("\n");
        const prev = tok.redirect.append && isFile(p) ? s.files[p].content || "" : "";
        writeFile(p, prev + (text2 ? text2 + "\n" : ""));
        record({ type: "write", path: p });
        out = out.filter((l) => l.kind !== "out");
      }
      syncJobs();
      const openEditor = out.find((l) => l.openEditor);
      const clear = out.some((l) => l.clear);
      return { output: out.filter((l) => !l.openEditor && !l.clear), openEditor: openEditor ? openEditor.openEditor : null, clear };
    }

    function saveFile(path, content) {
      if (!writable(path) || !isDir(dirname(path))) return false;
      writeFile(path, String(content));
      record({ type: "edit-save", path, content: String(content) });
      return true;
    }

    function complete(line) {
      const m = /(\S*)$/.exec(line); const word = m ? m[1] : "";
      const before = line.slice(0, line.length - word.length);
      if (!before.trim()) {
        const names = Object.keys(commands).filter((c) => c.startsWith(word));
        return names.length === 1 ? before + names[0] + " " : null;
      }
      const dirPart = word.includes("/") ? word.slice(0, word.lastIndexOf("/") + 1) : "";
      const base = resolve(dirPart || ".");
      if (base == null || !isDir(base)) return null;
      const stem = word.slice(dirPart.length);
      const hits = childrenOf(base).filter((n) => n.startsWith(stem) && (stem.startsWith(".") || !n.startsWith(".")));
      if (!hits.length) return null;
      let common = hits[0]; for (const h of hits) while (!h.startsWith(common)) common = common.slice(0, -1);
      const full = (base === "/" ? "/" : base + "/") + common;
      const suffix = hits.length === 1 ? (isDir(full) ? "/" : " ") : "";
      return before + dirPart + common + suffix;
    }

    function prompt() { const where = s.cwd === HOME ? "~" : s.cwd.startsWith(HOME + "/") ? "~" + s.cwd.slice(HOME.length) : s.cwd; return `[${USER}@${host()} ${basename(where === "~" ? "~" : where)}]$ `; }

    return {
      run, saveFile, complete, prompt,
      getState() { syncJobs(); return JSON.parse(JSON.stringify(s)); },
      reset() { s = fresh(); },
      // read-only helpers for exercise checks
      inspect: {
        events: () => s.events.slice(),
        isDir: (p) => isDir(normalise(p)),
        file: (p) => { syncJobs(); const f = s.files[normalise(p)]; return f ? { content: f.content, size: fileSize(normalise(p)) } : null; },
        modules: () => s.modules.slice(),
        jobs: () => { const now = clock.now(); syncJobs(); return s.jobs.map((j) => ({ id: j.id, name: j.name, state: jobState(j, now).code, script: j.script, cwd: j.cwd, outPath: j.outPath, cancelled: j.cancelledAt != null, qos: j.qos, partition: j.partition })); },
        interactive: () => (s.interactive ? Object.assign({}, s.interactive) : null),
        cwd: () => s.cwd,
      },
    };
  }

  const api = { createSimulator, constants: { USER, PROJECT, HOME, PEOPLE, LOGIN_NODE, NODES, SPEED, PENDING_MS }, _internal: { tokenise, normalise, parseTime } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MjolnirSim = api;
})(typeof window !== "undefined" ? window : globalThis);
