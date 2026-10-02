/**
 * app.js
 *
 * Shared chrome behaviour used on every page: active sidebar link
 * highlighting, the mobile nav toggle, and the footer year.
 */

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", () => {
    injectIcons();
    highlightActiveNav();
    setupMobileNav();
    setupFooterYear();
  });

  function injectIcons() {
    const icons = (window.GreatAuk && window.GreatAuk.ICONS) || {};
    document.querySelectorAll("[data-icon]").forEach((el) => {
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
})();
