import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBin, impactOf, moveToBin, purgeFromBin, restoreFromBin } from "../../js/core/bin.js";
import { accountBalances } from "../../js/core/ledger.js";
import { docTotals, outstanding } from "../../js/core/documents.js";
import { onHand } from "../../js/core/stock.js";
import { allocatePayment, openDocs, settle } from "../../js/core/documents.js";
import { payFor } from "../../js/core/payroll.js";
import { migrated, richState } from "./helpers.mjs";

const now = new Date("2026-11-07T10:00:00Z");
const withoutBin = (s) => { const { bin, ...rest } = s; return rest; };

const CASES = [
  ["invoice", "i1"], ["invoice", "inv-stock"], ["purchase", "bill1"], ["purchase", "bill2"], ["transaction", "credit-exp"],
  ["payment", "p1"], ["payment", "bp1"], ["client", "c1"], ["client", "c2"], ["supplier", "sup1"], ["staff", "g0"], ["staff", "g1"],
  ["advance", "a0"], ["transfer", "t1"], ["loan", "l1"], ["loanPayment", "lp1"], ["recurring", "r0"], ["item", "item1"], ["stockMove", "mv1"],
];

for (const [type, id] of CASES) {
  test(`${type} ${id}: delete then restore gives back exactly the same data`, () => {
    const start = richState();
    const before = structuredClone(start);
    const { state: deleted, entry } = moveToBin(start, type, id, { now });
    assert.deepEqual(start, before, "deleting must not change the original");
    assert.notDeepEqual(withoutBin(deleted), withoutBin(before));
    assert.equal(deleted.bin.length, 1);
    assert.equal(entry.type, type);
    assert.equal(entry.deletedAt, now.toISOString());
    const restored = restoreFromBin(deleted, entry.id);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.state, before);
  });
}

test("salary payment and recurring-linked entry round trips", () => {
  const s = richState();
  const paymentId = s.salaryPayments[0].id;
  const a = moveToBin(s, "salaryPayment", paymentId, { now });
  assert.deepEqual(restoreFromBin(a.state, a.entry.id).state, s);
  const linked = s.transactions.find((t) => t.recurringId);
  const b = moveToBin(s, "transaction", linked.id, { now });
  const r = b.state.recurring.find((x) => x.id === linked.recurringId);
  assert.ok(!Object.values(r.paid).includes(linked.id), "the recurring payment goes back to unpaid");
  assert.deepEqual(restoreFromBin(b.state, b.entry.id).state, s);
});

test("deleting a settlement removes every payment made together, and undoes as one", () => {
  const s = richState();
  const { allocations } = allocatePayment(openDocs(s, "payable", { partyId: "sup1" }), 700);
  settle(s, { side: "payable", partyId: "sup1", date: "2026-11-01", mode: "bank", accountId: "b1", allocations });
  const paymentId = s.purchases[0].payments.find((p) => p.settlementId).id;
  const impact = impactOf(s, "payment", paymentId);
  assert.match(impact.title, /settlement/);
  const { state: after, entry } = moveToBin(s, "payment", paymentId, { now });
  assert.equal(after.purchases[0].payments.some((p) => p.settlementId), false);
  assert.equal(after.transactions.flatMap((t) => t.payments || []).some((p) => p.settlementId), false);
  assert.deepEqual(restoreFromBin(after, entry.id).state, s);
});

test("the modal text says what an invoice delete removes and what else changes", () => {
  const s = migrated("v1-sample");
  const i = impactOf(s, "invoice", "i2");
  assert.equal(i.title, "Delete Invoice ST-002?");
  assert.ok(i.removes.includes("Invoice ST-002 for ₹28,800"));
  assert.ok(i.removes.includes("1 payment totalling ₹15,000"));
  assert.ok(i.affects.includes("Savings balance goes down by ₹15,000"));
  assert.ok(i.affects.some((a) => a.includes("₹13,800 less outstanding")));
  assert.deepEqual(i.blockers, []);
});

test("the modal warns when a delete would push stock negative", () => {
  const s = richState();
  const i = impactOf(s, "purchase", "bill1");
  assert.ok(i.affects.includes("Stock of Widget goes down by 5 pcs"));
  const big = structuredClone(s);
  big.invoices.push({ id: "b", no: "B", clientId: "c1", date: "2026-10-25", reducesStock: true, lines: [{ qty: 8, rate: 1, gstRate: 0, itemId: "item1" }], payments: [] });
  assert.match(impactOf(big, "purchase", "bill1").warnings[0], /Widget would drop to -3/);
});

test("an invoice delete returns its stock", () => {
  const s = richState();
  assert.equal(onHand(s, "item1"), 10);
  assert.ok(impactOf(s, "invoice", "inv-stock").affects.includes("Stock of Widget goes up by 3 pcs"));
  assert.equal(onHand(moveToBin(s, "invoice", "inv-stock", { now }).state, "item1"), 13);
});

test("deleting moves money, and restoring moves it back", () => {
  const s = migrated("v1-sample");
  const before = accountBalances(s).b2;
  const { state, entry } = moveToBin(s, "invoice", "i2", { now });
  assert.equal(accountBalances(state).b2, before - 15000);
  assert.equal(accountBalances(restoreFromBin(state, entry.id).state).b2, before);
});

test("a client with history offers Mark inactive and lists what goes with them", () => {
  const s = migrated("v1-sample");
  const i = impactOf(s, "client", "c1");
  assert.equal(i.alternative.action, "inactive");
  assert.ok(i.removes.includes("2 invoices and their payments"));
  const fresh = structuredClone(s);
  fresh.clients.push({ id: "new", name: "New Client" });
  assert.equal(impactOf(fresh, "client", "new").alternative, null);
});

test("a staff member with history offers Mark inactive and takes their money records too", () => {
  const s = migrated("v1-sample");
  const i = impactOf(s, "staff", "g1");
  assert.equal(i.alternative.action, "inactive");
  assert.ok(i.removes.includes("1 month of pay records"));
  assert.ok(i.removes.includes("1 salary payment"));
  assert.ok(i.affects.some((a) => a.includes("Current account balance goes up")));
  const { state } = moveToBin(s, "staff", "g1", { now });
  assert.equal(state.salaryPayments.some((p) => p.staffId === "g1"), false);
  assert.equal(state.entries["2026-10"].g1, undefined);
});

test("an account with transactions can't be deleted, only closed", () => {
  const s = migrated("v1-sample");
  const i = impactOf(s, "account", "b1");
  assert.equal(i.blockers.length, 1);
  assert.equal(i.alternative.action, "close");
  assert.throws(() => moveToBin(s, "account", "b1", { now }), /has transactions/);
});

test("an unused account can be deleted, except the default cash account", () => {
  const s = migrated("v1-sample");
  s.accounts.push({ id: "spare", name: "Spare", kind: "bank", opening: 0 });
  assert.deepEqual(impactOf(s, "account", "spare").blockers, []);
  assert.ok(moveToBin(s, "account", "spare", { now }).state.accounts.every((a) => a.id !== "spare"));
  const fresh = migrated("v1-empty");
  assert.match(impactOf(fresh, "account", "cash").blockers[0], /default cash account/);
});

test("a stock item's lines keep their text when it's deleted", () => {
  const s = richState();
  const i = impactOf(s, "item", "item1");
  assert.equal(i.alternative.action, "inactive");
  assert.ok(i.removes.includes("1 stock movement"));
  const { state } = moveToBin(s, "item", "item1", { now });
  assert.equal(state.invoices.find((x) => x.id === "inv-stock").lines[0].desc, "Widget");
  assert.equal(docTotals(state.invoices.find((x) => x.id === "inv-stock")).subtotal, 450);
});

test("an advance delete says whose pay goes up", () => {
  const s = migrated("v1-sample");
  const i = impactOf(s, "advance", "a0");
  assert.ok(i.affects.includes("Rajesh K's pay for October 2026 goes up by ₹2,000"));
  const before = payFor(s, s.staff[0], "2026-10").net;
  assert.equal(payFor(moveToBin(s, "advance", "a0", { now }).state, s.staff[0], "2026-10").net, before + 2000);
});

test("restoring a payment whose invoice is in the bin asks for the invoice first", () => {
  const s = migrated("v1-sample");
  const a = moveToBin(s, "payment", "p1", { now });
  const b = moveToBin(a.state, "invoice", "i1", { now });
  const r = restoreFromBin(b.state, a.entry.id);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Restore that first/);
  const invoiceBack = restoreFromBin(b.state, b.entry.id);
  assert.equal(invoiceBack.ok, true);
  assert.equal(restoreFromBin(invoiceBack.state, a.entry.id).ok, true);
});

test("restoring a payment whose invoice was permanently deleted is refused, not lost silently", () => {
  const s = migrated("v1-sample");
  const a = moveToBin(s, "payment", "p1", { now });
  const b = moveToBin(a.state, "invoice", "i1", { now });
  const purged = purgeFromBin(b.state, b.entry.id);
  const r = restoreFromBin(purged, a.entry.id);
  assert.equal(r.ok, false);
  assert.match(r.reason, /permanently deleted/);
  assert.equal(r.state.bin.length, 1);
});

test("restoring after the client is gone keeps the saved name and warns", () => {
  const s = migrated("v1-sample");
  const a = moveToBin(s, "invoice", "i2", { now });
  const withoutClient = structuredClone(a.state);
  const b = moveToBin(withoutClient, "client", "c2", { now });
  const purged = purgeFromBin(b.state, b.entry.id);
  const r = restoreFromBin(purged, a.entry.id);
  assert.equal(r.ok, true);
  assert.match(r.warnings[0], /St\. Mary's School no longer exists/);
  assert.equal(r.state.invoices.find((i) => i.id === "i2").partyNameSnapshot, "St. Mary's School");
});

test("restoring after the account is gone warns, and doesn't add to any balance", () => {
  const s = migrated("v1-sample");
  const a = moveToBin(s, "transaction", "c0", { now });
  const purgedAccount = structuredClone(a.state);
  purgedAccount.transfers = [];
  purgedAccount.accounts = purgedAccount.accounts.filter((x) => x.id !== "b3");
  const r = restoreFromBin(purgedAccount, a.entry.id);
  assert.equal(r.ok, true);
  assert.match(r.warnings[0], /account it used no longer exists/);
  assert.equal(accountBalances(r.state).b3, undefined);
});

test("restoring a recurring entry after it was paid again warns about a duplicate", () => {
  const s = migrated("v1-sample");
  const linked = s.transactions.find((t) => t.recurringId);
  const a = moveToBin(s, "transaction", linked.id, { now });
  const r0 = a.state.recurring.find((x) => x.id === linked.recurringId);
  const month = Object.keys(s.recurring.find((x) => x.id === linked.recurringId).paid).find((m) => s.recurring.find((x) => x.id === linked.recurringId).paid[m] === linked.id);
  r0.paid[month] = "another";
  const r = restoreFromBin(a.state, a.entry.id);
  assert.match(r.warnings[0], /check for a duplicate/);
  assert.equal(r.state.recurring.find((x) => x.id === linked.recurringId).paid[month], "another");
});

test("bin housekeeping", () => {
  const s = migrated("v1-sample");
  const a = moveToBin(s, "advance", "a0", { now });
  const b = moveToBin(a.state, "advance", "a1", { now });
  assert.equal(b.state.bin.length, 2);
  assert.equal(b.state.bin[0].id, b.entry.id, "newest first");
  assert.equal(purgeFromBin(b.state, a.entry.id).bin.length, 1);
  assert.equal(emptyBin(b.state).bin.length, 0);
  assert.equal(restoreFromBin(b.state, "nope").ok, false);
  assert.throws(() => moveToBin(s, "advance", "does-not-exist", { now }));
});

test("outstanding updates when a credit entry is deleted", () => {
  const s = richState();
  const before = outstanding(s, "payable", "sup1");
  const { state } = moveToBin(s, "transaction", "credit-exp", { now });
  assert.equal(outstanding(state, "payable", "sup1"), before - 590);
});
