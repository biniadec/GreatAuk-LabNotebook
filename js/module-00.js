/**
 * module-00.js — HoloBase Module 00: Mjolnir Foundations (Phase B preview).
 *
 * Mounts the Mjolnir SIMULATION, checks each practice task against what the
 * student actually did in the simulator, and tracks exercise completion.
 *
 * Phase B stores everything in this browser only (localStorage): no
 * Supabase, no network. Practice progress here is a learning aid, not
 * verified completion — verified completion comes from the server-graded
 * readiness check in Phase C. A task, once achieved, stays ticked even if
 * the simulation is reset.
 */
(function (global) {
  "use strict";

  const STORE_KEY = "holobase_m00_preview_v1";
  const Sim = global.MjolnirSim;
  const { HOME, PEOPLE, PROJECT } = Sim.constants;
  const PROJ = `/projects/${PROJECT}`;
  const TEMPLATE = `${PROJ}/data/templates/first-job.sh`;
  const PRACTICE = `${PEOPLE}/m00-practice`;
  const FINAL = `${PEOPLE}/final`;

  // ----------------------------------------------------------- storage
  function load() {
    try { const v = JSON.parse(global.localStorage.getItem(STORE_KEY)); if (v && v.v === 1) return v; } catch (e) { /* private mode etc. */ }
    return { v: 1, tasks: {}, done: {}, answers: {}, sim: null };
  }
  let store = load();
  function save() { try { global.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* not fatal */ } }

  const sim = Sim.createSimulator({ state: store.sim });

  // ------------------------------------------------------------ checks
  const norm = (p) => { const parts = []; for (const x of p.split("/")) { if (!x || x === ".") continue; if (x === "..") parts.pop(); else parts.push(x); } return "/" + parts.join("/"); };
  const resolveFrom = (arg, cwd) => (!arg || arg === "~" ? HOME : arg.startsWith("~/") ? norm(HOME + "/" + arg.slice(2)) : norm(arg.startsWith("/") ? arg : cwd + "/" + arg));
  const cmds = (ev, name) => ev.filter((e) => e.type === "cmd" && e.name === name);
  const targets = (e) => e.args.filter((a) => !a.startsWith("-"));
  const lsAt = (ev, path) => cmds(ev, "ls").some((e) => { const t = targets(e); return t.length ? t.some((a) => resolveFrom(a, e.cwd) === path) : e.cwd === path; });
  const reads = (ev, pred) => ev.some((e) => e.type === "read" && pred(e.path, e));
  const jobs = () => sim.inspect.jobs();
  const finalJob = () => jobs().filter((j) => j.cwd.startsWith(FINAL) && /module load samtools\/1\.21/.test(j.script) && /samtools --version/.test(j.script) && j.qos === "normal" && j.partition === "cpuqueue");

  const CHECKS = {
    "t-whoami": (ev) => cmds(ev, "whoami").length > 0,
    "t-hostname": (ev) => cmds(ev, "hostname").some((e) => e.host === "mjolnirgate"),
    "t-login-compute": (ev) => ev.some((e) => e.type === "login-compute"),
    "t-cd-project": (ev) => cmds(ev, "ls").some((e) => e.cwd === PROJ),
    "t-ls-long": (ev) => cmds(ev, "ls").some((e) => e.args.some((a) => /^-[a-zA-Z]*l/.test(a))),
    "t-cd-home": (ev) => cmds(ev, "cd").some((e) => (!e.args.length || e.args[0] === "~" || e.args[0] === "~/") && e.cwd === HOME),
    "t-cd-dotdot": (ev) => cmds(ev, "cd").some((e) => e.args[0] === ".." || e.args[0] === "../"),
    "t-cd-dash": (ev) => cmds(ev, "cd").some((e) => e.args[0] === "-"),
    "t-cd-abs": (ev) => cmds(ev, "cd").some((e) => e.args[0] && e.args[0].startsWith("/") && e.cwd === norm(e.args[0])),
    "t-cd-rel": (ev) => cmds(ev, "cd").some((e) => { const a = e.args[0]; if (!a || /^[/~-]/.test(a) || a.startsWith("..") || a === ".") return false; return e.cwd.endsWith("/" + a.replace(/\/+$/, "")); }),
    "t-ls-home": (ev) => lsAt(ev, HOME) && reads(ev, (p) => p === `${HOME}/welcome.txt`),
    "t-ls-people": (ev) => lsAt(ev, PEOPLE),
    "t-mkdir": () => sim.inspect.isDir(PRACTICE),
    "t-du": (ev) => ev.some((e) => e.type === "du" && e.apparent && e.path === PEOPLE),
    "t-cp": (ev) => ev.some((e) => e.type === "cp" && e.from === `${PROJ}/data/README.txt` && e.to.startsWith(PRACTICE + "/")),
    "t-mv": (ev) => ev.some((e) => e.type === "mv" && e.to === `${PRACTICE}/notes.txt`),
    "t-rm": (ev) => ev.some((e) => e.type === "rm" && e.path.startsWith(PRACTICE + "/")),
    "t-file": (ev) => ev.some((e) => e.type === "file" && e.path.endsWith(".fastq.gz")),
    "t-head": (ev) => reads(ev, (p, e) => e.via === "head" && p.endsWith("/sample_preview.fastq")),
    "t-avail": (ev) => ev.some((e) => e.type === "module" && e.sub === "avail"),
    "t-spider": (ev) => ev.some((e) => e.type === "module" && e.sub === "spider"),
    "t-load": (ev) => ev.some((e) => e.type === "module" && e.sub === "load" && e.module === "samtools/1.21" && e.pinned),
    "t-list": (ev) => ev.some((e) => e.type === "module" && e.sub === "list"),
    "t-which": (ev) => ev.some((e) => e.type === "which" && e.cmd === "samtools" && e.found),
    "t-copy-template": (ev) => ev.some((e) => e.type === "cp" && e.from === TEMPLATE && e.to.startsWith(PEOPLE + "/")),
    "t-cat-script": (ev) => reads(ev, (p, e) => e.via === "cat" && p.startsWith(PEOPLE + "/") && p.endsWith("first-job.sh")),
    "t-rejected": (ev) => ev.some((e) => e.type === "job-rejected" && e.reason === "qos"),
    "t-edit": (ev) => ev.some((e) => e.type === "edit-save" && e.path.startsWith(PEOPLE + "/") && e.path.endsWith("first-job.sh") && /^#SBATCH\s+--qos=normal\s*$/m.test(e.content)),
    "t-submit": (ev) => ev.some((e) => e.type === "job-submitted" && e.qos === "normal" && e.path.endsWith("first-job.sh")),
    "t-squeue": (ev) => ev.some((e) => e.type === "squeue" && e.visible.some((v) => ["PD", "R", "CG"].includes(v.st))),
    "t-output": (ev) => jobs().some((j) => j.state === "CD" && reads(ev, (p) => p === j.outPath)),
    "t-seff": (ev) => ev.some((e) => e.type === "seff" && ["CD", "F", "TO", "CA"].includes(e.state)),
    "t-sacct": (ev) => ev.some((e) => e.type === "sacct" && e.jobs.length > 0),
    "t-cancel": (ev) => ev.some((e) => e.type === "scancel"),
    "t-srun": (ev) => ev.some((e) => e.type === "srun-start"),
    "t-srun-host": (ev) => cmds(ev, "hostname").some((e) => /^simnode/.test(e.host)),
    "t-srun-exit": (ev) => ev.some((e) => e.type === "srun-exit"),
    "t-final-dir": (ev) => sim.inspect.isDir(FINAL) && ev.some((e) => e.type === "cmd" && e.cwd === FINAL && e.name !== "cd"),
    "t-final-submit": () => finalJob().length > 0,
    "t-final-done": (ev) => finalJob().some((j) => { const f = sim.inspect.file(j.outPath); return j.state === "CD" && f && /samtools 1\.21/.test(f.content || "") && reads(ev, (p) => p === j.outPath); }),
    "t-final-seff": (ev) => finalJob().some((j) => j.state === "CD" && ev.some((e) => e.type === "seff" && e.id === j.id && e.state === "CD")),
  };

  // ---------------------------------------------------------------- UI
  const exercises = Array.from(document.querySelectorAll(".m00-ex"));
  const ANSWER_MIN = 20;

  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else if (v === true) n.setAttribute(k, ""); else if (v != null && v !== false) n.setAttribute(k, v); }
    if (text != null) n.textContent = text;
    return n;
  }

  function decorate(ex) {
    const id = ex.getAttribute("data-exercise-id"); const kind = ex.getAttribute("data-kind");
    const head = ex.querySelector(".m00-ex-head"); const body = ex.querySelector(".m00-ex-body");
    const status = el("span", { class: "m00-ex-status", "data-role": "status" }); head.appendChild(status);
    const foot = el("div", { class: "m00-ex-foot" });
    if (kind === "practise") {
      ex.querySelectorAll("[data-task]").forEach((li) => {
        li.classList.add("m00-task-item");
        li.insertBefore(el("span", { class: "m00-tick", "aria-hidden": "true" }), li.firstChild);
        li.appendChild(el("span", { class: "visually-hidden", "data-role": "task-sr" }));
      });
      foot.appendChild(el("p", { class: "m00-ex-count", "data-role": "count" }));
      const open = el("button", { type: "button", class: "btn btn-secondary btn-small m00-open-sim" }, "Open the simulator");
      open.addEventListener("click", openTerminal);
      foot.appendChild(open);
    }
    if (kind === "explain") {
      const tid = `${id}-answer`;
      foot.appendChild(el("label", { for: tid, class: "m00-answer-label" }, "Your answer (saved in this browser)"));
      const ta = el("textarea", { id: tid, class: "m00-answer", rows: "4", "data-role": "answer" });
      ta.value = store.answers[id] || "";
      ta.addEventListener("input", () => { store.answers[id] = ta.value; if (ta.value.trim().length < ANSWER_MIN) store.done[id] = false; save(); refresh(); });
      foot.appendChild(ta);
    }
    if (kind === "read" || kind === "explain") {
      const cid = `${id}-done`;
      const wrap = el("label", { class: "m00-done", for: cid });
      const cb = el("input", { type: "checkbox", id: cid, "data-role": "done" });
      cb.checked = Boolean(store.done[id]);
      cb.addEventListener("change", () => { store.done[id] = cb.checked; save(); refresh(); });
      wrap.append(cb, document.createTextNode(kind === "read" ? " Mark as read" : " Mark as done"));
      foot.appendChild(wrap);
      if (kind === "explain") foot.appendChild(el("p", { class: "m00-done-note", "data-role": "done-note" }, `Write a short answer (at least ${ANSWER_MIN} characters) to mark this as done.`));
    }
    body.appendChild(foot);
  }

  function exerciseComplete(ex) {
    const id = ex.getAttribute("data-exercise-id"); const kind = ex.getAttribute("data-kind");
    if (kind === "practise") return Array.from(ex.querySelectorAll("[data-task]")).every((li) => store.tasks[li.getAttribute("data-task")]);
    if (kind === "explain") return Boolean(store.done[id]) && (store.answers[id] || "").trim().length >= ANSWER_MIN;
    return Boolean(store.done[id]);
  }

  function evaluateTasks() {
    const ev = sim.inspect.events();
    let changed = false;
    for (const [task, check] of Object.entries(CHECKS)) {
      if (store.tasks[task]) continue;
      let ok = false; try { ok = check(ev); } catch (e) { ok = false; }
      if (ok) { store.tasks[task] = new Date().toISOString(); changed = true; }
    }
    return changed;
  }

  const progressText = document.querySelector('[data-role="progress-text"]');
  const progressFill = document.querySelector('[data-role="progress-fill"]');
  let lastAnnounced = null;

  function refresh() {
    let complete = 0;
    for (const ex of exercises) {
      const done = exerciseComplete(ex); if (done) complete++;
      ex.classList.toggle("is-complete", done);
      const st = ex.querySelector('[data-role="status"]'); st.textContent = done ? "✓ Complete" : "";
      if (ex.getAttribute("data-kind") === "practise") {
        const items = Array.from(ex.querySelectorAll("[data-task]"));
        let n = 0;
        items.forEach((li) => { const ok = Boolean(store.tasks[li.getAttribute("data-task")]); if (ok) n++; li.classList.toggle("is-done", ok); li.querySelector('[data-role="task-sr"]').textContent = ok ? " (done)" : " (not done yet)"; });
        ex.querySelector('[data-role="count"]').textContent = `${n} of ${items.length} tasks done`;
      }
      if (ex.getAttribute("data-kind") === "explain") {
        const id = ex.getAttribute("data-exercise-id"); const enough = (store.answers[id] || "").trim().length >= ANSWER_MIN;
        const cb = ex.querySelector('[data-role="done"]'); cb.disabled = !enough; if (!enough) cb.checked = false;
        ex.querySelector('[data-role="done-note"]').hidden = enough;
      }
    }
    const text = `${complete} of ${exercises.length} exercises complete`;
    if (text !== lastAnnounced) { progressText.textContent = text; lastAnnounced = text; }
    progressFill.style.width = `${Math.round((complete / exercises.length) * 100)}%`;
  }

  function onSimChange() {
    store.sim = sim.getState();
    evaluateTasks();
    save();
    refresh();
  }

  // ---------------------------------------------------- terminal panel
  const wrap = document.querySelector('[data-role="terminal-wrap"]');
  const toggle = document.querySelector('[data-role="terminal-toggle"]');
  const ui = global.MjolnirSimUI.mount(document.querySelector('[data-role="terminal"]'), { sim, onChange: onSimChange });
  function setOpen(open) { wrap.classList.toggle("is-open", open); toggle.setAttribute("aria-expanded", String(open)); toggle.textContent = open ? "Hide simulator" : "Simulator"; document.body.classList.toggle("m00-sim-open", open); }
  function openTerminal() { setOpen(true); ui.focus(); }
  toggle.addEventListener("click", () => { const open = !wrap.classList.contains("is-open"); setOpen(open); if (open) ui.focus(); });

  exercises.forEach(decorate);
  evaluateTasks(); save(); refresh();

  global.HoloBaseModule00 = { sim, checks: Object.keys(CHECKS), store: () => JSON.parse(JSON.stringify(store)) };
})(window);
