/**
 * mjolnir-sim-ui.js — terminal interface for the Mjolnir training simulator.
 *
 * Renders a SIMULATED terminal around the engine in mjolnir-sim.js. All
 * output is inserted as text (textContent), never as HTML. The interface
 * makes no network requests; it only calls the in-memory engine.
 *
 * Accessibility: the output is an ARIA log; the command line is a labelled
 * text input; ↑/↓ recall history; Tab completes names, and Escape followed
 * by Tab moves focus out of the terminal (so keyboard users are never
 * trapped). The editor is a modal dialog with Save and Close buttons as well
 * as nano-style shortcuts, and returns focus to the terminal when closed.
 *
 *   MjolnirSimUI.mount(container, { sim, onChange, onReset })
 */
(function (global) {
  "use strict";

  function el(tag, attrs, text) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (v === true) n.setAttribute(k, ""); else if (v !== false && v != null) n.setAttribute(k, v);
    }
    if (text != null) n.textContent = text;
    return n;
  }

  function mount(container, opts) {
    const sim = opts.sim;
    const onChange = opts.onChange || (() => {});
    let histIndex = null; let draft = ""; let escapeArmed = false; let editorOpen = null;

    container.classList.add("sim");
    const header = el("div", { class: "sim-header" });
    header.appendChild(el("span", { class: "sim-badge" }, "SIMULATION"));
    header.appendChild(el("span", { class: "sim-header-text" }, "Practice terminal — not connected to Mjolnir. Fictional user, files and nodes."));
    const actions = el("div", { class: "sim-header-actions" });
    const helpBtn = el("button", { type: "button", class: "sim-btn" }, "Help");
    const resetBtn = el("button", { type: "button", class: "sim-btn" }, "Reset simulation");
    actions.append(helpBtn, resetBtn); header.appendChild(actions);

    const screen = el("div", { class: "sim-screen" });
    const log = el("div", { class: "sim-log", role: "log", "aria-live": "polite", "aria-label": "Simulated terminal output" });
    const form = el("form", { class: "sim-line", autocomplete: "off" });
    const promptEl = el("span", { class: "sim-prompt", "aria-hidden": "true" });
    const inputId = "sim-input-" + Math.random().toString(36).slice(2, 8);
    const label = el("label", { for: inputId, class: "visually-hidden" }, "Simulated terminal command");
    const input = el("input", { id: inputId, class: "sim-input", type: "text", autocapitalize: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "send", "aria-describedby": inputId + "-hint" });
    const hint = el("span", { id: inputId + "-hint", class: "visually-hidden" }, "Type a command and press Enter. Up and down arrows recall earlier commands. Tab completes names; press Escape then Tab to leave the terminal.");
    form.append(label, promptEl, input, hint);
    screen.append(log, form);
    container.append(header, screen);

    function line(text, kind, cls) {
      const row = el("div", { class: `sim-row sim-${kind || "out"}${cls ? " " + cls : ""}` });
      if (kind === "info" || kind === "warn") row.appendChild(el("span", { class: "sim-row-tag" }, kind === "warn" ? "⚠ " : "ℹ "));
      row.appendChild(document.createTextNode(text));
      log.appendChild(row);
    }
    function scroll() { screen.scrollTop = screen.scrollHeight; }
    function updatePrompt() { promptEl.textContent = sim.prompt(); }

    function execute(cmd) {
      line(sim.prompt() + cmd, "cmd");
      const res = sim.run(cmd);
      if (res.clear) log.textContent = "";
      for (const o of res.output) line(o.text, o.kind);
      updatePrompt(); scroll();
      if (res.openEditor) openEditor(res.openEditor);
      onChange();
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const cmd = input.value; input.value = ""; histIndex = null; draft = "";
      execute(cmd);
    });

    input.addEventListener("keydown", (e) => {
      const hist = sim.getState().history;
      if (e.key === "Escape") { escapeArmed = true; return; }
      if (e.key === "Tab") {
        if (escapeArmed || e.shiftKey || !input.value) { escapeArmed = false; return; } // let focus move on
        e.preventDefault();
        const done = sim.complete(input.value);
        if (done != null) input.value = done;
        return;
      }
      escapeArmed = false;
      if (e.key === "ArrowUp") {
        if (!hist.length) return; e.preventDefault();
        if (histIndex == null) { draft = input.value; histIndex = hist.length; }
        histIndex = Math.max(0, histIndex - 1); input.value = hist[histIndex];
      } else if (e.key === "ArrowDown") {
        if (histIndex == null) return; e.preventDefault();
        histIndex++;
        if (histIndex >= hist.length) { histIndex = null; input.value = draft; } else input.value = hist[histIndex];
      } else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); log.textContent = ""; }
      else if (e.key === "c" && e.ctrlKey && !window.getSelection().toString()) { e.preventDefault(); line(sim.prompt() + input.value + "^C", "cmd"); input.value = ""; scroll(); }
    });
    screen.addEventListener("click", (e) => { if (!window.getSelection().toString() && e.target.tagName !== "BUTTON") input.focus(); });

    helpBtn.addEventListener("click", () => { execute("help"); input.focus(); });
    resetBtn.addEventListener("click", () => {
      if (!window.confirm("Reset the simulation? Your simulated files and jobs are cleared. Exercise progress you've already earned is kept.")) return;
      sim.reset(); log.textContent = ""; welcome(); updatePrompt(); if (opts.onReset) opts.onReset(); onChange(); input.focus();
    });

    // -------------------------------------------------------------- editor
    const dialog = el("div", { class: "sim-editor", role: "dialog", "aria-modal": "true", "aria-labelledby": inputId + "-edtitle", hidden: true });
    const edTitle = el("h2", { id: inputId + "-edtitle", class: "sim-editor-title" });
    const edNote = el("p", { class: "sim-editor-note" }, "Simulated editor (like nano). Ctrl+O or Ctrl+S saves, Ctrl+X closes.");
    const edLabel = el("label", { for: inputId + "-ed", class: "visually-hidden" }, "File contents");
    const area = el("textarea", { id: inputId + "-ed", class: "sim-editor-area", spellcheck: "false", autocapitalize: "off", rows: "16" });
    const edStatus = el("p", { class: "sim-editor-status", role: "status" });
    const edBtns = el("div", { class: "sim-editor-actions" });
    const saveBtn = el("button", { type: "button", class: "btn btn-primary btn-small" }, "Save");
    const closeBtn = el("button", { type: "button", class: "btn btn-secondary btn-small" }, "Close");
    edBtns.append(saveBtn, closeBtn);
    dialog.append(edTitle, edNote, edLabel, area, edStatus, edBtns);
    container.appendChild(dialog);

    function openEditor(info) {
      editorOpen = { path: info.path, saved: info.content };
      edTitle.textContent = `Editing ${info.display} (simulation)`;
      area.value = info.content; edStatus.textContent = "";
      dialog.hidden = false; container.classList.add("sim-editing");
      area.focus(); area.setSelectionRange(0, 0);
    }
    function save() {
      if (!editorOpen) return;
      if (sim.saveFile(editorOpen.path, area.value)) { editorOpen.saved = area.value; edStatus.textContent = `Saved ${editorOpen.path}`; onChange(); }
      else edStatus.textContent = "Couldn't save here (read-only location).";
    }
    function close() {
      if (!editorOpen) return;
      if (area.value !== editorOpen.saved && !window.confirm("Close without saving your changes?")) return;
      dialog.hidden = true; container.classList.remove("sim-editing");
      line(`[closed editor for ${editorOpen.path}]`, "info"); editorOpen = null; scroll(); input.focus();
    }
    saveBtn.addEventListener("click", save);
    closeBtn.addEventListener("click", close);
    dialog.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && (k === "o" || k === "s")) { e.preventDefault(); save(); }
      else if ((e.ctrlKey && k === "x") || e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") {
        const f = [area, saveBtn, closeBtn]; const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); closeBtn.focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); area.focus(); }
      }
    });

    // ------------------------------------------------------ job progress
    // While jobs are queued or running, re-check every second so exercise
    // progress and job output appear without the student typing anything.
    let lastSig = "";
    const timer = setInterval(() => {
      const jobs = sim.inspect.jobs();
      const sig = jobs.map((j) => j.id + j.state).join();
      if (sig !== lastSig) { lastSig = sig; onChange(); }
    }, 1000);

    function welcome() {
      line("HoloBase Mjolnir SIMULATION — practice only. Nothing you type here reaches Mjolnir or any other computer.", "info");
      line("You are the fictional user sim123 on the login node mjolnirgate. Type help to see what's supported.", "info");
    }
    welcome(); updatePrompt();

    return {
      run(cmd) { execute(cmd); },
      focus() { input.focus(); },
      destroy() { clearInterval(timer); },
    };
  }

  global.MjolnirSimUI = { mount };
})(window);
