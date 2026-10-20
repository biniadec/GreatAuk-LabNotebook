/**
 * verify-code.js
 *
 * Drives verify-code.html — the Safe-Links-proof alternative to clicking
 * the email's link directly. A corporate email scanner (Microsoft Defender
 * Safe Links, and similar products from other vendors) can pre-visit and
 * consume a single-use CONFIRMATION LINK before the human ever clicks it,
 * because that link points straight at Supabase's own /auth/v1/verify
 * endpoint, which spends the token on the very first GET request —
 * whoever or whatever makes it. A 6-digit code sitting as plain text in
 * the email is never "visited" by anything; it's only ever consumed when
 * a human reads it and types it in here, which calls the same verifyOtp()
 * Supabase documents for exactly this purpose.
 *
 * The verification `type` is explicit, read from this page's own `?type=`
 * query param — recovery's "sent" confirmation always links here with
 * `?type=recovery`; the invite email template's own text links here with
 * `?type=invite` (see MIGRATION_PLAN.md for the exact template wording).
 * Deliberately NOT a silent try-recovery-then-try-invite fallback: the
 * caller always knows which flow it's in, so there's no reason to guess.
 *
 * On success, verifyOtp() establishes a real session the same way
 * set-session.html's own link-based path does — this page simply hands
 * off to set-password.html afterward, which already has its own fallback
 * for "no token in the URL, but a session already exists" (built for the
 * reload-after-processing case), so no changes were needed there at all.
 */

(function (global) {
  "use strict";

  const form = document.querySelector('[data-role="verify-code-form"]');
  const errorEl = document.querySelector('[data-role="verify-code-error"]');
  const submitBtn = document.querySelector('[data-role="verify-code-submit"]');
  const headingEl = document.querySelector('[data-role="form-heading"]');
  const hintEl = document.querySelector('[data-role="form-hint"]');
  const requestNewLink = document.querySelector('[data-role="request-new-link"]');

  const params = new URLSearchParams(window.location.search);
  const type = params.get("type") === "invite" ? "invite" : "recovery";

  if (type === "invite") {
    headingEl.textContent = "Confirm your invitation";
    hintEl.textContent =
      "Enter the email address and the 6-digit code from your invitation email. Use this if the " +
      "link in that email didn't work — some email providers (including many university accounts) " +
      "automatically visit links before you click them, which can use up a one-time link but never " +
      "touches a code sitting as plain text in the email.";
    // Unlike a password reset, there's no self-service way to get a new
    // invite — only an administrator can send another one.
    requestNewLink.textContent = "Ask your administrator for a new invitation.";
    requestNewLink.removeAttribute("href");
    requestNewLink.style.pointerEvents = "none";
    requestNewLink.style.cursor = "default";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) {
      errorEl.textContent = "Verification is unavailable right now — please try again shortly.";
      return;
    }

    const email = document.getElementById("verify-email").value.trim();
    const token = document.getElementById("verify-token").value.trim();
    errorEl.textContent = "";
    submitBtn.disabled = true;

    try {
      const { data, error } = await client.auth.verifyOtp({ email, token, type });
      if (error) throw error;
      if (!data || !data.session) throw new Error("No session was established.");
      window.location.replace("set-password.html");
    } catch (err) {
      console.warn("[GreatAuk] Code verification failed.", err.message || err);
      errorEl.textContent = "That code is incorrect or has expired. " + (type === "recovery" ? "Request a new one below." : "Ask your administrator for a new invitation.");
    } finally {
      submitBtn.disabled = false;
    }
  });
})(window);
