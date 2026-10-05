/**
 * storage.js
 *
 * Persistence layer for the Lab Notebook.
 *
 * Everything the UI needs (exercise completion, exercise notes) goes through
 * ProgressStore below. ProgressStore talks to an "adapter" object with a
 * small async read/write interface. Today the adapter wraps localStorage.
 * Swapping to a real backend (Supabase, Firebase, a small API) later only
 * means writing a new adapter with the same {read, write} shape and pointing
 * ProgressStore.adapter at it — nothing in the UI code needs to change.
 */

(function (global) {
  "use strict";

  const STORAGE_KEYS = {
    COMPLETION: "greatauk_exercise_completion_v1",
    NOTES: "greatauk_exercise_notes_v1",
  };

  /** Adapter backed by window.localStorage. */
  const LocalStorageAdapter = {
    async read(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn("[GreatAuk] storage read failed for", key, err);
        return null;
      }
    },
    async write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        console.warn("[GreatAuk] storage write failed for", key, err);
        return false;
      }
    },
  };

  const ProgressStore = {
    adapter: LocalStorageAdapter,

    async getCompletionMap() {
      return (await this.adapter.read(STORAGE_KEYS.COMPLETION)) || {};
    },

    async isExerciseComplete(exerciseId) {
      const map = await this.getCompletionMap();
      return Boolean(map[exerciseId]);
    },

    async setExerciseComplete(exerciseId, completed) {
      const map = await this.getCompletionMap();
      if (completed) {
        map[exerciseId] = true;
      } else {
        delete map[exerciseId];
      }
      await this.adapter.write(STORAGE_KEYS.COMPLETION, map);
      return map;
    },

    async countCompleted(exerciseIds) {
      const map = await this.getCompletionMap();
      return exerciseIds.reduce((n, id) => n + (map[id] ? 1 : 0), 0);
    },

    async getNotesMap() {
      return (await this.adapter.read(STORAGE_KEYS.NOTES)) || {};
    },

    async getExerciseNotes(exerciseId) {
      const map = await this.getNotesMap();
      return map[exerciseId] || "";
    },

    async setExerciseNotes(exerciseId, text) {
      const map = await this.getNotesMap();
      if (text && text.trim().length > 0) {
        map[exerciseId] = text;
      } else {
        delete map[exerciseId];
      }
      await this.adapter.write(STORAGE_KEYS.NOTES, map);
      return map;
    },
  };

  global.GreatAuk = global.GreatAuk || {};
  global.GreatAuk.ProgressStore = ProgressStore;
  global.GreatAuk.STORAGE_KEYS = STORAGE_KEYS;
  global.GreatAuk.LocalStorageAdapter = LocalStorageAdapter;
})(window);
