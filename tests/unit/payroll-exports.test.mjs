import { test } from "node:test";
import assert from "node:assert/strict";
import { payoutRows, payrollRows, salarySheetRows, staffFromCSV, staffTemplateRows, whatsappSummary } from "../../js/core/payroll.js";
import { parseCSV, toCSV } from "../../js/core/csv.js";
import { formatMoney } from "../../js/core/money.js";
import { readFileSync } from "node:fs";
import { migrated } from "./helpers.mjs";

let n = 0;
const makeId = () => `new-${++n}`;

test("staff import accepts the old and new column names", () => {
  const { people, skipped } = staffFromCSV(parseCSV("Guard,Site,Monthly Salary,Bank Name,Account No,IFSC,UPI ID,Mobile\nAnil,Gate 1,\"₹15,000\",SBI,123,sbin0001234,a@upi,98000\n,,,,,,,\nNo Salary,,,,,,,\n"), makeId);
  assert.equal(skipped, 0);
  assert.equal(people.length, 2);
  assert.equal(people[0].name, "Anil");
  assert.equal(people[0].team, "Gate 1");
  assert.equal(people[0].salary, 15000);
  assert.equal(people[0].bank, "SBI");
  assert.equal(people[0].account, "123");
  assert.equal(people[0].ifsc, "SBIN0001234");
  assert.equal(people[0].upi, "a@upi");
  assert.equal(people[0].phone, "98000");
  assert.equal(people[0].active, true);
  assert.equal(people[1].salary, 0);
});

test("staff import counts rows it can't use", () => {
  const { people, skipped } = staffFromCSV(parseCSV("Name,Team\nAnil,A\n,B\n"), makeId);
  assert.equal(people.length, 1);
  assert.equal(skipped, 1);
});

test("the sample staff file and the template both import cleanly", () => {
  const file = readFileSync(new URL("../../sample/staff.csv", import.meta.url), "utf8");
  assert.equal(staffFromCSV(parseCSV(file), makeId).people.length, 4);
  assert.equal(staffFromCSV(parseCSV(toCSV(staffTemplateRows())), makeId).people[0].name, "Rajesh K");
});

test("the salary sheet export has a row per person and totals that add up", () => {
  const s = migrated("v1-sample");
  const rows = salarySheetRows(payrollRows(s, "2026-10"));
  assert.equal(rows.length, 10);
  const head = rows[0];
  const total = rows.at(-1);
  assert.equal(total[0], "TOTAL");
  assert.equal(total[head.indexOf("Gross")], 104871);
  assert.equal(total[head.indexOf("Net pay")], 71771);
  assert.equal(rows.find((r) => r[0] === "Suresh P")[head.indexOf("Paid on")], "2026-11-02");
});

test("the payout list only includes people still waiting to be paid", () => {
  const s = migrated("v1-sample");
  const rows = payoutRows(payrollRows(s, "2026-10"), "Salary October 2026");
  const names = rows.slice(1).map((r) => r[0]);
  assert.ok(!names.includes("Suresh P"), "already paid");
  assert.ok(!names.includes("Sreeja R"), "already paid");
  const amount = rows.slice(1).reduce((t, r) => t + r[2], 0);
  assert.equal(amount, 49771);
  assert.equal(rows[1].at(-1), "Salary October 2026");
  s.entries["2026-10"].g0.hold = true;
  assert.ok(!payoutRows(payrollRows(s, "2026-10"), "x").some((r) => r[0] === "Rajesh K"), "people on hold are left out");
});

test("the WhatsApp summary reads the way people expect", () => {
  const s = migrated("v1-sample");
  const text = whatsappSummary(payrollRows(s, "2026-10"), { business: "Sample Traders", monthName: "October 2026", money: (n) => formatMoney(n, "INR", { decimals: 0 }) });
  assert.ok(text.startsWith("*Sample Traders — October 2026*"));
  assert.ok(text.includes("Rajesh K (Main shop): 31 days"));
  assert.ok(text.endsWith("Total net: *₹71,771* for 8 staff"));
});
