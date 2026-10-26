/**
 * set-password.js
 *
 * Drives set-password.html — where BOTH a password-recovery link and an
 * invite link land (the "set a new password" step is identical for
 * either), per the architecture Binia approved. Deliberately reuses the
 * SAME shared Supabase client from supabase-client.js (detectSessionInUrl
 * stays false there, unchanged for every other page) rather than creating
 * a second, differently-configured client — this is what guarantees the
 * session established here is stored under the exact same localStorage
 * key every other page already reads from, so a user who lands here, sets
 * a password, and is sent on to their dashboard is still signed in once
 * they get there. A second client with its own config would risk writing
 * to a different storage key and silently looking "logged out" on the
 * very next page.
 *
 * Handles both URL shapes Supabase can use for this kind of link, since
 * which one a given project actually sends can vary: the classic/implicit
 * flow (`#access_token=...&refresh_token=...`, established here via
 * `auth.setSession()`) and PKCE (`?code=...`, established via
 * `auth.exchangeCodeForSession()`). Either shape can instead carry
 * `error`/`error_description` — an already-used or expired link — handled
 * explicitly as its own state, never left to fail silently or confusingly.
 *
 * The sensitive part of the URL (the token or code) is stripped via
 * history.replaceState() the moment it's read, before any async call —
 * it never lingers in the address bar or browser history, and its raw
 * value is never logged anywhere, success or failure.
 */

(function (global) {
  "use strict";

  const el = {
    loadingView: document.querySelector('[data-role="loading-view"]'),
    formView: document.querySelector('[data-role="form-view"]'),
    invalidView: document.querySelector('[data-role="invalid-view"]'),
    successView: document.querySelector('[data-role="success-view"]'),
    form: document.querySelector('[data-role="set-password-form"]'),
    password: document.getElementById("new-password"),
    confirmPassword: document.getElementById("confirm-password"),
    errorEl: document.querySelector('[data-role="set-password-error"]'),
    submitBtn: document.querySelector('[data-role="set-password-submit"]'),
    continueLink: document.querySelector('[data-role="continue-link"]'),
  };

  function showOnly(viewEl) {
    [el.loadingView, el.formView, el.invalidView, el.successView].forEach((v) => {
      if (v) v.hidden = v !== viewEl;
    });
  }

  function parseAuthParams() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const queryParams = new URLSearchParams(window.location.search);
    return {
      accessToken: hashParams.get("access_token"),
      refreshToken: hashParams.get("refresh_token"),
      code: queryParams.get("code"),
      error: hashParams.get("error") || queryParams.get("error") || hashParams.get("error_code") || queryParams.get("error_code"),
    };
  }

  function clearSensitiveUrlParams() {
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function establishSessionFromLink(client) {
    const params = parseAuthParams();

    if (params.error) {
      clearSensitiveUrlParams();
      return false;
    }

    if (params.accessToken && params.refreshToken) {
      clearSensitiveUrlParams();
      try {
        const { data, error } = await client.auth.setSession({
          access_token: params.accessToken,
          refresh_token: params.refreshToken,
        });
        return Boolean(!error && data && data.session);
      } catch (err) {
        console.warn("[GreatAuk] Could not establish a session from the recovery link.", err.message || err);
        return false;
      }
    }

    if (params.code) {
      clearSensitiveUrlParams();
      try {
        const { data, error } = await client.auth.exchangeCodeForSession(params.code);
        return Boolean(!error && data && data.session);
      } catch (err) {
        console.warn("[GreatAuk] Could not exchange the recovery code for a session.", err.message || err);
        return false;
      }
    }

    // No token/code in the URL at all — could be a reload after this page
    // already processed one, or any other reason a session might already
    // exist. Fall back to whatever's already there instead of assuming a
    // bare visit to this page is automatically invalid.
    try {
      const { data } = await client.auth.getSession();
      return Boolean(data && data.session && !data.session.user.is_anonymous);
    } catch (err) {
      return false;
    }
  }

  async function init() {
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) {
      showOnly(el.invalidView);
      return;
    }

    const ok = await establishSessionFromLink(client);
    showOnly(ok ? el.formView : el.invalidView);
  }

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) return;

    const password = el.password.value;
    const confirmValue = el.confirmPassword.value;
    el.errorEl.textContent = "";

    if (password.length < 8) {
      el.errorEl.textContent = "Password must be at least 8 characters.";
      return;
    }
    if (password !== confirmValue) {
      el.errorEl.textContent = "Passwords do not match.";
      return;
    }

    el.submitBtn.disabled = true;
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;

      const { data: sessionData } = await client.auth.getSession();
      const session = sessionData && sessionData.session;
      el.continueLink.href = session
        ? await global.GreatAuk.resolveDefaultLandingPage(client, session)
        : "login.html";
      showOnly(el.successView);
    } catch (err) {
      console.warn("[GreatAuk] Could not set the new password.", err.message || err);
      el.errorEl.textContent = "Could not set the new password: " + (err.message || "please try again.");
    } finally {
      el.submitBtn.disabled = false;
    }
  });

  init();
})(window);
