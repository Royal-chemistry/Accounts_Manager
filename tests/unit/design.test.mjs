// The logic behind the new design: artwork, the Up Next queue, the Today headline and search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { artTone, initials } from "../../js/core/artwork.js";
import { formatMoney } from "../../js/core/money.js";
import { todayStory, upNext } from "../../js/core/reports.js";
import { sample } from "../../js/core/sample.js";
import { blank } from "../../js/core/schema.js";
import { searchAll } from "../../js/core/search.js";

const TODAY = "2026-11-07";
const money = (n) => formatMoney(n, "INR", { decimals: 0 });
const bill = (id, due, rate = 100) => ({ id, supplierId: "s1", billNo: id, date: "2026-01-01", due, lines: [{ desc: "x", qty: 1, rate, gstRate: 0 }], payments: [] });
const invoice = (id, due, rate = 100) => ({ id, clientId: "c1", no: id, date: "2026-01-01", due, lines: [{ desc: "x", qty: 1, rate, gstRate: 0 }], payments: [] });

test("artwork: the same name always gets the same colour, in range", () => {
  for (const name of ["Harbour View Hotel", "St. Mary's School", "", null, "ആനന്ദ്"]) {
    const tone = artTone(name);
    assert.equal(tone, artTone(name));
    assert.ok(Number.isInteger(tone) && tone >= 1 && tone <= 8);
  }
  assert.equal(artTone("  Harbour  ".trim()), artTone("harbour"));
});

test("artwork: different names spread across the colours", () => {
  const names = ["Harbour View Hotel", "St. Mary's School", "Coastal Chemicals", "Bengaluru Retail", "Malabar Packaging", "Deccan Paper Mills", "City Cleaning", "Rajesh K", "Suresh P", "Anitha M", "Biju Thomas", "Manoj V", "Sreeja R", "Vinod Kumar", "Joseph Mathew", "Packing tape"];
  assert.ok(new Set(names.map(artTone)).size >= 5);
});

test("artwork: initials skip company words, and cope with odd names", () => {
  assert.equal(initials("Coastal Chemicals Pvt Ltd"), "CC");
  assert.equal(initials("The Harbour Hotel"), "HH");
  assert.equal(initials("Rajesh"), "R");
  assert.equal(initials("St. Mary's School"), "SM");
  assert.equal(initials("ltd"), "L");
  assert.equal(initials("ആനന്ദ് കുമാർ"), "ആക");
  assert.equal(initials(""), "");
  assert.equal(initials(null), "");
});

test("up next: most overdue first, only what's late or due within a week", () => {
  const s = blank(TODAY);
  s.suppliers = [{ id: "s1", name: "Supplier" }];
  s.clients = [{ id: "c1", name: "Client" }];
  s.purchases = [bill("week", "2026-11-14"), bill("later", "2026-11-15"), bill("none", ""), bill("late", "2026-11-01")];
  s.invoices = [invoice("today", TODAY), invoice("latest", "2026-10-01")];
  const items = upNext(s, TODAY);
  assert.deepEqual(items.map((i) => i.id), ["latest", "late", "today", "week"]);
  assert.deepEqual(items.map((i) => i.days), [-37, -6, 0, 7]);
  assert.deepEqual(items.map((i) => i.direction), ["in", "out", "in", "out"]);
  assert.equal(items[0].name, "Client");
  assert.equal(items[0].detail, "Invoice latest");
});

test("up next: a paid document leaves the queue, and part payments show what's left", () => {
  const s = blank(TODAY);
  s.clients = [{ id: "c1", name: "Client" }];
  const paid = invoice("paid", "2026-11-01");
  paid.payments = [{ id: "p1", date: "2026-11-02", amount: 100 }];
  const part = invoice("part", "2026-11-01", 500);
  part.payments = [{ id: "p2", date: "2026-11-02", amount: 200 }];
  s.invoices = [paid, part];
  const items = upNext(s, TODAY);
  assert.deepEqual(items.map((i) => [i.id, i.amount]), [["part", 300]]);
});

test("up next: recurring payments and credit entries join the queue", () => {
  const items = upNext(sample(TODAY), TODAY);
  assert.ok(items.length > 0);
  assert.ok(items.some((i) => i.kind === "recurring"));
  assert.ok(items.some((i) => i.kind === "transaction"));
  for (const i of items) {
    assert.ok(i.name, `${i.key} has a name`);
    assert.ok(i.days <= 7);
  }
  const sorted = [...items].sort((a, b) => a.due.localeCompare(b.due));
  assert.deepEqual(items.map((i) => i.due), sorted.map((i) => i.due));
});

test("up next: an empty business has nothing queued", () => {
  assert.deepEqual(upNext(blank(TODAY), TODAY), []);
});

test("today's headline says what matters most", () => {
  const item = (days, direction, amount, name = "Asha") => ({ days, direction, amount, name });
  const both = todayStory([item(-2, "in", 1000), item(-1, "out", 500)], money);
  assert.equal(both.title, "2 things are late");
  assert.equal(both.detail, `${money(1000)} to collect and ${money(500)} to pay.`);
  assert.equal(both.tone, 3);

  assert.equal(todayStory([item(-2, "in", 1000)], money).title, `${money(1000)} is late coming in`);
  assert.match(todayStory([item(-2, "in", 1000)], money).detail, /^1 payment is overdue, starting with Asha/);
  assert.match(todayStory([item(-2, "in", 1), item(-1, "in", 1)], money).detail, /^2 payments are overdue/);
  assert.equal(todayStory([item(-2, "out", 500)], money).title, `${money(500)} is late going out`);

  const soon = todayStory([item(3, "out", 500)], money);
  assert.equal(soon.title, "1 thing is due this week");
  assert.equal(soon.tone, 8);
  assert.equal(todayStory([item(3, "out", 1), item(4, "in", 1)], money).title, "2 things are due this week");

  const clear = todayStory([], money);
  assert.equal(clear.title, "You're all caught up");
  assert.equal(clear.tone, 4);
});

test("search: every word has to match, in any order, ignoring case", () => {
  const s = sample(TODAY);
  const clients = (q) => searchAll(s, q).find((g) => g.title === "Clients")?.results.map((r) => r.name) ?? [];
  assert.deepEqual(clients("harbour"), ["Harbour View Hotel"]);
  assert.deepEqual(clients("HOTEL view"), ["Harbour View Hotel"]);
  assert.deepEqual(clients("harbour school"), []);
});

test("search: finds each kind of record, and links to it", () => {
  const s = sample(TODAY);
  const groupsFor = (q) => searchAll(s, q).map((g) => g.title);
  assert.ok(groupsFor("ST-001").includes("Invoices"));
  assert.ok(groupsFor("Deccan").includes("Suppliers"));
  assert.ok(groupsFor("Rajesh").includes("Staff"));
  assert.ok(groupsFor("BOX-M").includes("Stock"));
  const [invoices] = searchAll(s, "ST-001");
  assert.match(invoices.results[0].href, /^invoices\//);
});

test("search: leaves out switched-off modules, and handles nothing to search for", () => {
  const s = sample(TODAY);
  s.settings.modules = { ...s.settings.modules, stock: false, payroll: false };
  assert.ok(!searchAll(s, "BOX-M").some((g) => g.title === "Stock"));
  assert.ok(!searchAll(s, "Rajesh").some((g) => g.title === "Staff"));
  assert.deepEqual(searchAll(s, ""), []);
  assert.deepEqual(searchAll(s, "   "), []);
  assert.deepEqual(searchAll(s, "nothing matches this"), []);
});

test("search: long lists are cut short and say how many more there are", () => {
  const s = blank(TODAY);
  s.clients = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}` }));
  const [group] = searchAll(s, "client");
  assert.equal(group.results.length, 6);
  assert.equal(group.more, 3);
});
