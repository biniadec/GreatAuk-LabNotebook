/**
 * sync-adapter.js
 *
 * Makes Supabase the authoritative, shared copy of Luigi's progress while
 * keeping localStorage as an instant local cache/offline fallback — without
 * changing ProgressStore's public API, and without progress.js or home.js
 * needing to know Supabase exists at all.
 *
 * How it fits in: storage.js defines ProgressStore with a plain
 * LocalStorageAdapter. This file defines a HybridAdapter with the exact
 * same {read(key), write(key, value)} shape, then replaces
 * ProgressStore.adapter with it. Every call progress.js/home.js already
 * make (store.setExerciseComplete, store.getExerciseNotes, ...) is
 * unchanged — only what happens underneath is new.
 *
 * Session: an anonymous Supabase session is restored (or silently created)
 * on first use. The Supabase JS client persists that session's refresh
 * token in this browser's localStorage and keeps it alive indefinitely —
 * there is no separate "login" step and nothing for Luigi to see.
 *
 * On first read in a page load:
 *  - if Supabase already has rows for this user, they overwrite the local
 *    cache (Supabase is authoritative);
 *  - if Supabase has no rows yet but localStorage has existing progress
 *    (e.g. from before this feature existed), that local data is pushed up
 *    once as the seed, then Supabase takes over from there.
 *
 * On every write:
 *  - localStorage is updated immediately (so the UI never waits on the
 *    network — this is what progress.js's "Saved" status reflects);
 *  - the changed exercise row(s) are upserted to Supabase in the
 *    background;
 *  - anything that fails to sync (offline, transient error) is kept in a
 *    small local retry queue and re-attempted on the next write or page
 *    load, so nothing is silently lost.
 */

(function (global) {
  "use strict";

  const PENDING_KEY = "greatauk_sync_pending_v1";
  const MIGRATED_KEY = "greatauk_sync_migrated_v1";
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

  // ---- in-memory state for this page load ------------------------------

  // { [exerciseId]: { completed: bool, notes: string } } — the merged,
  // Supabase-authoritative view once loaded. Used to know each row's
  // "other half" when only completion or only notes changes, and as the
  // baseline for diffing writes.
  let mergedState = {};
  let sessionPromise = null;
  let loadPromise = null;

  // ---- session ----------------------------------------------------------

  async function ensureSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const client = getClient();
      if (!client) return null;
      try {
        const { data, error: getErr } = await client.auth.getSession();
        if (getErr) throw getErr;
        if (data && data.session) return data.session;

        const { data: signInData, error: signInErr } = await client.auth.signInAnonymously();
        if (signInErr) throw signInErr;
        return signInData.session;
      } catch (err) {
        console.warn("[GreatAuk] Supabase session unavailable — using localStorage only.", err);
        return null;
      }
    })();
    return sessionPromise;
  }

  // ---- pending (retry) queue --------------------------------------------

  async function readPending() {
    return (await getLocalAdapter().read(PENDING_KEY)) || {};
  }

  async function writePending(pending) {
    await getLocalAdapter().write(PENDING_KEY, pending);
  }

  async function queuePending(rows) {
    const pending = await readPending();
    for (const row of rows) pending[row.exercise_id] = row;
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
    const client = getClient();
    if (!client || !session || rows.length === 0) {
      if (rows.length > 0) {
        await queuePending(rows);
        rows.forEach((r) => notifySyncStatus(r.exercise_id, "pending"));
      }
      return false;
    }
    try {
      const payload = rows.map((r) => ({
        user_id: session.user.id,
        exercise_id: r.exercise_id,
        completed: r.completed,
        notes: r.notes,
        student_label: "Luigi",
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
    if (!session) return;
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
        const local = getLocalAdapter();
        const keys = getKeys();

        if (!session) {
          // No Supabase session available (disabled, offline, blocked) —
          // fall back to local data exactly as the plain adapter would.
          const completion = (await local.read(keys.COMPLETION)) || {};
          const notes = (await local.read(keys.NOTES)) || {};
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
          const { data, error } = await client
            .from(TABLE)
            .select("exercise_id,completed,notes")
            .eq("user_id", session.user.id);
          if (error) throw error;

          if (data && data.length > 0) {
            // Supabase already has rows for this identity — authoritative.
            const completionMap = {};
            const notesMap = {};
            for (const row of data) {
              mergedState[row.exercise_id] = { completed: Boolean(row.completed), notes: row.notes || "" };
              if (row.completed) completionMap[row.exercise_id] = true;
              if (row.notes) notesMap[row.exercise_id] = row.notes;
            }
            await local.write(keys.COMPLETION, completionMap);
            await local.write(keys.NOTES, notesMap);
          } else {
            // Supabase is empty for this identity. One-time migration of
            // whatever is already in localStorage, if anything.
            const alreadyMigrated = await local.read(MIGRATED_KEY);
            if (!alreadyMigrated) {
              const localCompletion = (await local.read(keys.COMPLETION)) || {};
              const localNotes = (await local.read(keys.NOTES)) || {};
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
              await local.write(MIGRATED_KEY, true);
            }
          }
        } catch (err) {
          console.warn("[GreatAuk] Could not load Supabase progress — using local cache only.", err);
          const completion = (await local.read(keys.COMPLETION)) || {};
          const notes = (await local.read(keys.NOTES)) || {};
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
        const pending = await readPending();
        for (const [id, row] of Object.entries(pending)) {
          mergedState[id] = { completed: row.completed, notes: row.notes };
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
      return getLocalAdapter().read(key);
    },

    async write(key, value) {
      const keys = getKeys();
      await loadMergedStateOnce();

      // Always write local first — this is what progress.js's "Saved"
      // status is timed against, so it stays fast and offline-safe.
      await getLocalAdapter().write(key, value);

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
