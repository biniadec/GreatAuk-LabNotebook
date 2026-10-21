/**
 * landing-page.js
 *
 * Resolves where a signed-in session should land when there's no specific
 * destination already in mind — used by login.js (no explicit `redirect`
 * param), set-password.js (just finished a recovery/invite flow), and
 * change-password.js ("continue" after a successful password change).
 * One shared implementation so these three places can't drift apart.
 *
 * Everyone — student, teacher, administrator, or an account not yet
 * enrolled anywhere — lands on the HoloBase homepage (index.html), which
 * shows each person the projects and dashboard their account can open
 * and marks the rest as not enrolled. The pages behind those links still
 * enforce access themselves (auth-guard.js, supervisor.js, RLS).
 *
 * Kept async, with the (client, session) signature its callers already
 * use, so a future role-specific rule can be added here in one place.
 */

(function (global) {
  "use strict";

  function platformHome() {
    const platform = global.GreatAuk && global.GreatAuk.PLATFORM;
    return (platform && platform.homePage) || "index.html";
  }

  // eslint-disable-next-line no-unused-vars
  async function resolveDefaultLandingPage(client, session) {
    return platformHome();
  }

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.resolveDefaultLandingPage = resolveDefaultLandingPage;
})(window);
