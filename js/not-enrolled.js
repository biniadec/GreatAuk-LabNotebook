/**
 * not-enrolled.js
 *
 * Drives not-enrolled.html: just a sign-out button. Reached when
 * auth-guard.js confirms a real session but no matching project
 * enrollment for the page the visitor tried to reach.
 */

(function (global) {
  "use strict";

  const signOutBtn = document.querySelector('[data-role="sign-out-btn"]');
  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      signOutBtn.disabled = true;
      const client = global.GreatAuk && global.GreatAuk.supabase;
      if (client) await client.auth.signOut();
      window.location.replace("login.html");
    });
  }
})(window);
