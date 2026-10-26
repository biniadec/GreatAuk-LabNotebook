/**
 * recover-password.js
 *
 * Drives recover-password.html. Calls Supabase's resetPasswordForEmail —
 * nothing else. That call never creates an account; if the email doesn't
 * match an existing user, Supabase does nothing and still returns success,
 * which is exactly why the UI always shows the same "check your email"
 * confirmation regardless of whether the account actually exists — the
 * app has no way to know, and showing a different message for "no such
 * account" would hand an attacker a way to enumerate real email addresses.
 *
 * The reset link's redirectTo is built from the CURRENT page's own origin
 * and path, not hardcoded to any one host — this is what makes it work
 * correctly whether it's opened from http://localhost:8000 during testing
 * or the real GitHub Pages subpath in production, with no per-environment
 * configuration in this file at all. (Supabase's Auth > URL Configuration
 * > Redirect URLs allow-list still has to include both, separately — this
 * file can't do anything about that part.)
 */

(function (global) {
  "use strict";

  const form = document.querySelector('[data-role="recover-form"]');
  const errorEl = document.querySelector('[data-role="recover-error"]');
  const submitBtn = document.querySelector('[data-role="recover-submit"]');
  const requestView = document.querySelector('[data-role="request-view"]');
  const sentView = document.querySelector('[data-role="sent-view"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) {
      errorEl.textContent = "Password reset is unavailable right now — please try again shortly.";
      return;
    }

    const email = document.getElementById("recover-email").value.trim();
    errorEl.textContent = "";
    submitBtn.disabled = true;

    const redirectTo = new URL("set-password.html", window.location.href).toString();

    try {
      // Deliberately the ONLY Supabase Auth call this page ever makes —
      // never signUp(), never anything that could create a new account.
      // Supabase itself returns success here whether or not the email
      // matches a real account (this is how it avoids leaking which emails
      // are registered) — it only returns an error for a genuine
      // request-level problem (rate limit, network, server error), which
      // is symmetric regardless of account existence and safe to show
      // honestly, unlike a distinct "no such account" message would be.
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      requestView.hidden = true;
      sentView.hidden = false;
    } catch (err) {
      console.warn("[GreatAuk] Password reset request failed.", err);
      errorEl.textContent = "Something went wrong sending the reset link. Please try again.";
    } finally {
      submitBtn.disabled = false;
    }
  });
})(window);
