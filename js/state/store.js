// Loading and saving. Storage is passed in, so this runs the same in the browser and in tests.
// The old v1 data is only ever read, never changed, so the upgrade can always be undone by hand.
import { localToday } from "../core/dates.js";
import { migrate, MigrationError, verifyMigration, versionOf } from "../core/migrate.js";
import { blank, DATA_COLLECTIONS } from "../core/schema.js";

export const KEYS = {
  data: "accounts-manager:data",
  v1: "accounts-manager:v1",
  dutypay: "dutypay:v1",
  safety: "accounts-manager:safety",
  sample: "accounts-manager:sample",
  mode: "accounts-manager:mode",
  notice: "accounts-manager:upgrade-notice",
};

const STORAGE_LIMIT = 5 * 1024 * 1024; // what browsers typically allow

/** Summarises a data set in words, for restore previews. */
export function summarize(state) {
  const counts = {};
  for (const k of DATA_COLLECTIONS) if (k !== "bin") counts[k] = state[k]?.length || 0;
  return { name: state.profile?.name || "", counts, exportedAt: state.backup?.exportedAt || null };
}

export function createStore({ storage, now = () => new Date(), verify = verifyMigration }) {
  let state = null;
  let mode = "real";
  const listeners = new Set();
  const today = () => localToday(now());
  const activeKey = () => (mode === "sample" ? KEYS.sample : KEYS.data);

  const read = (key) => { try { return storage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { storage.setItem(key, value); return true; } catch { return false; } };
  const emit = (reason) => { for (const fn of listeners) fn(state, reason); };

  const store = {
    get state() { return state; },
    get mode() { return mode; },
    get isSample() { return mode === "sample"; },
    lastSaveFailed: false,
    today,

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * Loads saved data, upgrading it if needed.
     * Returns { status: "ok" | "new" | "upgraded" | "rescue", ... }. "rescue" means nothing was changed.
     */
    boot() {
      mode = read(KEYS.mode) === "sample" && read(KEYS.sample) ? "sample" : "real";
      if (mode === "sample") {
        try {
          state = migrate(JSON.parse(read(KEYS.sample)), { today: today() }).state;
          return { status: "ok", sample: true };
        } catch {
          mode = "real";
          try { storage.removeItem(KEYS.sample); storage.removeItem(KEYS.mode); } catch { /* nothing to clean */ }
        }
      }
      const saved = read(KEYS.data);
      if (saved) {
        try {
          const { state: loaded, fromVersion } = migrate(JSON.parse(saved), { today: today() });
          state = loaded;
          if (fromVersion < 2) store.save();
          return { status: "ok" };
        } catch (err) {
          return { status: "rescue", reason: err instanceof MigrationError ? err.message : "Your saved data couldn't be read.", raw: saved, key: KEYS.data };
        }
      }
      const legacyKey = read(KEYS.v1) ? KEYS.v1 : read(KEYS.dutypay) ? KEYS.dutypay : null;
      if (!legacyKey) {
        state = blank(today());
        return { status: "new" };
      }
      const rawText = read(legacyKey);
      try {
        const parsed = JSON.parse(rawText);
        const { state: upgraded } = migrate(parsed, { today: today() });
        const check = verify(parsed, upgraded, { today: today() });
        if (!check.ok) throw new MigrationError("verify", `The upgrade check found a difference: ${check.problems[0]}`);
        state = upgraded;
        const saved2 = store.save();
        write(KEYS.notice, legacyKey);
        return { status: "upgraded", from: legacyKey, checked: check.checked, saved: saved2 };
      } catch (err) {
        return { status: "rescue", reason: err instanceof MigrationError ? err.message : "Your saved data couldn't be read.", raw: rawText, key: legacyKey };
      }
    },

    /** The old data's text, if an upgrade happened and its one-time notice hasn't been dismissed yet. */
    upgradeNotice() {
      const key = read(KEYS.notice);
      return key ? { oldDataText: read(key) } : null;
    },

    clearUpgradeNotice() {
      try { storage.removeItem(KEYS.notice); } catch { /* it will just show again */ }
    },

    save() {
      const ok = write(activeKey(), JSON.stringify(state));
      store.lastSaveFailed = !ok;
      return ok;
    },

    /** Runs a change and saves it. fn may change the state directly or return a new one. Returns whether it saved. */
    update(fn, reason = "change") {
      const result = fn(state);
      if (result && typeof result === "object") state = result;
      const ok = store.save();
      emit(reason);
      return ok;
    },

    /** Picks up a change made in another tab. Returns true if anything changed here. */
    syncFromOtherTab(key, newValue) {
      if (key !== activeKey() || !newValue) return false;
      try {
        state = migrate(JSON.parse(newValue), { today: today() }).state;
        emit("other-tab");
        return true;
      } catch { return false; }
    },

    /** The text of a backup file. */
    exportBackup() {
      return JSON.stringify({ ...state, backup: { app: "accounts-manager", exportedAt: now().toISOString() } });
    },

    markBackedUp() { store.update((s) => { s.settings.lastBackupAt = now().toISOString(); }, "backup"); },

    /** Reads a backup file without changing anything. Returns { state, summary, fromVersion }. Throws with a readable message. */
    previewBackup(text) {
      let parsed;
      try { parsed = JSON.parse(String(text).replace(/^﻿/, "")); } catch { throw new Error("That file isn't an Accounts Manager backup."); }
      if (!versionOf(parsed)) throw new Error("That file isn't an Accounts Manager backup.");
      const { state: next, fromVersion } = migrate(parsed, { today: today() });
      if (fromVersion === 1) {
        const check = verify(parsed, next, { today: today() });
        if (!check.ok) throw new Error(`That backup couldn't be upgraded safely: ${check.problems[0]}`);
      }
      delete next.backup;
      return { state: next, summary: summarize({ ...next, backup: parsed.backup }), fromVersion };
    },

    /** Saves the current data to the safety slot before something replaces it. */
    keepSafetyCopy(reason) {
      return write(KEYS.safety, JSON.stringify({ reason, savedAt: now().toISOString(), data: state }));
    },

    safetyCopy() {
      try {
        const s = JSON.parse(read(KEYS.safety));
        return s?.data ? { reason: s.reason, savedAt: s.savedAt } : null;
      } catch { return null; }
    },

    restoreSafetyCopy() {
      const s = JSON.parse(read(KEYS.safety));
      state = migrate(s.data, { today: today() }).state;
      store.save();
      emit("restored");
    },

    replaceWith(next, reason) {
      const safe = store.keepSafetyCopy(reason);
      state = next;
      const saved = store.save();
      emit("replaced");
      return { safe, saved };
    },

    clearAll() { return store.replaceWith(blank(today()), "Clear all data"); },

    enterSample(sampleState) {
      mode = "sample";
      write(KEYS.mode, "sample");
      state = sampleState;
      store.save();
      emit("sample");
    },

    exitSample() {
      try { storage.removeItem(KEYS.sample); storage.removeItem(KEYS.mode); } catch { /* nothing to clean */ }
      mode = "real";
      return store.boot();
    },

    /** How much browser storage is in use, as { used, limit, percent }. */
    usage() {
      let used = 0;
      for (const key of Object.values(KEYS)) used += (read(key)?.length || 0) * 2;
      return { used, limit: STORAGE_LIMIT, percent: Math.min(100, Math.round((used / STORAGE_LIMIT) * 100)) };
    },
  };
  return store;
}
