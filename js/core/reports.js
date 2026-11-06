// Reports. Every figure here comes from the saved records, and each report's totals are built from its own parts.
import { num, round2, sumMoney } from "./money.js";
import { addMonths, daysBetween, inRange, monthEnd, monthOf, monthStart, monthsBetween } from "./dates.js";
import { docTotals, gstSplit, lineTaxable, openDocs, stateFromGstin, txBalance } from "./documents.js";
import { accountBalances, partyName, postings } from "./ledger.js";
import { payFor, staffCost, salaryPaymentFor } from "./payroll.js";
import { NON_PROFIT_CATEGORIES } from "./presets.js";
import { isStockLine, lowStock, stockCosts, stockLedger, valuation } from "./stock.js";
import { upcoming } from "./recurring.js";

const countsTowardProfit = (t) => t.scope !== "personal" && !t.opening && !NON_PROFIT_CATEGORIES.has(String(t.category || "").trim());
const categoryOf = (t) => String(t.category || "").trim() || "Other";

function addTo(map, key, amount) { map.set(key, (map.get(key) || 0) + amount); }
const toLines = (map) => [...map.entries()]
  .map(([label, amount]) => ({ label, amount: round2(amount) }))
  .filter((l) => l.amount !== 0)
  .sort((a, b) => b.amount - a.amount);

/** The part of each payment that actually settled a document, oldest first, ignoring any overpayment. */
function settledParts(payments, total) {
  let running = 0;
  return (payments || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map((p) => {
    const amount = num(p.amount) + num(p.tds);
    const counted = Math.max(0, Math.min(total - running, amount));
    running += amount;
    return { date: p.date, counted };
  });
}

function profitForRange(state, ledger, from, to, basis) {
  const revenue = new Map(), expenses = new Map();
  const cash = basis === "cash";

  for (const inv of state.invoices) {
    const t = docTotals(inv);
    if (cash) {
      const share = t.total > 0 ? t.subtotal / t.total : 0;
      for (const p of settledParts(inv.payments, t.total)) if (inRange(p.date, from, to)) addTo(revenue, "Invoiced sales", p.counted * share);
    } else if (inRange(inv.date, from, to)) addTo(revenue, "Invoiced sales", t.subtotal);
  }

  for (const tx of state.transactions) {
    if (!countsTowardProfit(tx)) continue;
    const amount = num(tx.amount);
    const taxable = amount - num(tx.gstAmount);
    const target = tx.type === "income" ? revenue : expenses;
    if (cash && tx.mode === "credit") {
      const share = amount > 0 ? taxable / amount : 0;
      for (const p of settledParts(tx.payments, amount)) if (inRange(p.date, from, to)) addTo(target, categoryOf(tx), p.counted * share);
    } else if (inRange(tx.date, from, to)) addTo(target, categoryOf(tx), taxable);
  }

  for (const bill of state.purchases) {
    const t = docTotals(bill);
    const label = String(bill.category || "").trim() || "Purchases";
    // Stock lines become cost of sales only when sold, so only the other lines count here.
    const nonStock = (bill.lines || []).filter((l) => !isStockLine(state, l)).reduce((s, l) => s + lineTaxable(l, bill.taxInclusive), 0);
    if (!nonStock) continue;
    if (cash) {
      const share = t.total > 0 ? nonStock / t.total : 0;
      for (const p of settledParts(bill.payments, t.total)) if (inRange(p.date, from, to)) addTo(expenses, label, p.counted * share);
    } else if (inRange(bill.date, from, to)) addTo(expenses, label, nonStock);
  }

  const { cogs, writeOffs } = stockCosts(ledger, from, to);
  if (writeOffs) addTo(expenses, "Stock used or written off", writeOffs);

  let staff = 0;
  for (const month of monthsBetween(from, to)) {
    if (!inRange(monthEnd(month), from, to)) continue;
    for (const s of state.staff) staff += staffCost(payFor(state, s, month));
  }

  let interest = 0;
  for (const l of state.loans) for (const p of l.payments || []) if (inRange(p.date, from, to)) interest += num(p.interest);

  return { revenue, expenses, cogs, staff: round2(staff), interest: round2(interest) };
}

/**
 * Profit & Loss for a date range. basis is "accrual" (when invoiced or incurred) or "cash" (when paid).
 * Monthly figures are worked out first and the totals are their sum, so the columns always add up.
 */
export function profitLoss(state, { from, to, basis = "accrual" }) {
  const ledger = stockLedger(state);
  const monthly = [];
  const revenue = new Map(), expenses = new Map();
  let cogs = 0, staff = 0, interest = 0;
  for (const month of monthsBetween(from, to)) {
    const part = profitForRange(state, ledger, month === monthOf(from) ? from : monthStart(month), month === monthOf(to) ? to : monthEnd(month), basis);
    const r = sumMoney([...part.revenue.values()]);
    const e = sumMoney([...part.expenses.values()]);
    monthly.push({ month, revenue: r, costOfSales: part.cogs, grossProfit: round2(r - part.cogs), expenses: e, staffCost: part.staff, loanInterest: part.interest, netProfit: round2(r - part.cogs - e - part.staff - part.interest) });
    for (const [k, v] of part.revenue) addTo(revenue, k, v);
    for (const [k, v] of part.expenses) addTo(expenses, k, v);
    cogs += part.cogs; staff += part.staff; interest += part.interest;
  }
  const revenueTotal = sumMoney(monthly.map((m) => m.revenue));
  const expensesTotal = sumMoney(monthly.map((m) => m.expenses));
  const adjustments = state.transactions.filter((t) => categoryOf(t) === "Balance adjustment" && inRange(t.date, from, to)).length;
  return {
    from, to, basis,
    revenue: { lines: toLines(revenue), total: revenueTotal },
    costOfSales: round2(cogs),
    grossProfit: round2(revenueTotal - cogs),
    expenses: { lines: toLines(expenses), total: expensesTotal },
    staffCost: round2(staff),
    loanInterest: round2(interest),
    netProfit: sumMoney(monthly.map((m) => m.netProfit)),
    monthly,
    excludedAdjustments: adjustments,
  };
}

const IN_LABELS = { income: "Sales and other income", invoiceReceipt: "Invoice receipts", creditReceipt: "Receipts for credit sales" };
const OUT_LABELS = { expense: "Expenses", purchasePayment: "Purchase payments", creditPayment: "Supplier payments", salary: "Salaries", advance: "Advances", loan: "Loan payments" };

/** Cash flow for a date range. The closing balance always equals what the accounts actually hold. */
export function cashFlow(state, { from, to }) {
  const all = postings(state);
  const openingDay = from;
  let opening = state.accounts.reduce((t, a) => t + num(a.opening), 0);
  const inflow = new Map(), outflow = new Map();
  let unlinkedIn = 0, unlinkedOut = 0;
  const known = (id) => state.accounts.some((a) => a.id === id);
  // Transfers between two known accounts net to zero, so they don't count as money in or out.
  const internal = new Set(state.transfers.filter((t) => known(t.from) && known(t.to)).map((t) => t.id));
  for (const p of all) {
    const tracked = !p.untracked && known(p.accountId);
    if (String(p.date) < openingDay) { if (tracked) opening += p.amount; continue; }
    if (!inRange(p.date, from, to)) continue;
    if (!tracked) {
      if (p.kind === "transfer") continue;
      if (p.amount >= 0) unlinkedIn += p.amount; else unlinkedOut += -p.amount;
      continue;
    }
    if (p.kind === "transfer" && internal.has(p.sourceId)) continue;
    const label = p.kind === "transfer" ? "Transfers to or from other accounts" : p.amount >= 0 ? IN_LABELS[p.kind] || "Other money in" : OUT_LABELS[p.kind] || "Other money out";
    if (p.amount >= 0) addTo(inflow, label, p.amount); else addTo(outflow, label, -p.amount);
  }
  const totalIn = sumMoney([...inflow.values()]);
  const totalOut = sumMoney([...outflow.values()]);
  return {
    from, to,
    opening: round2(opening),
    inflow: { lines: toLines(inflow), total: totalIn },
    outflow: { lines: toLines(outflow), total: totalOut },
    net: round2(totalIn - totalOut),
    closing: round2(opening + totalIn - totalOut),
    unlinked: { in: round2(unlinkedIn), out: round2(unlinkedOut) },
    actualClosing: sumMoney(Object.values(accountBalances(state, to))),
  };
}

const BUCKETS = ["notDue", "d1to30", "d31to60", "d61to90", "d90plus"];
export const BUCKET_LABELS = { notDue: "Not due", d1to30: "1–30 days", d31to60: "31–60 days", d61to90: "61–90 days", d90plus: "Over 90 days" };

export function bucketFor(daysOverdue) {
  if (daysOverdue <= 0) return "notDue";
  if (daysOverdue <= 30) return "d1to30";
  if (daysOverdue <= 60) return "d31to60";
  if (daysOverdue <= 90) return "d61to90";
  return "d90plus";
}

/** Who owes what, and for how long. side: "receivable" or "payable". Age runs from the due date, or the document date if there's none. */
export function ageing(state, { side, asOf }) {
  const rows = new Map();
  for (const d of openDocs(state, side, { asOf })) {
    const key = `${d.partyType}:${d.partyId}`;
    if (!rows.has(key)) {
      const doc = d.docType === "invoice" ? state.invoices.find((x) => x.id === d.id) : d.docType === "purchase" ? state.purchases.find((x) => x.id === d.id) : state.transactions.find((x) => x.id === d.id);
      rows.set(key, { partyType: d.partyType, partyId: d.partyId, name: partyName(state, d.partyType, d.partyId, doc) || "(no name)", total: 0, docs: [], ...Object.fromEntries(BUCKETS.map((b) => [b, 0])) });
    }
    const row = rows.get(key);
    const daysOverdue = d.due || d.date ? daysBetween(d.due || d.date, asOf) : 0;
    const bucket = bucketFor(daysOverdue);
    row[bucket] = round2(row[bucket] + d.balance);
    row.total = round2(row.total + d.balance);
    row.docs.push({ ...d, daysOverdue, bucket });
  }
  const list = [...rows.values()].sort((a, b) => b.total - a.total);
  const totals = { total: sumMoney(list.map((r) => r.total)) };
  for (const b of BUCKETS) totals[b] = sumMoney(list.map((r) => r[b]));
  return { side, asOf, rows: list, totals };
}

function addSlab(map, rate, taxable, gst, split) {
  const s = map.get(rate) || { rate, taxable: 0, gst: 0, cgst: 0, sgst: 0, igst: 0 };
  s.taxable += taxable; s.gst += gst; s.cgst += split.cgst; s.sgst += split.sgst; s.igst += split.igst;
  map.set(rate, s);
}
const finishSlabs = (map) => [...map.values()].sort((a, b) => a.rate - b.rate).map((s) => ({ rate: s.rate, taxable: round2(s.taxable), gst: round2(s.gst), cgst: round2(s.cgst), sgst: round2(s.sgst), igst: round2(s.igst) }));
const slabTotals = (slabs) => ({ taxable: sumMoney(slabs.map((s) => s.taxable)), gst: sumMoney(slabs.map((s) => s.gst)), cgst: sumMoney(slabs.map((s) => s.cgst)), sgst: sumMoney(slabs.map((s) => s.sgst)), igst: sumMoney(slabs.map((s) => s.igst)) });

/** GST collected against GST paid on purchases, for a date range. */
export function gstSummary(state, { from, to }) {
  const biz = state.profile.stateCode || stateFromGstin(state.profile.gstin);
  const output = new Map(), input = new Map();
  let tdsDeducted = 0, paid = 0;
  const stateOf = (list, id) => { const p = list.find((x) => x.id === id); return p?.stateCode || stateFromGstin(p?.gstin); };
  for (const inv of state.invoices) {
    for (const p of inv.payments || []) if (inRange(p.date, from, to)) tdsDeducted += num(p.tds);
    if (!inRange(inv.date, from, to)) continue;
    const party = inv.placeOfSupply || stateOf(state.clients, inv.clientId);
    for (const s of docTotals(inv).gstByRate) if (s.gst || s.taxable) addSlab(output, s.rate, s.taxable, s.gst, gstSplit(s.gst, biz, party));
  }
  for (const bill of state.purchases) {
    if (!inRange(bill.date, from, to)) continue;
    const party = stateOf(state.suppliers, bill.supplierId);
    for (const s of docTotals(bill).gstByRate) if (s.gst || s.taxable) addSlab(input, s.rate, s.taxable, s.gst, gstSplit(s.gst, biz, party));
  }
  for (const tx of state.transactions) {
    if (!inRange(tx.date, from, to)) continue;
    if (String(tx.category || "").trim() === "GST payment") { paid += num(tx.amount); continue; }
    if (tx.scope === "personal" || tx.opening) continue;
    const gst = num(tx.gstAmount);
    if (!gst) continue;
    const list = tx.partyType === "supplier" ? state.suppliers : state.clients;
    addSlab(tx.type === "income" ? output : input, num(tx.gstRate), num(tx.amount) - gst, gst, gstSplit(gst, biz, stateOf(list, tx.partyId)));
  }
  const outputSlabs = finishSlabs(output), inputSlabs = finishSlabs(input);
  const out = slabTotals(outputSlabs), inp = slabTotals(inputSlabs);
  return {
    from, to, output: { slabs: outputSlabs, ...out }, input: { slabs: inputSlabs, ...inp },
    gstPaid: round2(paid), tdsDeducted: round2(tdsDeducted),
    netPayable: round2(out.gst - inp.gst - paid),
  };
}

/** Stock movement for a date range, per item. */
export function stockReport(state, { from, to }) {
  const ledger = stockLedger(state);
  const rows = ledger.map((r) => {
    let opening = r.openingQty, qtyIn = 0, qtyOut = 0;
    for (const e of r.history) {
      if (String(e.date) < from) opening += e.dir === "in" ? e.qty : -e.qty;
      else if (inRange(e.date, from, to)) { if (e.dir === "in") qtyIn += e.qty; else qtyOut += e.qty; }
    }
    const closing = Math.round((opening + qtyIn - qtyOut) * 1000) / 1000;
    return { item: r.item, opening: Math.round(opening * 1000) / 1000, in: qtyIn, out: qtyOut, closing, onHand: r.onHand, avgCost: round2(r.avgCost), value: r.value, belowReorder: r.belowReorder, negative: r.negative };
  });
  return { from, to, rows, totalValue: valuation(ledger), low: rows.filter((r) => r.belowReorder) };
}

/** Pay by person and team for a date range. A month counts when its last day is in the range. */
export function staffPaySummary(state, { from, to }) {
  const months = monthsBetween(from, to).filter((m) => inRange(monthEnd(m), from, to));
  const rows = state.staff.map((staff) => {
    const r = { staff, team: staff.team || "No team", days: 0, gross: 0, advances: 0, otherDeductions: 0, pf: 0, esi: 0, net: 0, paid: 0, pending: 0, cost: 0 };
    for (const month of months) {
      const p = payFor(state, staff, month);
      const payment = salaryPaymentFor(state, staff.id, month);
      r.days += p.days; r.gross += p.gross; r.advances += p.advance; r.pf += p.pf; r.esi += p.esi; r.net += p.net;
      r.otherDeductions += p.food + p.kit + p.other;
      r.cost += staffCost(p);
      if (payment) r.paid += num(payment.amount);
      else if (p.net > 0) r.pending += p.net;
    }
    return r;
  }).filter((r) => r.days || r.gross || r.advances || r.paid);
  const keys = ["days", "gross", "advances", "otherDeductions", "pf", "esi", "net", "paid", "pending", "cost"];
  const sum = (list) => Object.fromEntries(keys.map((k) => [k, round2(list.reduce((t, r) => t + r[k], 0))]));
  const teams = [...new Set(rows.map((r) => r.team))].sort().map((team) => {
    const list = rows.filter((r) => r.team === team);
    return { team, count: list.length, ...sum(list) };
  });
  return { from, to, months, rows, teams, totals: sum(rows) };
}

/** Everything the dashboard shows. */
export function dashboardSummary(state, today) {
  const month = state.settings.month;
  const balances = accountBalances(state);
  const accounts = state.accounts.filter((a) => a.active !== false || balances[a.id]).map((a) => ({ ...a, balance: balances[a.id] ?? 0 }));
  const cashTotal = sumMoney(accounts.filter((a) => a.kind === "cash").map((a) => a.balance));
  const bankTotal = sumMoney(accounts.filter((a) => a.kind !== "cash").map((a) => a.balance));
  const receivableDocs = openDocs(state, "receivable");
  const payableDocs = openDocs(state, "payable");
  const overdue = (d) => (d.due ? d.due < today : false);
  const pl = profitLoss(state, { from: monthStart(month), to: monthEnd(month) });
  let salariesToPay = 0;
  if (state.settings.modules?.payroll !== false) {
    for (const s of state.staff) {
      if (s.active === false) continue;
      const p = payFor(state, s, month);
      if (p.net > 0 && !salaryPaymentFor(state, s.id, month) && !state.entries[month]?.[s.id]?.hold) salariesToPay += p.net;
    }
  }
  const ledger = state.settings.modules?.stock ? stockLedger(state) : [];
  const due = upcoming(state, today);
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMonths(monthOf(today), -i);
    const part = profitLoss(state, { from: monthStart(m), to: monthEnd(m) });
    trend.push({ month: m, income: part.revenue.total, spending: round2(part.costOfSales + part.expenses.total + part.staffCost + part.loanInterest), profit: part.netProfit });
  }
  const recent = postings(state).filter((p) => p.date && p.date <= today).sort((a, b) => b.date.localeCompare(a.date)).filter((p) => p.kind !== "transfer" || p.amount > 0).slice(0, 8);
  return {
    month, accounts, cashTotal, bankTotal, totalMoney: round2(cashTotal + bankTotal),
    receivables: sumMoney(receivableDocs.map((d) => d.balance)),
    overdueReceivables: receivableDocs.filter(overdue),
    payables: sumMoney(payableDocs.map((d) => d.balance)),
    overduePayables: payableDocs.filter(overdue),
    profit: pl.netProfit, income: pl.revenue.total,
    salariesToPay: round2(salariesToPay),
    lowStock: lowStock(ledger), stockValue: valuation(ledger),
    overdueRecurring: due.filter((u) => u.overdue),
    dueSoon: due.filter((u) => u.soon),
    trend, recent,
  };
}

export { txBalance };
