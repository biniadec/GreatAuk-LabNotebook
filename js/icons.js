/**
 * icons.js
 *
 * Single source of truth for the small line icons used in the sidebar,
 * module cards, and dashboard tiles. Each entry is inline SVG markup
 * (stroke = currentColor) injected by app.js into any element carrying
 * a matching data-icon attribute, and read directly by home.js when it
 * builds module cards.
 */

(function (global) {
  "use strict";

  const stroke = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = {
    home: `<svg viewBox="0 0 24 24" ${stroke}><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1h3.2v-6.2h4.6V21H17.5a1 1 0 0 0 1-1V9.5"/></svg>`,

    "module-01": `<svg viewBox="0 0 24 24" ${stroke}><path d="M6 3c0 4.5 12 4.5 12 9s-12 4.5-12 9"/><path d="M18 3c0 4.5-12 4.5-12 9s12 4.5 12 9"/><path d="M7.2 7.2h9.6M6.3 12h11.4M7.2 16.8h9.6"/></svg>`,

    "module-02": `<svg viewBox="0 0 24 24" ${stroke}><ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v6.2c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V5.5"/><path d="M5 11.7v6.2c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6.2"/></svg>`,

    "module-03": `<svg viewBox="0 0 24 24" ${stroke}><path d="M5 20V11M12 20V4M19 20v-6.5"/></svg>`,

    "module-04": `<svg viewBox="0 0 24 24" ${stroke}><circle cx="6" cy="7" r="2"/><path d="M2.5 7h2M10 7H21.5"/><circle cx="16" cy="13" r="2"/><path d="M2.5 13h11.5M18 13h3.5"/><circle cx="10" cy="19" r="2"/><path d="M2.5 19h5.5M12 19h9.5"/></svg>`,

    "module-05": `<svg viewBox="0 0 24 24" ${stroke}><path d="M7.5 3h6l4 4v13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13.5 3v4h4"/><path d="M9 13.5h6M9 16.8h6M9 10.2h2.2"/></svg>`,

    "module-06": `<svg viewBox="0 0 24 24" ${stroke}><path d="M9.5 14.5l5-5"/><path d="M11.3 6.2l1.1-1.1a3.5 3.5 0 0 1 5 5l-1.5 1.5"/><path d="M12.7 17.8l-1.1 1.1a3.5 3.5 0 0 1-5-5l1.5-1.5"/></svg>`,

    "module-07": `<svg viewBox="0 0 24 24" ${stroke}><path d="M3.5 16.5 9 11l3.8 3.8L20.5 7"/><path d="M15.3 7h5.2v5.2"/></svg>`,

    "module-08": `<svg viewBox="0 0 24 24" ${stroke}><circle cx="6" cy="6.5" r="2.1"/><circle cx="18" cy="6.5" r="2.1"/><circle cx="12" cy="18" r="2.1"/><path d="M7.7 7.8 10.6 16M16.3 7.8 13.4 16M8.3 6.5h7.4"/></svg>`,

    "module-09": `<svg viewBox="0 0 24 24" ${stroke}><g transform="rotate(45 12 12)"><rect x="4" y="9" width="16" height="6" rx="3"/><line x1="12" y1="9" x2="12" y2="15"/></g></svg>`,

    toolbox: `<svg viewBox="0 0 24 24" ${stroke}><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3.5 2.5L7 14.5M13 14.8h4"/></svg>`,

    resources: `<svg viewBox="0 0 24 24" ${stroke}><path d="M4.5 19.2A2.3 2.3 0 0 1 6.8 17H20V4H6.8A2.3 2.3 0 0 0 4.5 6.3v12.9z"/><path d="M4.5 19.2V6.3"/></svg>`,

    glossary: `<svg viewBox="0 0 24 24" ${stroke}><path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.8 6h.01M3.8 12h.01M3.8 18h.01"/></svg>`,

    chevronRight: `<svg viewBox="0 0 24 24" ${stroke}><path d="M9 5l7 7-7 7"/></svg>`,

    arrowRight: `<svg viewBox="0 0 24 24" ${stroke}><path d="M4.5 12h15M13 5.5 19.5 12 13 18.5"/></svg>`,

    compass: `<svg viewBox="0 0 24 24" ${stroke}><circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-6 2 2-6z"/></svg>`,

    flask: `<svg viewBox="0 0 24 24" ${stroke}><path d="M9.5 3h5M10 3v6.5L5.3 18a1.6 1.6 0 0 0 1.4 2.4h10.6a1.6 1.6 0 0 0 1.4-2.4L14 9.5V3"/><path d="M8 15.5h8"/></svg>`,

    document: `<svg viewBox="0 0 24 24" ${stroke}><path d="M7.5 3h6l4 4v13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13.5 3v4h4"/></svg>`,
  };

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.ICONS = ICONS;
})(window);
