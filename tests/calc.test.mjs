import { test } from "node:test";
import assert from "node:assert/strict";
import { daysInMonth, computePay, totals, inr, inWords, parseCSV, toCSV } from "../js/calc.js";

const base = { month: "2026-10", basis: "calendar", capAtFull: false, pf: false, esi: false };

test("days in month", () => {
  assert.equal(daysInMonth("2026-10"), 31);
  assert.equal(daysInMonth("2026-09"), 30);
  assert.equal(daysInMonth("2028-02"), 29);
});

test("calendar basis: 30 duties in a 31-day month", () => {
  const r = computePay({ salary: 14000 }, { duties: 30, advance: 3000 }, base);
  assert.equal(r.base, 13548);
  assert.equal(r.net, 10548);
});

test("fixed 30-day basis pays full salary for 30 duties", () => {
  const r = computePay({ salary: 14000 }, { duties: 30 }, { ...base, basis: "30" });
  assert.equal(r.base, 14000);
});

test("cap at full salary", () => {
  const r = computePay({ salary: 15500 }, { duties: 31 }, { ...base, basis: "30", capAtFull: true });
  assert.equal(r.base, 15500);
});

test("special duty, mess and uniform", () => {
  const r = computePay({ salary: 20000 }, { duties: 17, specialDuties: 2, specialRate: 800, messDays: 17, messRate: 140, uniform: 1000 },
    { ...base, month: "2026-06" });
  assert.equal(r.base, 11333);
  assert.equal(r.special, 1600);
  assert.equal(r.mess, 2380);
  assert.equal(r.net, 11333 + 1600 - 2380 - 1000);
});

test("PF and ESI", () => {
  const r = computePay({ salary: 18000 }, { duties: 30 }, { ...base, basis: "30", pf: true, esi: true });
  assert.equal(r.pf, 1800); // 12% of 15000 ceiling
  assert.equal(r.esi, 135); // 0.75% of 18000
  const high = computePay({ salary: 25000 }, { duties: 30 }, { ...base, basis: "30", esi: true });
  assert.equal(high.esi, 0);
});

test("negative net is flagged", () => {
  const r = computePay({ salary: 10000 }, { duties: 2, advance: 3000 }, base);
  assert.ok(r.net < 0);
  assert.ok(r.owesAgency);
});

test("totals", () => {
  const a = computePay({ salary: 14000 }, { duties: 30 }, base);
  const b = computePay({ salary: 13000 }, { duties: 27, advance: 4000 }, base);
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

import { cashSummary } from "../js/calc.js";
test("cash book summary for a month", () => {
  const s = cashSummary([
    { date: "2026-10-03", type: "income", category: "Sales", amount: 50000 },
    { date: "2026-10-05", type: "expense", category: "Rent", amount: 20000 },
    { date: "2026-10-20", type: "expense", category: "Rent", amount: 500 },
    { date: "2026-11-01", type: "income", category: "Sales", amount: 999 },
  ], "2026-10");
  assert.equal(s.count, 3);
  assert.equal(s.income, 50000);
  assert.equal(s.expense, 20500);
  assert.equal(s.net, 29500);
  assert.equal(s.byCategory.Rent.expense, 20500);
});
