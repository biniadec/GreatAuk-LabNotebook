/**
 * login.js
 *
 * Drives login.html: real email/password sign-in for students and
 * teachers. On success, redirects to wherever auth-guard.js sent the
 * visitor from (the `redirect` query param, a site-root-relative path
 * captured by the guard), or index.html if there isn't one. If a real,
 * already-signed-in session exists when this page loads, redirects
 * immediately without showing the form at all.
 */

(function (global) {
  "use strict";

  const form = document.querySelector('[data-role="login-form"]');
  const errorEl = document.querySelector('[data-role="login-error"]');
  const submitBtn = document.querySelector('[data-role="login-submit"]');

  function redirectTarget() {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("redirect");
    return target || "index.html";
  }

  async function redirectIfAlreadySignedIn() {
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) return;
    const { data } = await client.auth.getSession();
    const session = data && data.session;
    if (session && !session.user.is_anonymous) {
      window.location.replace(redirectTarget());
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) {
      errorEl.textContent = "Sign-in is unavailable right now — please try again shortly.";
      return;
    }

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    errorEl.textContent = "";
    submitBtn.disabled = true;

    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.replace(redirectTarget());
    } catch (err) {
      errorEl.textContent = "Sign in failed: " + (err.message || "invalid credentials.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  redirectIfAlreadySignedIn();
})(window);
