/**
 * change-password.js
 *
 * Drives change-password.html for an already-authenticated user (any role,
 * any project — guarded by auth-guard.js with no REQUIRED_PROJECT, same as
 * toolbox.html/resources.html/glossary.html). Requires re-entering the
 * CURRENT password before allowing a change, verified with a real
 * signInWithPassword call rather than just trusting the existing session —
 * an unattended, still-signed-in session on a shared or public computer
 * shouldn't be enough on its own to lock the real owner out of their own
 * account. This is additional hardening beyond what was strictly asked
 * for, not a requirement that was specified; set-password.html (recovery/
 * invite, where the old password is by definition unknown or doesn't
 * exist yet) deliberately has no equivalent step.
 */

(function (global) {
  "use strict";

  const form = document.querySelector('[data-role="change-password-form"]');
  const errorEl = document.querySelector('[data-role="change-password-error"]');
  const submitBtn = document.querySelector('[data-role="change-password-submit"]');
  const formView = document.querySelector('[data-role="form-view"]');
  const successView = document.querySelector('[data-role="success-view"]');
  const backLink = document.querySelector('[data-role="back-link"]');
  const continueLink = document.querySelector('[data-role="continue-link"]');

  async function init() {
    if (!global.GreatAuk || !global.GreatAuk.authReady) return;
    const result = await global.GreatAuk.authReady;
    if (!result) return; // auth-guard already redirected away.

    const client = global.GreatAuk.supabase;
    const target = await global.GreatAuk.resolveDefaultLandingPage(client, result.session);
    if (backLink) backLink.href = target;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) return;

    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmValue = document.getElementById("confirm-password").value;
    errorEl.textContent = "";

    if (newPassword.length < 8) {
      errorEl.textContent = "New password must be at least 8 characters.";
      return;
    }
    if (newPassword !== confirmValue) {
      errorEl.textContent = "New passwords do not match.";
      return;
    }

    submitBtn.disabled = true;
    try {
      const { data: sessionData } = await client.auth.getSession();
      const session = sessionData && sessionData.session;
      if (!session) throw new Error("Your session has expired — please sign in again.");

      // Re-verify the CURRENT password before allowing the change — see
      // the file header. A failure here means "current password is
      // wrong," not "something broke," and is shown as such.
      const { error: reauthError } = await client.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword,
      });
      if (reauthError) {
        errorEl.textContent = "Current password is incorrect.";
        return;
      }

      const { error: updateError } = await client.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      const target = await global.GreatAuk.resolveDefaultLandingPage(client, session);
      if (continueLink) continueLink.href = target;
      formView.hidden = true;
      successView.hidden = false;
    } catch (err) {
      console.warn("[GreatAuk] Could not change password.", err.message || err);
      errorEl.textContent = "Could not change your password: " + (err.message || "please try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  init();
})(window);
