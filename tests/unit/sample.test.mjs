import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../../js/core/sample.js";
import { accountBalances } from "../../js/core/ledger.js";
import { ageing, cashFlow, dashboardSummary, profitLoss } from "../../js/core/reports.js";
import { docTotals, outstanding } from "../../js/core/documents.js";
import { payFor } from "../../js/core/payroll.js";
import { stockLedger } from "../../js/core/stock.js";
import { gstinError } from "../../js/core/validate.js";
import { versionOf } from "../../js/core/migrate.js";
import { addMonths, isDate, monthEnd, monthOf, monthStart } from "../../js/core/dates.js";

const TODAY = "2026-11-07";
const CASES = [TODAY, "2027-03-01", "2028-02-29", "2026-01-31", "2026-12-31"];

test("the sample is valid current-version data with every area filled in", () => {
  const s = sample(TODAY);
  assert.equal(versionOf(s), 2);
  assert.equal(s.profile.onboarded, true);
  for (const k of ["staff", "clients", "suppliers", "invoices", "purchases", "transactions", "accounts", "transfers", "loans", "recurring", "items", "stockMoves", "advances", "salaryPayments"]) {
    assert.ok(s[k].length > 0, `${k} is empty`);
  }
  assert.ok(Object.keys(s.entries).length > 0);
  assert.ok(Object.keys(s.attendance).length > 0);
  assert.equal(s.settings.modules.stock, true);
});

for (const today of CASES) {
  test(`the sample holds together when today is ${today}`, () => {
    const s = sample(today);
    assert.equal(s.settings.month, addMonths(monthOf(today), -1));
    for (const a of Object.values(accountBalances(s))) assert.ok(a >= 0, "no account should be overdrawn");
    for (const r of stockLedger(s)) assert.ok(r.onHand >= 0, `${r.item.name} shouldn't be negative`);
    for (const d of [...s.invoices, ...s.purchases, ...s.transactions]) assert.ok(isDate(d.date), `${d.id} has a bad date`);
    const last = addMonths(monthOf(today), -1);
    const c = cashFlow(s, { from: monthStart(last), to: monthEnd(last) });
    assert.equal(c.closing, c.actualClosing);
    assert.equal(ageing(s, { side: "receivable", asOf: today }).totals.total, outstanding(s, "receivable"));
    assert.ok(profitLoss(s, { from: monthStart(last), to: monthEnd(last) }).netProfit > 0);
    assert.ok(outstanding(s, "receivable") > 0);
    assert.ok(outstanding(s, "payable") > 0);
    for (const p of s.salaryPayments) {
      const staff = s.staff.find((x) => x.id === p.staffId);
      assert.equal(p.amount, payFor(s, staff, p.month).net, "salary paid should match the salary sheet");
    }
    assert.ok(dashboardSummary(s, today).lowStock.length > 0);
  });
}

test("every GSTIN in the sample is valid", () => {
  const s = sample(TODAY);
  for (const g of [s.profile.gstin, ...s.clients.map((c) => c.gstin), ...s.suppliers.map((c) => c.gstin)]) assert.equal(gstinError(g), "", g);
});

test("the sample includes an inter-state client, on-hold pay and paid invoices with TDS", () => {
  const s = sample(TODAY);
  assert.ok(s.clients.some((c) => c.stateCode && c.stateCode !== s.profile.stateCode));
  assert.ok(Object.values(s.entries[s.settings.month]).some((e) => e.hold));
  assert.ok(s.invoices.some((i) => (i.payments || []).some((p) => p.tds > 0)));
  assert.ok(s.invoices.some((i) => docTotals(i).status === "paid"));
});
