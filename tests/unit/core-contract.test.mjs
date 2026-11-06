// The original 14 tests, ported to the new modules with the same expected numbers.
// Only imports and renamed fields differ from tests/unit/calc.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysInMonth } from "../../js/core/dates.js";
import { inr, inWords } from "../../js/core/money.js";
import { computePay, totals } from "../../js/core/payroll.js";
import { parseCSV, toCSV } from "../../js/core/csv.js";
import { docTotals } from "../../js/core/documents.js";
import { accountBalances } from "../../js/core/ledger.js";
import { nextDue } from "../../js/core/recurring.js";
import { profitLoss } from "../../js/core/reports.js";
import { blank } from "../../js/core/schema.js";

const base = { month: "2026-10", basis: "calendar", capAtFull: false, pf: false, esi: false };

test("days in month", () => {
  assert.equal(daysInMonth("2026-10"), 31);
  assert.equal(daysInMonth("2026-09"), 30);
  assert.equal(daysInMonth("2028-02"), 29);
});

test("calendar basis: 30 days in a 31-day month", () => {
  const r = computePay({ salary: 14000 }, { daysWorked: 30, advance: 3000 }, base);
  assert.equal(r.base, 13548);
  assert.equal(r.net, 10548);
});

test("fixed 30-day basis pays full salary for 30 days", () => {
  const r = computePay({ salary: 14000 }, { daysWorked: 30 }, { ...base, basis: "30" });
  assert.equal(r.base, 14000);
});

test("cap at full salary", () => {
  const r = computePay({ salary: 15500 }, { daysWorked: 31 }, { ...base, basis: "30", capAtFull: true });
  assert.equal(r.base, 15500);
});

test("extra shifts, food and kit", () => {
  const r = computePay({ salary: 20000 }, { daysWorked: 17, extraShifts: 2, extraRate: 800, foodDays: 17, foodRate: 140, kit: 1000 }, { ...base, month: "2026-06" });
  assert.equal(r.base, 11333);
  assert.equal(r.extra, 1600);
  assert.equal(r.food, 2380);
  assert.equal(r.net, 11333 + 1600 - 2380 - 1000);
});

test("PF and ESI", () => {
  const r = computePay({ salary: 18000 }, { daysWorked: 30 }, { ...base, basis: "30", pf: true, esi: true });
  assert.equal(r.pf, 1800); // 12% of 15000 ceiling
  assert.equal(r.esi, 135); // 0.75% of 18000
  const high = computePay({ salary: 25000 }, { daysWorked: 30 }, { ...base, basis: "30", esi: true });
  assert.equal(high.esi, 0);
});

test("negative net is flagged", () => {
  const r = computePay({ salary: 10000 }, { daysWorked: 2, advance: 3000 }, base);
  assert.ok(r.net < 0);
  assert.ok(r.owesBusiness);
});

test("totals", () => {
  const a = computePay({ salary: 14000 }, { daysWorked: 30 }, base);
  const b = computePay({ salary: 13000 }, { daysWorked: 27, advance: 4000 }, base);
  assert.equal(totals([a, b]).net, a.net + b.net);
});

test("money formatting and words", () => {
  assert.equal(inr(123456), "₹1,23,456");
  assert.equal(inr(950), "₹950");
  assert.equal(inr(-3236), "-₹3,236");
  assert.equal(inWords(13548), "Thirteen Thousand Five Hundred Forty Eight");
  assert.equal(inWords(382287), "Three Lakh Eighty Two Thousand Two Hundred Eighty Seven");
});

test("CSV round trip", () => {
  const csv = toCSV([["Name", "Site", "Salary"], ["Anil Kumar", "Matha School", 14000], ['He said "hi"', "A, B", 1]]);
  const rows = parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Anil Kumar");
  assert.equal(rows[1].site, "A, B");
  assert.equal(rows[1].name, 'He said "hi"');
});

test("cash book summary for a month", () => {
  const s = blank("2026-11-07");
  const entry = (date, type, category, amount) => ({ id: `${date}${category}`, date, type, category, amount, mode: "cash", accountId: "cash", payments: [] });
  s.transactions = [entry("2026-10-03", "income", "Sales", 50000), entry("2026-10-05", "expense", "Rent", 20000), entry("2026-10-20", "expense", "Rent", 500), entry("2026-11-01", "income", "Sales", 999)];
  const p = profitLoss(s, { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(p.revenue.total, 50000);
  assert.equal(p.expenses.total, 20500);
  assert.equal(p.netProfit, 29500);
  assert.equal(p.expenses.lines.find((l) => l.label === "Rent").amount, 20500);
});

test("invoice totals with GST, TDS and part payment", () => {
  const t = docTotals({ lines: [{ qty: 1, rate: 48000, gstRate: 18 }], payments: [{ amount: 56160, tds: 480 }] });
  assert.equal(t.total, 56640); assert.equal(t.balance, 0); assert.equal(t.status, "paid");
  const p = docTotals({ lines: [{ qty: 2, rate: 1000, gstRate: 0 }], payments: [{ amount: 500 }] });
  assert.equal(p.balance, 1500); assert.equal(p.status, "partial");
  assert.equal(docTotals({ lines: [], payments: [] }).status, "unpaid");
  assert.ok(docTotals({ lines: [{ qty: 93, rate: 516.13, gstRate: 18 }], payments: [{ amount: 56160, tds: 480 }] }).subtotal > 47999);
});

test("bank balances", () => {
  const s = blank("2026-11-07");
  s.accounts = [{ id: "a", opening: 1000 }, { id: "b", opening: 0 }];
  const pay = (accountId) => ({ mode: "bank", accountId });
  s.transactions = [
    { id: "t1", type: "income", amount: 500, ...pay("a") }, { id: "t2", type: "expense", amount: 200, ...pay("a") },
    { id: "t3", type: "expense", amount: 99, mode: "cash", accountId: null, untracked: true },
  ];
  s.invoices = [{ id: "i1", no: "1", lines: [], payments: [{ id: "p1", amount: 3000, ...pay("b") }] }];
  s.salaryPayments = [{ id: "sp1", amount: 1500, ...pay("b") }];
  s.advances = [{ id: "ad1", amount: 300, ...pay("a") }];
  s.transfers = [{ id: "tr1", from: "a", to: "b", amount: 400 }];
  s.loans = [{ id: "l1", name: "L", payments: [{ id: "lp1", amount: 100, ...pay("b") }] }];
  const b = accountBalances(s);
  assert.equal(b.a, 1000 + 500 - 200 - 300 - 400);
  assert.equal(b.b, 3000 - 1500 + 400 - 100);
});

test("next due date", () => {
  assert.equal(nextDue(5, "2026-11-04"), "2026-11-05");
  assert.equal(nextDue(5, "2026-11-06"), "2026-12-05");
  assert.equal(nextDue(31, "2026-02-10"), "2026-02-28");
});
