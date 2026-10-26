/**
 * app.js
 *
 * Shared chrome behaviour used on every page: active sidebar link
 * highlighting, the mobile nav toggle, and the footer year.
 */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    injectIcons(document);
    highlightActiveNav();
    setupMobileNav();
    setupFooterYear();
    markScrollableRegions(document);
  });

  // Exposed so pages can re-run it on content inserted after load (shared
  // content); called with no argument it covers the whole document as before.
  window.GreatAuk = window.GreatAuk || {};
  window.GreatAuk.injectIcons = injectIcons;
  window.GreatAuk.markScrollableRegions = markScrollableRegions;

  function injectIcons(root) {
    const icons = (window.GreatAuk && window.GreatAuk.ICONS) || {};
    (root || document).querySelectorAll("[data-icon]").forEach((el) => {
      const key = el.getAttribute("data-icon");
      if (icons[key]) el.innerHTML = icons[key];
    });
  }

  function highlightActiveNav() {
    const active = document.body.getAttribute("data-active-nav");
    if (!active) return;
    document.querySelectorAll(`.nav-link[data-nav="${active}"]`).forEach((link) => {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    });
  }

  function setupMobileNav() {
    const toggle = document.querySelector(".nav-toggle");
    const overlay = document.querySelector(".sidebar-overlay");
    if (!toggle) return;

    const close = () => document.body.classList.remove("nav-open");
    toggle.addEventListener("click", () => {
      document.body.classList.toggle("nav-open");
    });
    if (overlay) overlay.addEventListener("click", close);

    document.querySelectorAll(".sidebar .nav-link").forEach((link) => {
      link.addEventListener("click", close);
    });
  }

  function setupFooterYear() {
    document.querySelectorAll("[data-current-year]").forEach((el) => {
      el.textContent = new Date().getFullYear();
    });
  }

  // Code blocks, diagrams and tables that scroll sideways need a keyboard
  // stop so they can be scrolled without a mouse — but only while they
  // actually overflow, so narrow content adds no extra tab stops. A
  // ResizeObserver re-checks each block whenever its size changes
  // (including when the page is first revealed after sign-in, and on
  // window resizes). Only tabindex values set here are ever removed.
  const SCROLLABLE = ".command-block, .fastq-anatomy, .comparison-table-wrap";
  const scrollObserver = "ResizeObserver" in window
    ? new ResizeObserver((entries) => entries.forEach((entry) => updateScrollFocus(entry.target)))
    : null;

  function markScrollableRegions(root) {
    (root || document).querySelectorAll(SCROLLABLE).forEach((node) => {
      updateScrollFocus(node);
      if (scrollObserver) scrollObserver.observe(node);
    });
  }

  function updateScrollFocus(node) {
    const overflows = node.scrollWidth > node.clientWidth + 1;
    if (overflows && !node.hasAttribute("tabindex")) {
      node.setAttribute("tabindex", "0");
      node.setAttribute("data-scroll-focus", "");
    } else if (!overflows && node.hasAttribute("data-scroll-focus")) {
      node.removeAttribute("tabindex");
      node.removeAttribute("data-scroll-focus");
    }
  }
})();
