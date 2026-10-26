/**
 * shared-content.js
 *
 * Loads teaching content that lives in ONE source page (a Great Auk page)
 * into another project's page, so the material is written once and can't
 * drift: Thylacine's Module 00 and Terminal Toolbox are both built this way.
 *
 * Only the teaching blocks named in `pick` are taken from the source.
 * Everything that belongs to the source project's page chrome is never
 * carried over: no scripts, styles, sidebar/navigation, breadcrumbs, module
 * footers, account/sign-out controls, or page-level configuration such as
 * REQUIRED_PROJECT (which lives in a <script> and is stripped with every
 * other script). Relative links are unwrapped to plain text, since they
 * would point into the source project's pages.
 *
 * Exercise IDs are rewritten (e.g. m0-ex05 -> thy-m00-ex05) in every
 * attribute that can carry one — id, data-exercise-id, for, href anchors,
 * aria-* and data-copy-target — and the result is validated before anything
 * is returned: every exercise ID must carry the required prefix, the set
 * must match the expected list exactly, and no unrewritten source ID may
 * remain anywhere. Any failure throws, so a page shows an error instead of
 * exercises that would save under the wrong project's IDs.
 */

(function (global) {
  "use strict";

  const STRIP_SELECTORS = [
    "script", "style", "link", "meta", "noscript", "iframe", "object", "embed",
    "nav", ".sidebar", ".breadcrumb", ".module-footer", ".site-footer",
    "[data-role='sign-out-btn']", "[data-role='account-name']",
    "[data-role='project-switcher']", "[data-role='dashboard-link']",
    "[data-role='change-password-link']", "[data-role='module-progress']",
  ];

  const ID_ATTRIBUTES = ["id", "data-exercise-id", "for", "href", "aria-controls",
    "aria-labelledby", "aria-describedby", "data-copy-target"];

  class SharedContentError extends Error {}

  function sanitize(root) {
    root.querySelectorAll(STRIP_SELECTORS.join(",")).forEach((el) => el.remove());

    root.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      }
    });

    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      const isExternal = /^(https?:|mailto:)/i.test(href);
      const isAnchor = href.startsWith("#");
      if (!isExternal && !isAnchor) {
        console.warn("[GreatAuk] Shared content: removed a relative link that pointed into the source project's pages.", href);
        a.replaceWith(...a.childNodes);
      }
    });
  }

  function rewriteIds(root, rewrite) {
    if (!rewrite) return;
    const { pattern, replace } = rewrite;
    root.querySelectorAll("*").forEach((el) => {
      for (const name of ID_ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value && pattern.test(value)) {
          pattern.lastIndex = 0;
          el.setAttribute(name, value.replace(pattern, replace));
        }
        pattern.lastIndex = 0;
      }
    });
  }

  function validate(root, { requiredPrefix, expectedIds, forbiddenPattern }) {
    const found = Array.from(root.querySelectorAll("[data-exercise-id]")).map((el) => el.getAttribute("data-exercise-id"));

    if (requiredPrefix) {
      const bad = found.filter((id) => !id.startsWith(requiredPrefix));
      if (bad.length) throw new SharedContentError(`Exercise IDs without the required "${requiredPrefix}" prefix: ${bad.join(", ")}`);
    }

    if (new Set(found).size !== found.length) throw new SharedContentError("Duplicate exercise IDs after rewriting.");

    if (expectedIds) {
      const expected = new Set(expectedIds);
      const missing = expectedIds.filter((id) => !found.includes(id));
      const extra = found.filter((id) => !expected.has(id));
      if (missing.length || extra.length) {
        throw new SharedContentError(`Exercise IDs don't match this project's module list (missing: ${missing.join(", ") || "none"}; unexpected: ${extra.join(", ") || "none"}).`);
      }
    }

    if (forbiddenPattern) {
      for (const el of root.querySelectorAll("*")) {
        for (const attr of Array.from(el.attributes)) {
          forbiddenPattern.lastIndex = 0;
          if (forbiddenPattern.test(attr.value)) {
            throw new SharedContentError(`An unrewritten source ID remains in ${attr.name}="${attr.value}".`);
          }
        }
      }
    }
  }

  /**
   * options:
   *   url:          the source page, relative to the CURRENT page
   *   pick:         CSS selectors for the teaching blocks to take, in document order
   *   rewrite:      { pattern: RegExp (global), replace: string|function } or omitted
   *   validation:   { requiredPrefix, expectedIds, forbiddenPattern } or omitted
   * Resolves to a DocumentFragment ready to insert; rejects on any failure.
   */
  async function loadSharedContent({ url, pick, rewrite, validation }) {
    let html;
    try {
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      html = await resp.text();
    } catch (err) {
      throw new SharedContentError(`Could not load the shared content (${err.message}).`);
    }

    const doc = new DOMParser().parseFromString(html, "text/html");
    const source = doc.querySelector("main") || doc.body;
    const nodes = Array.from(source.querySelectorAll(pick.join(","))).filter(
      // Only top-level matches: a picked block nested inside another picked
      // block would otherwise be inserted twice.
      (el, _i, all) => !all.some((other) => other !== el && other.contains(el))
    );
    if (nodes.length === 0) throw new SharedContentError("The shared source page didn't contain the expected teaching content.");

    const container = document.createElement("div");
    nodes.forEach((n) => container.appendChild(document.importNode(n, true)));

    sanitize(container);
    rewriteIds(container, rewrite);
    validate(container, validation || {});

    const fragment = document.createDocumentFragment();
    while (container.firstChild) fragment.appendChild(container.firstChild);
    return fragment;
  }

  /**
   * Renders shared content into `target`, with a visible loading state, and
   * a clear error + Retry button if anything fails. `options.place(fragment,
   * target)` may distribute the validated nodes (default: append all into
   * target). Calls onReady() only after content is inserted and validated.
   */
  function mountSharedContent(target, options, onReady) {
    async function attempt() {
      target.innerHTML = `<div class="card shared-content-status" data-role="shared-content-loading"><p>Loading this page's content…</p></div>`;
      try {
        const fragment = await loadSharedContent(options);
        target.innerHTML = "";
        if (options.place) options.place(fragment, target);
        else target.appendChild(fragment);
        if (onReady) await onReady();
      } catch (err) {
        console.error("[GreatAuk] Shared content failed to load.", err);
        target.innerHTML = `
          <div class="card shared-content-status shared-content-error" data-role="shared-content-error" role="alert">
            <h2>This content couldn't be loaded</h2>
            <p>The page's teaching material didn't load correctly, so no exercises are shown — nothing has been saved or changed. Check your connection and try again.</p>
            <button type="button" class="btn btn-primary" data-role="shared-content-retry">Try again</button>
          </div>`;
        target.querySelector('[data-role="shared-content-retry"]').addEventListener("click", attempt);
      }
    }
    attempt();
  }

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.SharedContent = { loadSharedContent, mountSharedContent, SharedContentError };
})(window);
