import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, KEYS, summarize } from "../../js/state/store.js";
import { accountBalances } from "../../js/core/ledger.js";
import { fixture } from "./helpers.mjs";

function fakeStorage(initial = {}, { limit = Infinity } = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > limit) throw new Error("QuotaExceededError"); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  };
}
const now = () => new Date(2026, 10, 7, 10, 0, 0);
const make = (storage) => createStore({ storage, now });

test("a first visit starts empty and asks for onboarding", () => {
  const store = make(fakeStorage());
  assert.equal(store.boot().status, "new");
  assert.equal(store.state.profile.onboarded, false);
  assert.equal(store.state.schemaVersion, 2);
});

test("an existing user is upgraded, verified, and the old data is left untouched", () => {
  const original = JSON.stringify(fixture("v1-sample"));
  const storage = fakeStorage({ [KEYS.v1]: original });
  const store = make(storage);
  const result = store.boot();
  assert.equal(result.status, "upgraded");
  assert.ok(result.checked > 50);
  assert.equal(storage.getItem(KEYS.v1), original, "v1 data must never change");
  assert.ok(storage.getItem(KEYS.data));
  assert.equal(accountBalances(store.state).b1 > 0, true);
});

test("after upgrading, the next load is a normal one, and changes persist", () => {
  const storage = fakeStorage({ [KEYS.v1]: JSON.stringify(fixture("v1-sample")) });
  const first = make(storage);
  first.boot();
  first.update((s) => { s.profile.name = "Changed"; });
  const second = make(storage);
  assert.equal(second.boot().status, "ok");
  assert.equal(second.state.profile.name, "Changed");
});

test("orphaned DutyPay data is rescued when it's the only thing there", () => {
  const store = make(fakeStorage({ [KEYS.dutypay]: JSON.stringify(fixture("dutypay-v1")) }));
  const r = store.boot();
  assert.equal(r.status, "upgraded");
  assert.equal(r.from, KEYS.dutypay);
  assert.equal(store.state.staff[0].name, "Anil Kumar");
});

test("v1 data wins over DutyPay data when both exist", () => {
  const store = make(fakeStorage({ [KEYS.v1]: JSON.stringify(fixture("v1-sample")), [KEYS.dutypay]: JSON.stringify(fixture("dutypay-v1")) }));
  assert.equal(store.boot().from, KEYS.v1);
});

test("a failed upgrade switches nothing and hands back the original for download", () => {
  const raw = fixture("v1-sample");
  raw.settings.basis = "nonsense"; // the pay calculation refuses this, so verification can't pass
  const text = JSON.stringify(raw);
  const storage = fakeStorage({ [KEYS.v1]: text });
  const r = make(storage).boot();
  assert.equal(r.status, "rescue");
  assert.equal(r.raw, text);
  assert.equal(storage.getItem(KEYS.data), null);
  assert.equal(storage.getItem(KEYS.v1), text);
});

test("if the upgrade check finds any difference, nothing switches over", () => {
  const text = JSON.stringify(fixture("v1-sample"));
  const storage = fakeStorage({ [KEYS.v1]: text });
  const store = createStore({ storage, now, verify: () => ({ ok: false, problems: ["balance of Savings: was 100, now 90"], checked: 1 }) });
  const r = store.boot();
  assert.equal(r.status, "rescue");
  assert.match(r.reason, /balance of Savings: was 100, now 90/);
  assert.equal(r.raw, text);
  assert.equal(store.state, null, "the app must not run on data that failed the check");
  assert.equal(storage.getItem(KEYS.data), null);
  assert.equal(storage.getItem(KEYS.v1), text);
});

test("a v1 backup that fails the upgrade check is refused, and the current data is kept", () => {
  const storage = fakeStorage();
  const store = createStore({ storage, now, verify: () => ({ ok: false, problems: ["a difference"], checked: 1 }) });
  store.boot();
  assert.throws(() => store.previewBackup(JSON.stringify(fixture("v1-sample"))), /couldn't be upgraded safely/);
  assert.equal(store.state.staff.length, 0);
});

test("unreadable saved data goes to the rescue screen rather than being overwritten", () => {
  const storage = fakeStorage({ [KEYS.data]: "{not json" });
  const r = make(storage).boot();
  assert.equal(r.status, "rescue");
  assert.equal(r.raw, "{not json");
  assert.equal(storage.getItem(KEYS.data), "{not json");
});

test("data from a newer version is refused, not damaged", () => {
  const text = JSON.stringify({ schemaVersion: 99, future: true });
  const storage = fakeStorage({ [KEYS.data]: text });
  const r = make(storage).boot();
  assert.equal(r.status, "rescue");
  assert.match(r.reason, /newer version/);
  assert.equal(storage.getItem(KEYS.data), text);
});

test("subscribers hear about changes", () => {
  const store = make(fakeStorage());
  store.boot();
  const heard = [];
  const off = store.subscribe((_s, reason) => heard.push(reason));
  store.update((s) => { s.profile.name = "A"; });
  off();
  store.update((s) => { s.profile.name = "B"; });
  assert.deepEqual(heard, ["change"]);
});

test("update can replace the state as well as change it", () => {
  const store = make(fakeStorage());
  store.boot();
  store.update((s) => ({ ...s, profile: { ...s.profile, name: "Replaced" } }));
  assert.equal(store.state.profile.name, "Replaced");
});

test("a full browser storage is reported instead of failing silently", () => {
  const storage = fakeStorage({}, { limit: 100 });
  const store = make(storage);
  store.boot();
  const ok = store.update((s) => { s.profile.name = "x".repeat(200); });
  assert.equal(ok, false);
  assert.equal(store.lastSaveFailed, true);
  assert.equal(store.state.profile.name.length, 200, "the change stays in memory so it can still be backed up");
});

test("a change in another tab is picked up", () => {
  const storage = fakeStorage();
  const a = make(storage), b = make(storage);
  a.boot(); b.boot();
  a.update((s) => { s.profile.name = "From tab A"; });
  const heard = [];
  b.subscribe((_s, reason) => heard.push(reason));
  assert.equal(b.syncFromOtherTab(KEYS.data, storage.getItem(KEYS.data)), true);
  assert.equal(b.state.profile.name, "From tab A");
  assert.deepEqual(heard, ["other-tab"]);
  assert.equal(b.syncFromOtherTab("something-else", "{}"), false);
  assert.equal(b.syncFromOtherTab(KEYS.data, "{broken"), false);
  assert.equal(b.syncFromOtherTab(KEYS.data, null), false);
});

test("backup then restore gives identical data", () => {
  const store = make(fakeStorage({ [KEYS.v1]: JSON.stringify(fixture("v1-sample")) }));
  store.boot();
  const before = structuredClone(store.state);
  const preview = store.previewBackup(store.exportBackup());
  assert.equal(preview.fromVersion, 2);
  assert.equal(preview.summary.counts.staff, 8);
  assert.ok(preview.summary.exportedAt);
  assert.deepEqual(preview.state, before);
});

test("old v1 backup files can still be restored", () => {
  const store = make(fakeStorage());
  store.boot();
  const preview = store.previewBackup("﻿" + JSON.stringify(fixture("v1-sample")));
  assert.equal(preview.fromVersion, 1);
  assert.equal(preview.state.staff.length, 8);
  assert.equal(store.state.staff.length, 0, "previewing changes nothing");
});

test("files that aren't backups are refused with a clear message", () => {
  const store = make(fakeStorage());
  store.boot();
  assert.throws(() => store.previewBackup("hello"), /isn't an Accounts Manager backup/);
  assert.throws(() => store.previewBackup('{"hello":"world"}'), /isn't an Accounts Manager backup/);
  assert.throws(() => store.previewBackup('{"schemaVersion":99}'), /newer version/);
});

test("replacing data keeps a safety copy that can be brought back", () => {
  const storage = fakeStorage({ [KEYS.v1]: JSON.stringify(fixture("v1-sample")) });
  const store = make(storage);
  store.boot();
  const before = structuredClone(store.state);
  store.clearAll();
  assert.equal(store.state.staff.length, 0);
  assert.equal(store.safetyCopy().reason, "Clear all data");
  store.restoreSafetyCopy();
  assert.deepEqual(store.state, before);
});

test("sample mode never touches real data", () => {
  const storage = fakeStorage({ [KEYS.v1]: JSON.stringify(fixture("v1-sample")) });
  const store = make(storage);
  store.boot();
  store.update((s) => { s.profile.name = "My real business"; });
  const realText = storage.getItem(KEYS.data);

  store.enterSample({ ...structuredClone(store.state), staff: [], profile: { ...store.state.profile, name: "Sample" } });
  assert.equal(store.isSample, true);
  store.update((s) => { s.profile.name = "Edited sample"; });
  assert.equal(storage.getItem(KEYS.data), realText, "real data unchanged while exploring");

  const reopened = make(storage);
  reopened.boot();
  assert.equal(reopened.isSample, true, "a reload stays in sample mode");
  assert.equal(reopened.state.profile.name, "Edited sample");

  reopened.exitSample();
  assert.equal(reopened.isSample, false);
  assert.equal(reopened.state.profile.name, "My real business");
  assert.equal(storage.getItem(KEYS.sample), null);
  assert.equal(storage.getItem(KEYS.data), realText);
});

test("storage usage and summaries", () => {
  const storage = fakeStorage();
  const store = make(storage);
  store.boot();
  store.save();
  const u = store.usage();
  assert.ok(u.used > 0);
  assert.equal(u.limit, 5 * 1024 * 1024);
  assert.equal(u.percent, Math.round((u.used / u.limit) * 100));
  assert.equal(summarize(store.state).counts.accounts, 1);
});

test("marking a backup records the time", () => {
  const store = make(fakeStorage());
  store.boot();
  assert.equal(store.state.settings.lastBackupAt, null);
  store.markBackedUp();
  assert.equal(store.state.settings.lastBackupAt, now().toISOString());
});
