/**
 * login.js
 *
 * Drives login.html: real email/password sign-in for students and
 * teachers. On success, redirects to wherever auth-guard.js sent the
 * visitor from (the `redirect` query param, a site-root-relative path
 * captured by the guard). If there isn't one — the visitor came to
 * login.html directly, not bounced here from a specific page — the
 * destination is resolved from the signed-in account's actual role and
 * project membership, NOT a hardcoded page: an admin goes to index.html;
 * a teacher goes to supervisor.html; a student goes to their own enrolled
 * project's landing page. A single hardcoded default here would send a
 * Thylacine-only account straight into a page that immediately rejects
 * them (index.html requires the Great Auk project) — exactly the
 * confusing first impression this is meant to avoid.
 *
 * If a real, already-signed-in session exists when this page loads,
 * redirects immediately (through the same logic) without showing the
 * form at all.
 *
 * The `redirect` param is untrusted input (anyone can send a link to
 * login.html?redirect=…), so it is only followed when it resolves to a
 * page on this same site, inside the folder login.html itself lives in
 * (the site root — "/GreatAuk-LabNotebook/" on GitHub Pages). Anything
 * else — another origin, a protocol-relative "//host", a javascript: or
 * data: URL, a path outside the site — is ignored and the role-aware
 * default is used instead.
 */

(function (global) {
  "use strict";

  const form = document.querySelector('[data-role="login-form"]');
  const errorEl = document.querySelector('[data-role="login-error"]');
  const submitBtn = document.querySelector('[data-role="login-submit"]');

  // Returns a same-site path (pathname + query + hash) for a valid
  // destination, or null for anything that must not be followed.
  function safeRedirect(raw) {
    if (typeof raw !== "string" || raw === "" || raw.length > 2048) return null;
    // Control characters and backslashes have no place in our own paths;
    // browsers normalise some of them in ways that can change the host.
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch (err) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== window.location.origin) return null;
    const siteRoot = new URL(".", window.location.href).pathname;
    if (!url.pathname.startsWith(siteRoot)) return null;
    // Encoded slashes/backslashes: never in our own paths, and some servers
    // decode them into "//host" before redirecting.
    if (/%2f|%5c/i.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  }

  async function redirectTarget(client, session) {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("redirect");
    if (explicit) {
      const safe = safeRedirect(explicit);
      if (safe) return safe;
      console.warn("[GreatAuk] Ignored a redirect destination outside this site.");
    }
    return global.GreatAuk.resolveDefaultLandingPage(client, session);
  }

  async function redirectIfAlreadySignedIn() {
    const client = global.GreatAuk && global.GreatAuk.supabase;
    if (!client) return;
    const { data } = await client.auth.getSession();
    const session = data && data.session;
    if (session && !session.user.is_anonymous) {
      window.location.replace(await redirectTarget(client, session));
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
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const session = data && data.session;
      window.location.replace(await redirectTarget(client, session));
    } catch (err) {
      errorEl.textContent = "Sign in failed: " + (err.message || "invalid credentials.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  redirectIfAlreadySignedIn();
})(window);
