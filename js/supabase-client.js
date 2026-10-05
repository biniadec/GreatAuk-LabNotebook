/**
 * supabase-client.js
 *
 * Initializes the Supabase client used to silently back up and restore
 * Luigi's progress. This file only creates the client — it does not sign
 * anyone in or touch any data; that happens in sync-adapter.js.
 *
 * The values below (project URL + publishable/anon key) are meant to be
 * public: they are safe to ship in client-side JavaScript on a public
 * GitHub Pages site. Access to actual rows is controlled entirely by
 * Supabase Row Level Security policies on the exercise_progress table,
 * not by keeping this key secret. Never put a service_role key here.
 */

(function (global) {
  "use strict";

  const SUPABASE_URL = "https://iqntvtyzepmdvttburhx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ds1lQeeYGwhkOUyUTDVjMg_MlD3Iqzm";

  global.GreatAuk = global.GreatAuk || {};

  try {
    if (!global.supabase || typeof global.supabase.createClient !== "function") {
      throw new Error("Supabase SDK did not load");
    }
    global.GreatAuk.supabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch (err) {
    console.warn("[GreatAuk] Supabase client unavailable — continuing with localStorage only.", err);
    global.GreatAuk.supabase = null;
  }
})(window);
