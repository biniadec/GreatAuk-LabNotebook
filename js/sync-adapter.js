/**
 * sync-adapter.js
 *
 * Makes Supabase the authoritative, shared copy of a signed-in student's
 * progress while keeping localStorage as an instant local cache/offline
 * fallback — without changing ProgressStore's public API, and without
 * progress.js or home.js needing to know Supabase exists at all.
 *
 * How it fits in: storage.js defines ProgressStore with a plain
 * LocalStorageAdapter. This file defines a HybridAdapter with the exact
 * same {read(key), write(key, value)} shape, then replaces
 * ProgressStore.adapter with it. Every call progress.js/home.js already
 * make (store.setExerciseComplete, store.getExerciseNotes, ...) is
 * unchanged — only what happens underneath is new.
 *
 * Session: this file assumes auth-guard.js has already run on this page
 * and confirmed a real, permanent (non-anonymous) session exists — it
 * awaits `window.GreatAuk.authReady` before doing anything, reusing the
 * session/membership/display-name auth-guard already resolved rather than
 * querying again. There is no anonymous sign-in here at all; if no real
 * session is present (shouldn't happen given the guard, but defensive),
 * this falls back to localStorage-only, same as any other Supabase outage.
 *
 * Every localStorage key this file touches (completion map, notes map,
 * pending-sync queue, one-time-migration flag) is scoped by both the
 * signed-in user's id and the current project's slug, so two different
 * students' answers — or the same student's progress in two different
 * projects — never collide in the same browser.
 *
 * On first read in a page load:
 *  - if Supabase already has rows for this user+project, they overwrite the
 *    local cache (Supabase is authoritative);
 *  - if Supabase has no rows yet but localStorage has existing progress for
 *    this scoped key, that local data is pushed up once as the seed.
 *
 * On every write:
 *  - localStorage is updated immediately (so the UI never waits on the
 *    network — this is what progress.js's "Saved" status reflects);
 *  - the changed exercise row(s) are upserted to Supabase in the
 *    background, tagged with the real project_id and the student's real
 *    display name (never a hardcoded label);
 *  - anything that fails to sync (offline, transient error) is kept in a
 *    small local retry queue and re-attempted on the next write or page
 *    load, so nothing is silently lost.
 */

(function (global) {
  "use strict";

  const TABLE = "exercise_progress";

  function getLocalAdapter() {
    return global.GreatAuk.LocalStorageAdapter;
  }

  function getKeys() {
    return global.GreatAuk.STORAGE_KEYS;
  }

  function getClient() {
    return global.GreatAuk.supabase;
  }

  function currentProjectSlug() {
    return global.GreatAuk.REQUIRED_PROJECT || "great-auk";
  }

  // ---- exercise-ID guard -------------------------------------------------
  //
  // exercise_progress is unique on (user_id, exercise_id) and every write is
  // an upsert on that key. If a Thylacine page ever wrote a Great Auk-style
  // ID (say m0-ex05), it would not merely collide: it would OVERWRITE that
  // student's Great Auk row. So projects with their own ID namespace declare
  // a required prefix here, and every path that can store or send a row —
  // local writes, the retry queue (including entries left in localStorage by
  // an earlier visit), the one-time seed migration, and the final network
  // call — drops anything that doesn't carry it. Projects not listed here
  // (Great Auk) are completely unaffected.
  const REQUIRED_EXERCISE_ID_PREFIX = { "thylacine-rna": "thy-" };

  function isAllowedExerciseId(id) {
    const prefix = REQUIRED_EXERCISE_ID_PREFIX[currentProjectSlug()];
    if (!prefix) return true;
    return typeof id === "string" && id.startsWith(prefix);
  }

  function reportRejected(ids, where) {
    if (ids.length === 0) return;
    console.error(
      `[GreatAuk] Refused to save ${ids.length} exercise ID(s) not valid for project "${currentProjectSlug()}" (${where}).`,
      ids
    );
  }

  function allowedRows(rows, where) {
    const ok = rows.filter((r) => isAllowedExerciseId(r.exercise_id));
    reportRejected(rows.filter((r) => !isAllowedExerciseId(r.exercise_id)).map((r) => r.exercise_id), where);
    return ok;
  }

  function allowedMap(map, where) {
    if (!map || typeof map !== "object") return map;
    const out = {};
    const rejected = [];
    for (const [id, value] of Object.entries(map)) {
      if (isAllowedExerciseId(id)) out[id] = value;
      else rejected.push(id);
    }
    reportRejected(rejected, where);
    return out;
  }

  // An archived page (the original Great Auk Module 00) shows saved
  // progress but must never write: not to Supabase, not to the retry queue,
  // not even to the local cache.
  function isReadOnly() {
    return Boolean(global.GreatAuk.READ_ONLY_ARCHIVE);
  }

  function isPreview() {
    return Boolean(global.GreatAuk.PREVIEW_MODE);
  }

  // ---- in-memory state for this page load ------------------------------

  // { [exerciseId]: { completed: bool, notes: string } } — the merged,
  // Supabase-authoritative view once loaded. Used to know each row's
  // "other half" when only completion or only notes changes, and as the
  // baseline for diffing writes.
  let mergedState = {};
  let sessionPromise = null;
  let loadPromise = null;
  let projectIdPromise = null;

  // ---- session / project / display name ----------------------------------

  async function ensureSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const client = getClient();
      if (!client) return null;
      try {
        if (global.GreatAuk.authReady) await global.GreatAuk.authReady;
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        const session = data && data.session;
        if (!session || session.user.is_anonymous) return null;
        return session;
      } catch (err) {
        console.warn("[GreatAuk] Supabase session unavailable — using localStorage only.", err);
        return null;
      }
    })();
    return sessionPromise;
  }

  async function ensureProjectId() {
    if (projectIdPromise) return projectIdPromise;
    projectIdPromise = (async () => {
      const slug = currentProjectSlug();
      try {
        if (global.GreatAuk.authReady) await global.GreatAuk.authReady;
        const memberships = global.GreatAuk.currentMemberships || [];
        const match = memberships.find((m) => m.projects && m.projects.slug === slug);
        if (match) return match.project_id;

        const client = getClient();
        const { data, error } = await client.from("projects").select("id").eq("slug", slug).maybeSingle();
        if (error) throw error;
        return data ? data.id : null;
      } catch (err) {
        console.warn("[GreatAuk] Could not resolve project id.", err);
        return null;
      }
    })();
    return projectIdPromise;
  }

  function currentDisplayName() {
    return global.GreatAuk.currentDisplayName || null;
  }

  // ---- scoped localStorage keys ------------------------------------------

  async function scopedKey(baseKey) {
    const session = await ensureSession();
    const uid = session ? session.user.id : "anonymous";
    return `${baseKey}::${uid}::${currentProjectSlug()}`;
  }

  // ---- pending (retry) queue --------------------------------------------

  async function pendingKey() {
    return scopedKey("greatauk_sync_pending_v1");
  }

  async function migratedKey() {
    return scopedKey("greatauk_sync_migrated_v1");
  }

  async function readPending() {
    const stored = (await getLocalAdapter().read(await pendingKey())) || {};
    // Covers retries of entries queued by an earlier visit: anything invalid
    // is dropped here, before it can be merged or flushed.
    return allowedMap(stored, "retry queue");
  }

  async function writePending(pending) {
    await getLocalAdapter().write(await pendingKey(), allowedMap(pending, "retry queue write"));
  }

  async function queuePending(rows) {
    if (isPreview() || isReadOnly()) return;
    const pending = await readPending();
    for (const row of allowedRows(rows, "queue")) pending[row.exercise_id] = row;
    await writePending(pending);
  }

  async function clearPendingFor(exerciseIds) {
    const pending = await readPending();
    let changed = false;
    for (const id of exerciseIds) {
      if (id in pending) {
        delete pending[id];
        changed = true;
      }
    }
    if (changed) await writePending(pending);
  }

  // Lets progress.js show a subtle, per-exercise sync status without this
  // file needing to know anything about the DOM. Fired with the eventual
  // outcome of a sync attempt — never on the fast local-save path, which
  // stays instant regardless of network state.
  function notifySyncStatus(exerciseId, status) {
    global.dispatchEvent(new CustomEvent("greatauk:sync-status", { detail: { exerciseId, status } }));
  }

  async function upsertRows(session, rows) {
    if (isPreview() || isReadOnly()) return false;
    // Final gate immediately before the network: nothing reaches Supabase
    // without passing the project's exercise-ID rule.
    rows = allowedRows(rows, "upsert");
    const client = getClient();
    if (!client || !session || rows.length === 0) {
      if (rows.length > 0) {
        await queuePending(rows);
        rows.forEach((r) => notifySyncStatus(r.exercise_id, "pending"));
      }
      return false;
    }
    try {
      const projectId = await ensureProjectId();
      if (!projectId) throw new Error("Could not resolve current project id");
      const displayName = currentDisplayName();
      const payload = rows.map((r) => ({
        user_id: session.user.id,
        exercise_id: r.exercise_id,
        completed: r.completed,
        notes: r.notes,
        student_label: displayName,
        project_id: projectId,
      }));
      const { error } = await client.from(TABLE).upsert(payload, { onConflict: "user_id,exercise_id" });
      if (error) throw error;
      await clearPendingFor(rows.map((r) => r.exercise_id));
      rows.forEach((r) => notifySyncStatus(r.exercise_id, "synced"));
      return true;
    } catch (err) {
      console.warn("[GreatAuk] Supabase sync failed, queued for retry.", err);
      await queuePending(rows);
      rows.forEach((r) => notifySyncStatus(r.exercise_id, "pending"));
      return false;
    }
  }

  async function flushPending() {
    const session = await ensureSession();
    if (!session || isPreview() || isReadOnly()) return;
    const pending = await readPending();
    const rows = Object.values(pending);
    if (rows.length === 0) return;
    await upsertRows(session, rows);
  }

  // ---- initial load / migration -----------------------------------------

  function loadMergedStateOnce() {
    if (!loadPromise) {
      loadPromise = (async () => {
        const session = await ensureSession();
        // Preview (admin/teacher without a student enrolment): no progress
        // of their own here — read nothing, migrate nothing, flush nothing.
        if (isPreview()) return mergedState;

        const local = getLocalAdapter();
        const keys = getKeys();
        const completionKey = await scopedKey(keys.COMPLETION);
        const notesKey = await scopedKey(keys.NOTES);

        if (!session) {
          // No real session available (shouldn't happen given auth-guard,
          // but defensive) — fall back to local data exactly as the plain
          // adapter would.
          const completion = allowedMap((await local.read(completionKey)) || {}, "local cache");
          const notes = allowedMap((await local.read(notesKey)) || {}, "local cache");
          for (const id of Object.keys(completion)) {
            mergedState[id] = { completed: true, notes: notes[id] || "" };
          }
          for (const id of Object.keys(notes)) {
            if (!mergedState[id]) mergedState[id] = { completed: false, notes: notes[id] };
          }
          return mergedState;
        }

        const client = getClient();
        try {
          const projectId = await ensureProjectId();
          const { data, error } = await client
            .from(TABLE)
            .select("exercise_id,completed,notes")
            .eq("user_id", session.user.id)
            .eq("project_id", projectId);
          if (error) throw error;

          if (data && data.length > 0) {
            // Supabase already has rows for this user+project — authoritative.
            const completionMap = {};
            const notesMap = {};
            for (const row of allowedRows(data, "load")) {
              mergedState[row.exercise_id] = { completed: Boolean(row.completed), notes: row.notes || "" };
              if (row.completed) completionMap[row.exercise_id] = true;
              if (row.notes) notesMap[row.exercise_id] = row.notes;
            }
            if (!isReadOnly()) {
              await local.write(completionKey, completionMap);
              await local.write(notesKey, notesMap);
            }
          } else if (!isReadOnly()) {
            // Supabase is empty for this user+project. One-time migration of
            // whatever is already in this scoped slice of localStorage, if
            // anything.
            const migKey = await migratedKey();
            const alreadyMigrated = await local.read(migKey);
            if (!alreadyMigrated) {
              const localCompletion = allowedMap((await local.read(completionKey)) || {}, "seed migration");
              const localNotes = allowedMap((await local.read(notesKey)) || {}, "seed migration");
              const ids = new Set([...Object.keys(localCompletion), ...Object.keys(localNotes)]);
              if (ids.size > 0) {
                const rows = Array.from(ids).map((id) => ({
                  exercise_id: id,
                  completed: Boolean(localCompletion[id]),
                  notes: localNotes[id] || "",
                }));
                await upsertRows(session, rows);
                for (const row of rows) mergedState[row.exercise_id] = { completed: row.completed, notes: row.notes };
              }
              await local.write(migKey, true);
            }
          }
        } catch (err) {
          console.warn("[GreatAuk] Could not load Supabase progress — using local cache only.", err);
          const completion = allowedMap((await local.read(completionKey)) || {}, "local cache");
          const notes = allowedMap((await local.read(notesKey)) || {}, "local cache");
          for (const id of Object.keys(completion)) {
            mergedState[id] = { completed: true, notes: notes[id] || "" };
          }
          for (const id of Object.keys(notes)) {
            if (!mergedState[id]) mergedState[id] = { completed: false, notes: notes[id] };
          }
        }

        // Apply any locally-queued edits that never made it to Supabase
        // (e.g. the tab closed mid-sync) on top of the authoritative load,
        // then try to flush them.
        // They must go into the local completion/notes maps too, not only
        // mergedState: ProgressStore always rewrites a WHOLE map, so a
        // queued edit missing from the map would look "removed" on the
        // very next unrelated save and be upserted back to incomplete/empty
        // — silently undoing the retried answer.
        // (Not on an archived page: it shows exactly what is stored, and any
        // queued edits stay queued for an ordinary page to send.)
        const pending = isReadOnly() ? {} : await readPending();
        const pendingEntries = Object.entries(pending);
        if (pendingEntries.length > 0) {
          const completion = (await local.read(completionKey)) || {};
          const notes = (await local.read(notesKey)) || {};
          for (const [id, row] of pendingEntries) {
            mergedState[id] = { completed: row.completed, notes: row.notes };
            if (row.completed) completion[id] = true;
            else delete completion[id];
            if (row.notes) notes[id] = row.notes;
            else delete notes[id];
          }
          await local.write(completionKey, allowedMap(completion, "local cache"));
          await local.write(notesKey, allowedMap(notes, "local cache"));
        }
        flushPending();

        return mergedState;
      })();
    }
    return loadPromise;
  }

  // ---- the adapter itself ------------------------------------------------

  const HybridAdapter = {
    async read(key) {
      await loadMergedStateOnce();
      if (isPreview()) return null;
      // Archived page: answer from what was just loaded from Supabase (the
      // authoritative record), never from the browser's local cache, which
      // this page deliberately leaves untouched.
      if (isReadOnly()) {
        const keys = getKeys();
        const map = {};
        for (const [id, row] of Object.entries(mergedState)) {
          if (key === keys.COMPLETION && row.completed) map[id] = true;
          if (key === keys.NOTES && row.notes) map[id] = row.notes;
        }
        return allowedMap(map, "read");
      }
      const scoped = await scopedKey(key);
      return allowedMap(await getLocalAdapter().read(scoped), "read");
    },

    async write(key, value) {
      const keys = getKeys();
      await loadMergedStateOnce();
      if (isPreview() || isReadOnly()) return true;

      value = allowedMap(value, "local write");
      const scoped = await scopedKey(key);

      // Always write local first — this is what progress.js's "Saved"
      // status is timed against, so it stays fast and offline-safe.
      await getLocalAdapter().write(scoped, value);

      // Work out which exercise_id(s) this write actually changed, using
      // mergedState as the "last known" baseline, then merge in each row's
      // other field (notes vs completed) so we never overwrite one with a
      // stale/empty value for the other.
      const changedRows = [];

      if (key === keys.COMPLETION) {
        const newMap = value || {};
        const allIds = new Set([...Object.keys(mergedState), ...Object.keys(newMap)]);
        for (const id of allIds) {
          const newCompleted = Boolean(newMap[id]);
          const prevCompleted = Boolean(mergedState[id] && mergedState[id].completed);
          if (newCompleted !== prevCompleted) {
            const notes = (mergedState[id] && mergedState[id].notes) || "";
            mergedState[id] = { completed: newCompleted, notes };
            changedRows.push({ exercise_id: id, completed: newCompleted, notes });
          }
        }
      } else if (key === keys.NOTES) {
        const newMap = value || {};
        const allIds = new Set([...Object.keys(mergedState), ...Object.keys(newMap)]);
        for (const id of allIds) {
          const newNotes = newMap[id] || "";
          const prevNotes = (mergedState[id] && mergedState[id].notes) || "";
          if (newNotes !== prevNotes) {
            const completed = Boolean(mergedState[id] && mergedState[id].completed);
            mergedState[id] = { completed, notes: newNotes };
            changedRows.push({ exercise_id: id, completed, notes: newNotes });
          }
        }
      }

      if (changedRows.length > 0) {
        const session = await ensureSession();
        // Fire-and-forget: don't make the caller (and therefore the
        // "Saved" status) wait on network latency.
        upsertRows(session, changedRows);
      }

      return true;
    },
  };

  // Retry anything left over from a previous visit once the page is back
  // online, in addition to the retry attempt already made on load.
  global.addEventListener("online", () => {
    flushPending();
  });

  // Swap the adapter under the existing ProgressStore — progress.js and
  // home.js never need to know this happened.
  if (global.GreatAuk && global.GreatAuk.ProgressStore) {
    global.GreatAuk.ProgressStore.adapter = HybridAdapter;
  }

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.SyncAdapter = HybridAdapter;
})(window);
