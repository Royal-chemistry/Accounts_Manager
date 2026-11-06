import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, formatMoney, round2, sumMoney } from "../../js/core/money.js";
import { addMonths, dayInMonth, daysBetween, formatDate, fyRange, localToday, monthEnd, monthLabel, monthsBetween, periodPresets } from "../../js/core/dates.js";
import { parseCSV, toCSV } from "../../js/core/csv.js";
import { attendanceSummary, computePay, effectiveDays, fullMonthDays, payFor, payrollRows, staffCost } from "../../js/core/payroll.js";
import { allocatePayment, addPayment, docTotals, gstSplit, lineTaxable, openDocs, outstanding, settle, stateFromGstin, txBalance } from "../../js/core/documents.js";
import { accountBalances, accountInUse, loanOutstanding, postings, statement, suggestedInterest } from "../../js/core/ledger.js";
import { lowStock, onHand, stockCosts, stockLedger, valuation } from "../../js/core/stock.js";
import { cycleStatus, dueMonths, monthlyEquivalent, upcoming } from "../../js/core/recurring.js";
import { amountError, emailError, gstinCheckChar, gstinError, ifscError, phoneError, required, uniqueError } from "../../js/core/validate.js";
import { BUSINESS_TYPES, mergeCategories, presetFor } from "../../js/core/presets.js";
import { blank, normalize } from "../../js/core/schema.js";
import { isSafeId, uid } from "../../js/core/ids.js";
import { migrated, richState, TODAY } from "./helpers.mjs";

test("money: formatting in rupees and other currencies", () => {
  assert.equal(formatMoney(1234567.5), "₹12,34,567.50");
  assert.equal(formatMoney(100000), "₹1,00,000");
  assert.equal(formatMoney(-0.5), "-₹0.50");
  assert.equal(formatMoney(-1234.05), "-₹1,234.05");
  assert.equal(formatMoney(1500, "INR", { decimals: 2 }), "₹1,500.00");
  assert.equal(formatMoney(1500.75, "INR", { decimals: 0 }), "₹1,501");
  assert.equal(formatMoney(1234.5, "USD"), "$1,234.50");
  assert.equal(formatMoney(1000, "USD"), "$1,000");
  assert.equal(formatMoney("not a number"), "₹0");
});

test("money: adding removes floating point noise", () => {
  assert.equal(sumMoney([0.1, 0.2]), 0.3);
  assert.equal(sumMoney(Array(1000).fill(0.07)), 70);
  assert.equal(round2(1.234), 1.23);
});

test("money: amounts in words", () => {
  assert.equal(amountInWords(1050.5), "Rupees One Thousand Fifty and Fifty Paise only");
  assert.equal(amountInWords(120000), "Rupees One Lakh Twenty Thousand only");
  assert.equal(amountInWords(1234567, "USD"), "US Dollars One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven only");
  assert.equal(amountInWords(-5), "Minus Rupees Five only");
  assert.equal(amountInWords(0), "Rupees Zero only");
});

test("dates: today uses the local clock, so just after midnight in India isn't yesterday", () => {
  // 00:30 on 7 Nov in India is still 6 Nov in UTC. getters read local time, which this fake clock pins down.
  const justAfterMidnight = { getFullYear: () => 2026, getMonth: () => 10, getDate: () => 7, toISOString: () => "2026-11-06T19:00:00.000Z" };
  assert.equal(localToday(justAfterMidnight), "2026-11-07");
});

test("dates: month arithmetic and month ends", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-03", -15), "2024-12");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.equal(dayInMonth("2026-02", 31), "2026-02-28");
  assert.deepEqual(monthsBetween("2026-11-15", "2027-01-02"), ["2026-11", "2026-12", "2027-01"]);
  assert.equal(daysBetween("2026-02-28", "2026-03-02"), 2);
  assert.equal(daysBetween("2026-03-02", "2026-02-28"), -2);
});

test("dates: labels", () => {
  assert.equal(formatDate("2026-11-07"), "07 Nov 2026");
  assert.equal(formatDate(""), "—");
  assert.equal(formatDate(undefined), "—");
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(monthLabel("2026-10", { short: true }), "Oct 26");
});

test("dates: financial year boundaries", () => {
  assert.deepEqual(fyRange("2026-04-01", 4), { from: "2026-04-01", to: "2027-03-31", label: "FY 2026-27" });
  assert.deepEqual(fyRange("2026-03-31", 4), { from: "2025-04-01", to: "2026-03-31", label: "FY 2025-26" });
  assert.deepEqual(fyRange("2026-06-15", 1), { from: "2026-01-01", to: "2026-12-31", label: "FY 2026" });
  assert.deepEqual(fyRange("2028-03-15", 3).to, "2029-02-28");
});

test("dates: period presets follow the financial year", () => {
  const p = Object.fromEntries(periodPresets("2026-11-07", 4).map((x) => [x.id, x]));
  assert.deepEqual([p["this-month"].from, p["this-month"].to], ["2026-11-01", "2026-11-30"]);
  assert.deepEqual([p["last-month"].from, p["last-month"].to], ["2026-10-01", "2026-10-31"]);
  assert.deepEqual([p["this-quarter"].from, p["this-quarter"].to], ["2026-10-01", "2026-12-31"]);
  assert.deepEqual([p["last-quarter"].from, p["last-quarter"].to], ["2026-07-01", "2026-09-30"]);
  assert.deepEqual([p["this-fy"].from, p["this-fy"].to], ["2026-04-01", "2027-03-31"]);
  assert.deepEqual([p["last-fy"].from, p["last-fy"].to], ["2025-04-01", "2026-03-31"]);
  const jan = Object.fromEntries(periodPresets("2027-01-05", 4).map((x) => [x.id, x]));
  assert.equal(jan["last-month"].from, "2026-12-01");
  assert.equal(jan["this-quarter"].from, "2027-01-01");
});

test("csv: text that would run as a formula is neutralised, numbers aren't", () => {
  assert.equal(toCSV([["=SUM(A1)", "+91 98000", "@cmd", "-2+3", "Rent"]]), "'=SUM(A1),'+91 98000,'@cmd,'-2+3,Rent");
  assert.equal(toCSV([[-500, "-500", "-1,234.50", 0]]), '-500,-500,"-1,234.50",0');
  assert.equal(toCSV([["a\rb"]]), '"a\rb"');
});

test("csv: reads a file saved with a byte order mark", () => {
  const rows = parseCSV("﻿Name,Salary\r\nAnil,100\r\n");
  assert.deepEqual(rows, [{ name: "Anil", salary: "100" }]);
  assert.deepEqual(parseCSV(""), []);
});

test("payroll: attendance turns into days", () => {
  const marks = { "01": "P", "02": "P", "03": "H", "04": "L", "05": "A" };
  assert.deepEqual(attendanceSummary(marks), { P: 2, H: 1, L: 1, A: 1, marked: 5, days: 2.5 });
  assert.equal(attendanceSummary(marks, { paidLeave: true }).days, 3.5);
});

test("payroll: a typed figure wins over attendance, and zero counts as typed", () => {
  const marks = { "01": "P", "02": "P" };
  assert.deepEqual(effectiveDays({ daysWorked: 20 }, marks), { days: 20, source: "manual" });
  assert.deepEqual(effectiveDays({ daysWorked: 0 }, marks), { days: 0, source: "manual" });
  assert.deepEqual(effectiveDays({ daysWorked: "" }, marks), { days: 2, source: "attendance" });
  assert.deepEqual(effectiveDays({}, undefined), { days: 0, source: "none" });
});

test("payroll: full month depends on the pay basis", () => {
  assert.equal(fullMonthDays("calendar", "2026-02"), 28);
  assert.equal(fullMonthDays("26", "2026-02"), 26);
  assert.throws(() => computePay({ salary: 1 }, {}, { month: "2026-01", basis: "nonsense" }));
});

test("payroll: logged advances and attendance feed into pay", () => {
  const s = blank(TODAY);
  s.staff = [{ id: "a", name: "A", salary: 3000, active: true }];
  s.attendance["2026-11"] = { a: { "01": "P", "02": "H" } };
  s.advances = [{ id: "x", staffId: "a", date: "2026-11-05", amount: 20 }, { id: "y", staffId: "a", date: "2026-10-05", amount: 999 }];
  const p = payFor(s, s.staff[0], "2026-11");
  assert.equal(p.days, 1.5);
  assert.equal(p.daysSource, "attendance");
  assert.equal(p.base, 150);
  assert.equal(p.advance, 20);
  assert.equal(p.net, 130);
});

test("payroll: staff cost is gross less recoveries, not less PF or ESI", () => {
  const p = computePay({ salary: 18000 }, { daysWorked: 30, foodDays: 10, foodRate: 10, kit: 50, other: 25, advance: 1000 }, { month: "2026-09", basis: "30", pf: true, esi: true });
  assert.equal(staffCost(p), 18000 - 100 - 50 - 25);
});

test("payroll: rows show status, and inactive staff only when they have figures", () => {
  const s = blank(TODAY);
  s.staff = [
    { id: "paid", name: "Paid", salary: 3000, active: true }, { id: "unpaid", name: "Unpaid", salary: 3000, active: true },
    { id: "hold", name: "Hold", salary: 3000, active: true }, { id: "owes", name: "Owes", salary: 300, active: true },
    { id: "gone", name: "Gone", salary: 3000, active: false }, { id: "left", name: "Left", salary: 3000, active: false },
  ];
  const e = (daysWorked, extra = {}) => ({ daysWorked, ...extra });
  s.entries["2026-11"] = { paid: e(30), unpaid: e(30), hold: e(30, { hold: true }), owes: e(1, { advance: 500 }), gone: e(5) };
  s.salaryPayments = [{ id: "1", staffId: "paid", month: "2026-11", date: "2026-12-01", amount: 3000 }];
  const rows = Object.fromEntries(payrollRows(s, "2026-11").map((r) => [r.staff.id, r.status]));
  assert.deepEqual(rows, { paid: "paid", unpaid: "unpaid", hold: "hold", owes: "none", gone: "unpaid" });
});

test("documents: mixed GST rates are worked out per rate", () => {
  const t = docTotals({ lines: [{ qty: 2, rate: 100, gstRate: 5 }, { qty: 1, rate: 1000, gstRate: 18 }, { qty: 1, rate: 50, gstRate: 0 }] });
  assert.equal(t.subtotal, 1250);
  assert.equal(t.gst, 190);
  assert.equal(t.total, 1440);
  assert.deepEqual(t.gstByRate, [{ rate: 0, taxable: 50, gst: 0 }, { rate: 5, taxable: 200, gst: 10 }, { rate: 18, taxable: 1000, gst: 180 }]);
});

test("documents: entering a total extracts the tax", () => {
  const t = docTotals({ taxInclusive: true, lines: [{ qty: 1, rate: 1180, gstRate: 18 }] });
  assert.equal(t.subtotal, 1000);
  assert.equal(t.gst, 180);
  assert.equal(t.total, 1180);
  assert.equal(lineTaxable({ qty: 1, rate: 1180, gstRate: 18 }, true), 1000);
});

test("documents: rounding stays exact across many lines", () => {
  const lines = Array.from({ length: 50 }, () => ({ qty: 3, rate: 33.33, gstRate: 18 }));
  const t = docTotals({ lines });
  assert.equal(t.subtotal, 4999.5);
  assert.equal(t.gst, 899.91);
  assert.equal(t.total, 5899.41);
});

test("documents: overpayment shows as overpaid, never a negative balance", () => {
  const t = docTotals({ lines: [{ qty: 1, rate: 100, gstRate: 0 }], payments: [{ amount: 150 }] });
  assert.equal(t.balance, 0);
  assert.equal(t.overpaid, 50);
  assert.equal(t.status, "paid");
});

test("documents: paid within fifty paise counts as paid, as it did in v1", () => {
  assert.equal(docTotals({ lines: [{ qty: 1, rate: 100, gstRate: 18 }], payments: [{ amount: 117.6 }] }).status, "paid");
});

test("documents: GST split", () => {
  assert.deepEqual(gstSplit(180, "32", "32"), { cgst: 90, sgst: 90, igst: 0 });
  assert.deepEqual(gstSplit(180, "32", "27"), { cgst: 0, sgst: 0, igst: 180 });
  assert.deepEqual(gstSplit(180, "", "27"), { cgst: 90, sgst: 90, igst: 0 });
  assert.deepEqual(gstSplit(180, "32", ""), { cgst: 90, sgst: 90, igst: 0 });
  assert.deepEqual(gstSplit(0.05, "32", "32"), { cgst: 0.03, sgst: 0.02, igst: 0 });
  assert.equal(stateFromGstin("32AAACH0000A1Z1"), "32");
  assert.equal(stateFromGstin(""), "");
  assert.equal(stateFromGstin("XX"), "");
});

test("documents: open documents are listed oldest due first and tie to outstanding", () => {
  const s = richState();
  const payable = openDocs(s, "payable");
  assert.deepEqual(payable.map((d) => d.id), ["bill2", "bill1", "credit-exp"]);
  assert.equal(payable.find((d) => d.id === "bill1").balance, 708 - 200);
  assert.equal(outstanding(s, "payable"), 1000 + 508 + 590);
  assert.equal(outstanding(s, "payable", "sup1"), 508 + 590);
  assert.equal(outstanding(s, "receivable"), 170150 + 531);
});

test("documents: open documents can be read as of a past date", () => {
  const s = richState();
  const before = openDocs(s, "payable", { asOf: "2026-10-05" });
  assert.deepEqual(before.map((d) => [d.id, d.balance]), [["bill1", 708]]);
});

test("documents: allocating a payment goes oldest first and never exceeds a balance", () => {
  const docs = [{ docType: "purchase", id: "a", balance: 100 }, { docType: "purchase", id: "b", balance: 50 }, { docType: "invoice", id: "c", balance: 200 }];
  assert.deepEqual(allocatePayment(docs, 120), { allocations: [{ docType: "purchase", id: "a", amount: 100 }, { docType: "purchase", id: "b", amount: 20 }], unallocated: 0 });
  assert.deepEqual(allocatePayment(docs, 500).unallocated, 150);
  assert.deepEqual(allocatePayment(docs, 0).allocations, []);
});

test("documents: settling records one payment per document, linked together, and moves the bank balance", () => {
  const s = richState();
  const bankBefore = accountBalances(s).b1;
  const { allocations } = allocatePayment(openDocs(s, "payable", { partyId: "sup1" }), 700);
  const id = settle(s, { side: "payable", partyId: "sup1", date: "2026-11-01", mode: "bank", accountId: "b1", allocations });
  assert.ok(id);
  assert.equal(accountBalances(s).b1, bankBefore - 700);
  assert.equal(outstanding(s, "payable", "sup1"), 508 + 590 - 700);
  const payments = [...s.purchases.flatMap((d) => d.payments), ...s.transactions.flatMap((d) => d.payments)].filter((p) => p.settlementId === id);
  assert.equal(payments.length, 2);
});

test("documents: settling more than is owed is refused and changes nothing", () => {
  const s = richState();
  const before = JSON.stringify(s);
  assert.throws(() => settle(s, { side: "payable", partyId: "sup1", date: "2026-11-01", mode: "cash", allocations: [{ docType: "purchase", id: "bill1", amount: 99999 }] }));
  assert.equal(JSON.stringify(s), before);
});

test("documents: only credit entries can owe anything", () => {
  assert.equal(txBalance({ mode: "cash", amount: 100 }), 0);
  assert.equal(txBalance({ mode: "credit", amount: 100, payments: [{ amount: 40 }] }), 60);
  const s = richState();
  addPayment(s, "transaction", "credit-exp", { date: "2026-11-01", amount: 590, mode: "cash", accountId: "b3" });
  assert.equal(txBalance(s.transactions.find((t) => t.id === "credit-exp")), 0);
});

test("ledger: every account equals its opening balance plus its postings", () => {
  const s = richState();
  const balances = accountBalances(s);
  const posts = postings(s);
  for (const a of s.accounts) {
    const sum = posts.filter((p) => p.accountId === a.id && !p.untracked).reduce((t, p) => t + p.amount, 0);
    assert.equal(balances[a.id], round2(a.opening + sum), a.name);
  }
});

test("ledger: untracked entries never change a balance", () => {
  const s = blank(TODAY);
  const before = accountBalances(s).cash;
  s.transactions.push({ id: "old", type: "expense", date: "2026-10-01", amount: 500, mode: "cash", accountId: null, untracked: true, payments: [] });
  assert.equal(accountBalances(s).cash, before);
  s.transactions.push({ id: "new", type: "expense", date: "2026-10-01", amount: 500, mode: "cash", accountId: null, untracked: false, payments: [] });
  assert.equal(accountBalances(s).cash, before - 500);
});

test("ledger: credit entries move no money until they're paid", () => {
  const s = blank(TODAY);
  s.transactions.push({ id: "c", type: "expense", date: "2026-10-01", amount: 500, mode: "credit", accountId: null, payments: [] });
  assert.equal(accountBalances(s).cash, 0);
  assert.equal(postings(s).length, 0);
  addPayment(s, "transaction", "c", { date: "2026-10-05", amount: 200, mode: "cash", accountId: "cash" });
  assert.equal(accountBalances(s).cash, -200);
});

test("ledger: transfers net to zero, and a transfer to an unknown account only moves the known side", () => {
  const s = blank(TODAY);
  s.accounts.push({ id: "b", name: "Bank", kind: "bank", opening: 100 });
  s.transfers = [{ id: "t", date: "2026-10-01", from: "b", to: "cash", amount: 40 }, { id: "u", date: "2026-10-02", from: "b", to: "gone", amount: 10 }];
  assert.deepEqual(accountBalances(s), { cash: 40, b: 50 });
});

test("ledger: balances as of a date, statements, and whether an account is in use", () => {
  const s = richState();
  assert.equal(accountBalances(s, "2000-01-01").b1, 240000);
  const st = statement(s, "b1", { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(st.opening, 240000);
  assert.equal(st.rows.at(-1).balance, st.closing);
  assert.equal(st.closing, accountBalances(s, "2026-10-31").b1);
  assert.equal(accountInUse(s, "b1"), true);
  assert.equal(accountInUse(blank(TODAY), "cash"), false);
});

test("ledger: only the principal of a loan payment reduces what's left", () => {
  const loan = { outstanding: 10000, since: "2026-01-01", rate: 12, payments: [{ date: "2026-02-01", amount: 1000, interest: 100 }, { date: "2025-12-01", amount: 999 }] };
  assert.equal(loanOutstanding(loan), 9100);
  assert.equal(suggestedInterest(loan), 91);
  assert.equal(suggestedInterest({ outstanding: 100 }), 0);
});

test("stock: moving average, cost of sales and write-offs", () => {
  const s = richState();
  const ledger = stockLedger(s);
  const w = ledger.find((r) => r.item.id === "item1");
  // 10 at 100, then 5 at 120 = 15 at 106.67. Sold 3, then 2 damaged.
  assert.equal(w.onHand, 10);
  assert.equal(round2(w.avgCost), 106.67);
  assert.equal(w.value, 1066.67);
  assert.deepEqual(stockCosts(ledger, "2026-10-01", "2026-10-31"), { cogs: 320, writeOffs: 213.33 });
  assert.equal(w.belowReorder, true);
  assert.equal(valuation(ledger), 1066.67);
  assert.deepEqual(lowStock(ledger).map((r) => r.item.id), ["item1"]);
  assert.equal(onHand(s, "item2"), 0);
});

test("stock: a backdated purchase changes the average cost of later sales", () => {
  const s = richState();
  s.purchases.push({ id: "late", billNo: "", supplierId: "sup1", date: "2026-10-01", lines: [{ qty: 10, rate: 200, gstRate: 0, itemId: "item1" }], payments: [] });
  const w = stockLedger(s).find((r) => r.item.id === "item1");
  assert.equal(w.onHand, 20);
  assert.ok(w.avgCost > 106.67);
  assert.equal(w.history[0].sourceId, "late");
});

test("stock: selling below zero is allowed and flagged, and stock isn't valued below zero", () => {
  const s = richState();
  s.invoices.push({ id: "big", no: "X", clientId: "c1", date: "2026-10-25", reducesStock: true, lines: [{ qty: 100, rate: 150, gstRate: 18, itemId: "item1" }], payments: [] });
  const w = stockLedger(s).find((r) => r.item.id === "item1");
  assert.equal(w.onHand, -90);
  assert.equal(w.negative, true);
  assert.equal(w.value, 0);
});

test("stock: a sale before any cost is known uses the purchase price", () => {
  const s = blank(TODAY);
  s.items = [{ id: "n", name: "N", purchasePrice: 40, openingQty: 0, active: true }];
  s.invoices = [{ id: "i", no: "1", clientId: "c", date: "2026-10-01", reducesStock: true, lines: [{ qty: 2, rate: 100, gstRate: 0, itemId: "n" }], payments: [] }];
  assert.equal(stockCosts(stockLedger(s), "2026-10-01", "2026-10-31").cogs, 80);
});

test("stock: editing or deleting a linked invoice corrects stock, and unticking Reduce stock ignores it", () => {
  const s = richState();
  assert.equal(onHand(s, "item1"), 10);
  s.invoices.find((i) => i.id === "inv-stock").lines[0].qty = 1;
  assert.equal(onHand(s, "item1"), 12);
  s.invoices.find((i) => i.id === "inv-stock").reducesStock = false;
  assert.equal(onHand(s, "item1"), 13);
  s.invoices = s.invoices.filter((i) => i.id !== "inv-stock");
  assert.equal(onHand(s, "item1"), 13);
});

test("stock: quick sales from the cash book reduce stock", () => {
  const s = richState();
  s.transactions.push({ id: "q", type: "income", date: "2026-10-28", category: "Sales", amount: 300, stockLine: { itemId: "item2", qty: 2, rate: 150 }, mode: "cash", accountId: "b3", payments: [] });
  assert.equal(onHand(s, "item2"), -2);
});

test("recurring: due months follow the frequency", () => {
  const r = { frequency: "quarterly", startMonth: "2026-01" };
  assert.deepEqual(dueMonths(r, "2026-02", "2026-12"), ["2026-04", "2026-07", "2026-10"]);
  assert.deepEqual(dueMonths({ frequency: "yearly", startMonth: "2025-03" }, "2026-01", "2026-12"), ["2026-03"]);
  assert.equal(monthlyEquivalent(1200, "yearly"), 100);
  assert.equal(monthlyEquivalent(300, "quarterly"), 100);
  assert.equal(monthlyEquivalent(100), 100);
});

test("recurring: unpaid cycles show as overdue, and paying one moves to the next", () => {
  const r = { dueDay: 5, frequency: "monthly", startMonth: "2026-10", paid: { "2026-10": "x" } };
  const overdue = cycleStatus(r, "2026-11-07");
  assert.deepEqual([overdue.month, overdue.due, overdue.days, overdue.overdue], ["2026-11", "2026-11-05", -2, true]);
  r.paid["2026-11"] = "y";
  const next = cycleStatus(r, "2026-11-07");
  assert.deepEqual([next.month, next.overdue, next.days], ["2026-12", false, 28]);
});

test("recurring: month-end due days clamp to short months", () => {
  const s = cycleStatus({ dueDay: 31, frequency: "monthly", startMonth: "2026-02", paid: {} }, "2026-02-10");
  assert.equal(s.due, "2026-02-28");
  assert.equal(s.soon, false);
});

test("recurring: old unpaid cycles stop being reported after a while", () => {
  const s = cycleStatus({ dueDay: 1, frequency: "monthly", startMonth: "2020-01", paid: {} }, "2026-11-07");
  assert.equal(s.month, "2026-08");
});

test("recurring: paused items are left out of what's coming up", () => {
  const s = blank(TODAY);
  s.recurring = [{ id: "a", name: "A", dueDay: 9, startMonth: "2026-11", active: true, paid: {} }, { id: "b", name: "B", dueDay: 8, startMonth: "2026-11", active: false, paid: {} }];
  assert.deepEqual(upcoming(s, TODAY).map((u) => u.r.id), ["a"]);
});

test("validate: required fields and amounts", () => {
  assert.equal(required("x"), "");
  assert.equal(required("  ", "Name"), "Name is required");
  assert.equal(amountError(""), "Amount is required");
  assert.equal(amountError("abc"), "Amount must be a number");
  assert.equal(amountError(-1), "Amount can't be negative");
  assert.equal(amountError(0), "Amount must be more than zero");
  assert.equal(amountError(0, { allowZero: true }), "");
  assert.equal(amountError(50, { max: 10 }), "Amount can't be more than 10");
});

test("validate: GSTIN format and checksum", () => {
  assert.equal(gstinCheckChar("27AAPFU0939F1Z"), "V");
  assert.equal(gstinError("27AAPFU0939F1ZV"), "");
  assert.equal(gstinError("27aapfu0939f1zv"), "");
  assert.equal(gstinError(""), "");
  assert.match(gstinError("27AAPFU0939F1ZA"), /doesn't match/);
  assert.match(gstinError("not a gstin"), /doesn't look like/);
});

test("validate: other formats", () => {
  assert.equal(ifscError("SBIN0001234"), "");
  assert.notEqual(ifscError("SBIN1234"), "");
  assert.equal(ifscError(""), "");
  assert.equal(phoneError("+91 98000 00000"), "");
  assert.notEqual(phoneError("123"), "");
  assert.equal(emailError("a@b.co"), "");
  assert.notEqual(emailError("a@b"), "");
  const list = [{ id: "1", sku: "A" }, { id: "2", sku: "B" }];
  assert.equal(uniqueError(list, "sku", "a", "1"), "");
  assert.match(uniqueError(list, "sku", "a", "2", "SKU"), /SKU is already in use/);
});

test("presets: every business type has its own categories plus the common ones", () => {
  assert.equal(BUSINESS_TYPES.length, 9);
  const r = presetFor("restaurant");
  assert.ok(r.expense.includes("Raw materials") && r.expense.includes("Rent"));
  assert.ok(r.income.includes("Dine-in") && r.income.includes("Sales"));
  assert.ok(r.units.includes("plate"));
  assert.equal(r.stock, true);
  assert.equal(presetFor("services").stock, false);
  assert.equal(new Set(presetFor("manufacturing").expense).size, presetFor("manufacturing").expense.length);
  assert.equal(presetFor("nonsense").units.includes("pcs"), true);
});

test("presets: merging only ever adds", () => {
  const merged = mergeCategories({ expense: ["My own", "Rent"], income: ["Mine"], units: ["bag"], stock: ["Parts"] }, presetFor("clinic"));
  assert.ok(merged.expense.includes("My own") && merged.expense.includes("Medicines"));
  assert.equal(merged.expense.filter((c) => c === "Rent").length, 1);
  assert.ok(merged.income.includes("Mine"));
  assert.deepEqual(merged.stock, ["Parts"]);
});

test("schema: normalize fills gaps without touching what's there", () => {
  const s = normalize({ profile: { name: "Mine" }, settings: { pay: { pf: true } }, staff: [{ id: "x" }] }, TODAY);
  assert.equal(s.profile.name, "Mine");
  assert.equal(s.profile.currency, "INR");
  assert.equal(s.settings.pay.pf, true);
  assert.equal(s.settings.pay.basis, "calendar");
  assert.deepEqual(s.staff, [{ id: "x" }]);
  assert.deepEqual(s.bin, []);
  assert.deepEqual(s.entries, {});
});

test("schema: a new business starts with a cash account at zero and last month selected", () => {
  const s = blank(TODAY);
  assert.equal(s.accounts[0].kind, "cash");
  assert.equal(s.settings.defaults.cashAccountId, "cash");
  assert.equal(s.settings.month, "2026-10");
});

test("ids: generated IDs are always safe for HTML", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) { const id = uid(); assert.ok(isSafeId(id)); seen.add(id); }
  assert.equal(seen.size, 500);
  assert.equal(isSafeId('x"><img'), false);
  assert.equal(isSafeId(""), false);
});

test("a migrated sample still works with the ledger's labels", () => {
  const labels = postings(migrated("v1-sample")).map((p) => p.label);
  assert.ok(labels.some((l) => l.startsWith("Invoice ST-001")));
  assert.ok(labels.some((l) => l.startsWith("Salary October 2026")));
  assert.ok(labels.some((l) => l.startsWith("EMI ·")));
});
