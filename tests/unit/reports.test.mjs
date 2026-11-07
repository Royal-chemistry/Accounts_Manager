import { test } from "node:test";
import assert from "node:assert/strict";
import { ageing, bucketFor, cashFlow, dashboardSummary, gstSummary, profitLoss, staffPaySummary, stockReport } from "../../js/core/reports.js";
import { outstanding } from "../../js/core/documents.js";
import { accountBalances } from "../../js/core/ledger.js";
import { payrollRows } from "../../js/core/payroll.js";
import { stockLedger, valuation } from "../../js/core/stock.js";
import { sumMoney } from "../../js/core/money.js";
import { blank } from "../../js/core/schema.js";
import { migrated, richState, TODAY } from "./helpers.mjs";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

test("profit: the worked example in the plan, accrual basis", () => {
  const p = profitLoss(migrated("v1-sample"), { ...OCT, basis: "accrual" });
  assert.equal(p.revenue.total, 709000 + 247300);
  assert.equal(p.expenses.total, 264499);
  assert.equal(p.staffCost, 94771);
  assert.equal(p.loanInterest, 0);
  assert.equal(p.netProfit, 597030);
});

test("profit: the worked example in the plan, cash basis", () => {
  const p = profitLoss(migrated("v1-sample"), { ...OCT, basis: "cash" });
  assert.equal(p.revenue.lines.find((l) => l.label === "Invoiced sales").amount, 101000);
  assert.equal(p.netProfit, 450730);
});

test("profit: the total equals the sum of its monthly columns", () => {
  const s = richState();
  for (const basis of ["accrual", "cash"]) {
    const p = profitLoss(s, { from: "2026-08-15", to: "2026-12-10", basis });
    assert.equal(p.monthly.length, 5);
    assert.equal(p.netProfit, sumMoney(p.monthly.map((m) => m.netProfit)), basis);
    assert.equal(p.revenue.total, sumMoney(p.monthly.map((m) => m.revenue)), basis);
    assert.equal(p.expenses.total, sumMoney(p.monthly.map((m) => m.expenses)), basis);
  }
});

test("profit: stock costs count when sold, not when bought", () => {
  const s = richState();
  const p = profitLoss(s, OCT);
  assert.equal(p.costOfSales, 320);
  assert.equal(p.grossProfit, p.revenue.total - 320);
  assert.equal(p.expenses.lines.find((l) => l.label === "Stock used or written off").amount, 213.33);
  // The non-stock purchase line is an ordinary expense. The stock line isn't.
  assert.equal(p.expenses.lines.find((l) => l.label === "Purchases").amount, 1000);
});

test("profit: GST, personal spending, loan principal and opening balances stay out", () => {
  const s = richState();
  const p = profitLoss(s, OCT);
  // 590 repairs on credit includes 90 GST, and the owner's 700 personal entry is excluded.
  assert.equal(p.expenses.lines.find((l) => l.label === "Repairs").amount, 500);
  assert.equal(p.expenses.lines.find((l) => l.label === "Other"), undefined);
  s.transactions.push({ id: "g", type: "expense", date: "2026-10-30", category: "GST payment", amount: 5000, mode: "cash", accountId: "b3", payments: [] });
  s.transactions.push({ id: "o", type: "income", date: "2026-10-30", category: "Opening balance", opening: true, amount: 7000, mode: "credit", partyType: "client", partyId: "c1", payments: [] });
  assert.equal(profitLoss(s, OCT).netProfit, p.netProfit);
  s.loans[0].payments[0].interest = 3000;
  assert.equal(profitLoss(s, OCT).loanInterest, 3000);
  assert.equal(profitLoss(s, OCT).netProfit, p.netProfit - 3000);
});

test("profit: balance adjustments stay out, and are counted so the report can say so", () => {
  const s = blank(TODAY);
  s.transactions.push({ id: "a", type: "income", date: "2026-10-02", category: "Balance adjustment", amount: 100, mode: "bank", accountId: "cash", payments: [] });
  const p = profitLoss(s, OCT);
  assert.equal(p.netProfit, 0);
  assert.equal(p.excludedAdjustments, 1);
});

test("profit: cash basis ignores any overpayment", () => {
  const s = blank(TODAY);
  s.invoices = [{ id: "i", no: "1", date: "2026-10-01", lines: [{ qty: 1, rate: 100, gstRate: 0 }], payments: [{ id: "p", date: "2026-10-02", amount: 150 }] }];
  assert.equal(profitLoss(s, { ...OCT, basis: "cash" }).revenue.total, 100);
});

test("profit: a partial month doesn't include that month's staff cost", () => {
  const s = migrated("v1-sample");
  assert.equal(profitLoss(s, { from: "2026-10-10", to: "2026-10-20" }).staffCost, 0);
  assert.equal(profitLoss(s, { from: "2026-10-10", to: "2026-10-31" }).staffCost, 94771);
});

test("cash flow: closing equals what the accounts actually hold", () => {
  for (const s of [richState(), migrated("v1-sample"), migrated("v1-edge")]) {
    for (const range of [OCT, { from: "2026-09-01", to: "2026-11-30" }, { from: "2020-01-01", to: "2030-12-31" }]) {
      const c = cashFlow(s, range);
      assert.equal(c.closing, c.actualClosing, `${range.from} to ${range.to}`);
      assert.equal(c.net, Math.round((c.inflow.total - c.outflow.total) * 100) / 100);
    }
  }
});

test("cash flow: transfers don't count as money in or out, and old unlinked entries get their own line", () => {
  const c = cashFlow(migrated("v1-sample"), OCT);
  assert.ok(!c.inflow.lines.some((l) => /transfer/i.test(l.label)));
  assert.ok(!c.outflow.lines.some((l) => /transfer/i.test(l.label)));
  const edge = cashFlow(migrated("v1-edge"), { from: "2026-09-01", to: "2026-11-30" });
  assert.ok(edge.unlinked.out > 0);
  assert.ok(edge.unlinked.in > 0);
});

test("ageing: buckets and boundaries", () => {
  assert.equal(bucketFor(-5), "notDue");
  assert.equal(bucketFor(0), "notDue");
  assert.equal(bucketFor(1), "d1to30");
  assert.equal(bucketFor(30), "d1to30");
  assert.equal(bucketFor(31), "d31to60");
  assert.equal(bucketFor(60), "d31to60");
  assert.equal(bucketFor(61), "d61to90");
  assert.equal(bucketFor(90), "d61to90");
  assert.equal(bucketFor(91), "d90plus");
});

test("ageing: totals tie to what's outstanding on the party pages", () => {
  const s = richState();
  for (const side of ["receivable", "payable"]) {
    const a = ageing(s, { side, asOf: TODAY });
    assert.equal(a.totals.total, outstanding(s, side), side);
    assert.equal(a.totals.total, sumMoney([a.totals.notDue, a.totals.d1to30, a.totals.d31to60, a.totals.d61to90, a.totals.d90plus]), side);
    for (const row of a.rows) assert.equal(row.total, outstanding(s, side, row.partyId), row.name);
  }
});

test("ageing: invoices are placed by due date, with the document date as a fallback", () => {
  const s = richState();
  const a = ageing(s, { side: "payable", asOf: "2026-11-30" });
  const docs = Object.fromEntries(a.rows.flatMap((r) => r.docs).map((d) => [d.id, d]));
  assert.equal(docs.bill1.daysOverdue, 41);
  assert.equal(docs.bill1.bucket, "d31to60");
  assert.equal(docs.bill2.daysOverdue, 55);
  assert.equal(a.rows.find((r) => r.partyId === "sup1").name, "Acme Wholesale");
});

test("GST: output against input with the right split", () => {
  const s = richState();
  s.profile.stateCode = "32";
  const g = gstSummary(s, OCT);
  // Sample invoices: 15480 + 0 + 7290 + 16560, plus 81 on the stock invoice.
  assert.equal(g.output.gst, 39411);
  assert.equal(g.output.gst, sumMoney(g.output.slabs.map((x) => x.gst)));
  assert.equal(g.output.cgst + g.output.sgst + g.output.igst, 39411);
  // Input: 108 on the Maharashtra supplier's bill is IGST, and 90 from the credit expense.
  assert.equal(g.input.gst, 198);
  assert.equal(g.input.igst, 198);
  assert.equal(g.netPayable, 39411 - 198);
});

test("GST: recorded payments reduce what's payable, and personal entries are excluded", () => {
  const s = richState();
  s.transactions.push({ id: "g", type: "expense", date: "2026-10-30", category: "GST payment", amount: 5000, mode: "cash", accountId: "b3", payments: [] });
  s.transactions.push({ id: "p", type: "expense", date: "2026-10-30", category: "Other", scope: "personal", amount: 118, gstAmount: 18, mode: "cash", accountId: "b3", payments: [] });
  const g = gstSummary(s, OCT);
  assert.equal(g.gstPaid, 5000);
  assert.equal(g.input.gst, 198);
  assert.equal(g.netPayable, 39411 - 198 - 5000);
});

test("GST: TDS deducted by clients is reported by payment date", () => {
  const s = migrated("v1-edge");
  assert.equal(gstSummary(s, OCT).tdsDeducted, 50);
});

test("stock report: value ties to quantity times average cost, and quantities add up", () => {
  const s = richState();
  const r = stockReport(s, OCT);
  const w = r.rows.find((x) => x.item.id === "item1");
  assert.deepEqual([w.opening, w.in, w.out, w.closing], [10, 5, 5, 10]);
  assert.equal(r.totalValue, valuation(stockLedger(s)));
  assert.deepEqual(r.low.map((x) => x.item.id), ["item1"]);
  const later = stockReport(s, { from: "2026-11-01", to: "2026-11-30" }).rows.find((x) => x.item.id === "item1");
  assert.deepEqual([later.opening, later.in, later.out, later.closing], [10, 0, 0, 10]);
});

test("staff pay: net equals the salary sheet, and teams add up to the total", () => {
  const s = migrated("v1-sample");
  const r = staffPaySummary(s, OCT);
  const sheet = sumMoney(payrollRows(s, "2026-10").map((x) => x.pay.net));
  assert.equal(r.totals.net, sheet);
  assert.equal(r.totals.gross, 104871);
  assert.equal(r.totals.cost, 94771);
  assert.equal(sumMoney(r.teams.map((t) => t.net)), r.totals.net);
  assert.equal(r.totals.paid, 22000);
  assert.equal(r.months.length, 1);
});

test("dashboard: headline figures match the live app", () => {
  const d = dashboardSummary(migrated("v1-sample"), TODAY);
  assert.equal(d.totalMoney, 834481);
  assert.equal(d.receivables, 170150);
  assert.equal(d.salariesToPay, 49771);
  assert.equal(d.profit, 597030);
  assert.equal(d.trend.length, 6);
  assert.equal(d.trend.at(-1).month, "2026-11");
  assert.ok(d.overdueRecurring.length > 0);
  assert.equal(d.recent.length, 8);
});

test("dashboard: the cash and bank split adds up, and held salaries aren't counted as to pay", () => {
  const s = migrated("v1-sample");
  const before = dashboardSummary(s, TODAY);
  assert.equal(before.cashTotal + before.bankTotal, sumMoney(Object.values(accountBalances(s))));
  const first = s.staff.find((x) => before.salariesToPay && !s.salaryPayments.some((p) => p.staffId === x.id));
  s.entries["2026-10"][first.id].hold = true;
  assert.ok(dashboardSummary(s, TODAY).salariesToPay < before.salariesToPay);
});

test("dashboard: low stock only shows when the module is on", () => {
  const s = richState();
  assert.equal(dashboardSummary(s, TODAY).lowStock.length, 1);
  s.settings.modules.stock = false;
  assert.equal(dashboardSummary(s, TODAY).lowStock.length, 0);
});

test("dashboard: a document is either overdue or due soon, up to a week ahead", () => {
  const s = blank(TODAY);
  const bill = (id, due) => ({ id, supplierId: "s1", billNo: id, date: "2026-01-01", due, lines: [{ desc: "x", qty: 1, rate: 100, gstRate: 0 }], payments: [] });
  const addDay = (n) => new Date(Date.UTC(...TODAY.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) + n * 864e5).toISOString().slice(0, 10);
  s.purchases = [bill("late", addDay(-1)), bill("today", addDay(0)), bill("week", addDay(7)), bill("later", addDay(8)), bill("none", "")];
  const d = dashboardSummary(s, TODAY);
  assert.deepEqual(d.overduePayables.map((x) => x.id), ["late"]);
  assert.deepEqual(d.dueSoonPayables.map((x) => x.id), ["today", "week"]);
  assert.deepEqual(d.dueSoonReceivables, []);
});

test("reports handle an empty business", () => {
  const s = blank(TODAY);
  assert.equal(profitLoss(s, OCT).netProfit, 0);
  assert.equal(cashFlow(s, OCT).closing, 0);
  assert.equal(ageing(s, { side: "receivable", asOf: TODAY }).totals.total, 0);
  assert.equal(gstSummary(s, OCT).netPayable, 0);
  assert.deepEqual(stockReport(s, OCT).rows, []);
  assert.deepEqual(staffPaySummary(s, OCT).rows, []);
  assert.equal(dashboardSummary(s, TODAY).totalMoney, 0);
});
