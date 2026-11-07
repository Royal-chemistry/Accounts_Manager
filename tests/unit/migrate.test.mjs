import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, MigrationError, verifyMigration, versionOf } from "../../js/core/migrate.js";
import { accountBalances } from "../../js/core/ledger.js";
import { docTotals, openDocs } from "../../js/core/documents.js";
import { payFor } from "../../js/core/payroll.js";
import { fixture, golden, migrated, TODAY } from "./helpers.mjs";

const NAMES = ["v1-sample", "v1-edge", "v1-empty", "dutypay-v1"];

for (const name of NAMES) {
  test(`${name}: every figure matches what v1 calculated`, () => {
    const g = golden(name);
    const s = migrated(name);
    assert.equal(s.staff.length, g.counts.staff);
    assert.equal(s.clients.length, g.counts.clients);
    assert.equal(s.invoices.length, g.counts.invoices);
    assert.equal(s.transactions.length, g.counts.cash);
    assert.equal(s.advances.length, g.counts.advances);
    assert.equal(s.transfers.length, g.counts.transfers);
    assert.equal(s.loans.length, g.counts.loans);
    assert.equal(s.recurring.length, g.counts.recurring);
    assert.equal(s.salaryPayments.length, g.counts.salaryPayments);
    assert.equal(s.invoices.reduce((t, i) => t + i.payments.length, 0), g.counts.invoicePayments);
    assert.equal(s.loans.reduce((t, l) => t + l.payments.length, 0), g.counts.loanPayments);

    const balances = accountBalances(s);
    for (const [id, amount] of Object.entries(g.balances)) assert.equal(balances[id], amount, `balance of ${id}`);

    for (const inv of s.invoices) {
      const before = g.invoices[inv.id], after = docTotals(inv);
      for (const k of ["subtotal", "gst", "total", "received", "tds", "balance", "status"]) assert.equal(after[k], before[k], `invoice ${inv.id} ${k}`);
    }

    const names = { duties: "days", base: "base", special: "extra", bonus: "bonus", gross: "gross", advance: "advance", mess: "food", uniform: "kit", other: "other", pf: "pf", esi: "esi", deductions: "deductions", net: "net", rate: "rate", divisor: "divisor" };
    for (const [month, rows] of Object.entries(g.pay)) {
      for (const [staffId, before] of Object.entries(rows)) {
        const after = payFor(s, s.staff.find((x) => x.id === staffId), month);
        for (const [oldKey, newKey] of Object.entries(names)) assert.equal(after[newKey], before[oldKey], `${staffId} ${month} ${oldKey}`);
      }
    }
  });

  test(`${name}: passes its own verification`, () => {
    const raw = fixture(name);
    const check = verifyMigration(raw, migrate(raw, { today: TODAY }).state, { today: TODAY });
    assert.deepEqual(check.problems, []);
    assert.ok(check.ok);
  });
}

test("the sample's headline figures are the ones shown on the live app", () => {
  const s = migrated("v1-sample");
  const inAccounts = Object.values(accountBalances(s)).reduce((t, v) => t + v, 0);
  assert.equal(inAccounts, 834481);
  const owed = openDocs(s, "receivable").reduce((t, d) => t + d.balance, 0);
  assert.equal(owed, 170150);
  const pays = s.staff.map((x) => payFor(s, x, "2026-10"));
  assert.equal(pays.reduce((t, p) => t + p.gross, 0), 104871);
  assert.equal(pays.reduce((t, p) => t + p.net, 0), 71771);
});

test("migrating doesn't change the input", () => {
  const raw = fixture("v1-edge");
  const before = JSON.stringify(raw);
  migrate(raw, { today: TODAY });
  assert.equal(JSON.stringify(raw), before);
});

test("migrating twice gives the same result", () => {
  const once = migrated("v1-edge");
  const twice = migrate(JSON.parse(JSON.stringify(once)), { today: TODAY }).state;
  assert.deepEqual(twice, once);
});

test("version detection", () => {
  assert.equal(versionOf(fixture("v1-sample")), 1);
  assert.equal(versionOf(fixture("dutypay-v1")), 1);
  assert.equal(versionOf(migrated("v1-sample")), 2);
  assert.equal(versionOf({ hello: "world" }), 0);
  assert.equal(versionOf(null), 0);
});

test("refuses data from a newer version, and anything unrecognised", () => {
  assert.throws(() => migrate({ schemaVersion: 99 }, { today: TODAY }), (e) => e instanceof MigrationError && e.code === "newer");
  assert.throws(() => migrate({ hello: "world" }, { today: TODAY }), (e) => e instanceof MigrationError && e.code === "unrecognised");
});

test("verification catches a figure that changed", () => {
  const raw = fixture("v1-sample");
  const { state } = migrate(raw, { today: TODAY });
  state.invoices[0].lines[0].rate += 1;
  state.accounts[0].opening += 10;
  const check = verifyMigration(raw, state, { today: TODAY });
  assert.equal(check.ok, false);
  assert.ok(check.problems.some((p) => p.includes("balance of")));
  assert.ok(check.problems.some((p) => p.includes("invoice ST-001")));
});

test("field mapping", () => {
  const s = migrated("v1-edge");
  assert.equal(s.profile.name, "Edge Case & Sons <Pvt> Ltd");
  assert.equal(s.profile.address, "12 Lake Road, Kochi");
  assert.equal(s.profile.gstin, "32AAAAA0000A1Z5");
  assert.equal(s.profile.stateCode, "32");
  assert.equal(s.settings.pay.basis, "30");
  assert.equal(s.settings.pay.extraRate, 500);
  assert.equal(s.settings.invoice.prefix, "EC-");
  assert.equal(s.settings.invoice.nextNo, 7);
  assert.equal(s.staff[0].team, "North");
  assert.equal(s.staff[0].salary, 15000);
  assert.equal(s.staff[0].active, true);
  assert.equal(s.entries["2026-10"].s1.daysWorked, 26);
  assert.equal(s.entries["2026-10"].s1.foodDays, "");
  assert.equal(s.entries["2026-10"].s3.kit, 750);
  assert.equal(s.entries["2026-10"].ghost.daysWorked, 12);
  assert.equal(s.profile.onboarded, false);
});

test("payment modes follow the migration rules", () => {
  const s = migrated("v1-edge");
  const tx = (id) => s.transactions.find((t) => t.id === id);
  assert.deepEqual([tx("k1").mode, tx("k1").accountId, tx("k1").untracked], ["bank", "bank1", false]);
  assert.deepEqual([tx("k2").mode, tx("k2").accountId, tx("k2").untracked], ["cash", "bank2", false]);
  assert.deepEqual([tx("k3").mode, tx("k3").accountId, tx("k3").untracked], ["cash", null, true]);
  assert.deepEqual([tx("k4").mode, tx("k4").accountId, tx("k4").untracked], ["cash", null, true]);
  assert.equal(tx("k2").type, "expense");
  assert.equal(s.accounts.find((a) => a.id === "bank2").kind, "cash");
  assert.equal(s.settings.defaults.cashAccountId, "bank2");
  assert.equal(s.settings.defaults.upiAccountId, "bank1");
});

test("a Cash in hand account is added at zero when there isn't one", () => {
  const s = migrated("dutypay-v1");
  const cash = s.accounts.find((a) => a.kind === "cash");
  assert.equal(cash.name, "Cash in hand");
  assert.equal(cash.opening, 0);
  assert.equal(s.settings.defaults.cashAccountId, cash.id);
});

test("unsafe IDs from a crafted backup are replaced everywhere", () => {
  const s = migrated("v1-unsafe-ids");
  const text = JSON.stringify(s);
  assert.ok(!text.includes("onerror"));
  assert.ok(!text.includes("<script>"));
  assert.equal(s.advances[0].staffId, s.staff[0].id);
  assert.equal(s.transactions[0].accountId, s.accounts[0].id);
  assert.ok(s.entries["2026-10"][s.staff[0].id]);
  assert.equal(accountBalances(s)[s.accounts[0].id], 100 - 50 + 20);
});

test("existing categories are kept when seeding the lists", () => {
  const s = migrated("v1-sample");
  for (const c of ["Stock purchase", "Rent", "Rent", "Electricity"]) assert.ok(s.categories.expense.includes(c));
  assert.ok(s.categories.income.includes("Sales"));
  assert.equal(new Set(s.categories.expense).size, s.categories.expense.length);
});

test("recurring payments start from their first paid month", () => {
  const s = migrated("v1-edge");
  assert.equal(s.recurring.find((r) => r.id === "r1").startMonth, "2026-10");
  assert.equal(s.recurring.find((r) => r.id === "r1").frequency, "monthly");
  assert.equal(s.recurring.find((r) => r.id === "r2").dueDay, 31);
});
