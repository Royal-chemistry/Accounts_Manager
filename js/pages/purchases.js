// Purchases: supplier bills, what's been paid on them, and what's still owed.
import { toCSV } from "../core/csv.js";
import { addDays, formatDate, monthLabel, monthOf } from "../core/dates.js";
import { addPayment, docTotals, gstSplit, stateFromGstin } from "../core/documents.js";
import { uid } from "../core/ids.js";
import { partyName } from "../core/ledger.js";
import { num, round2, sumMoney } from "../core/money.js";
import { uniqueError } from "../core/validate.js";
import { $, downloadFile, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { paymentLabel } from "../ui/payment-field.js";
import { createTable, emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { linesField } from "./_lines.js";
import { applyPayment, paymentField } from "./_money.js";
import { supplierForm } from "./parties.js";

const billStatus = (bill, t, today) => {
  if (t.status === "paid") return ["success", "Paid"];
  if (bill.due && bill.due < today) return ["danger", "Overdue"];
  return t.status === "partial" ? ["warning", "Partly paid"] : ["warning", "Unpaid"];
};
const statusBadge = (bill, t, today) => { const [tone, label] = billStatus(bill, t, today); return html`<span class="badge badge-${tone}">${label}</span>`; };
const bizState = (state) => state.profile.stateCode || stateFromGstin(state.profile.gstin);

/** Opens the form for a new or existing purchase. preset can pre-fill the supplier and lines. */
export function purchaseForm(ctx, bill = null, preset = {}) {
  const state = ctx.state();
  const suppliers = state.suppliers.filter((s) => s.active !== false || s.id === bill?.supplierId);
  if (!suppliers.length) {
    toast("Add a supplier first", { kind: "info" });
    supplierForm(ctx, null, { onSaved: (id) => purchaseForm(ctx, null, { ...preset, supplierId: id }) });
    return;
  }
  const gstOn = state.settings.modules?.gst !== false;
  const defaultGst = state.settings.invoice.gstRate;
  const today = ctx.today();
  const values = bill ? { ...bill } : {
    supplierId: preset.supplierId || suppliers[0].id, billNo: "", date: today, due: "", taxInclusive: false, category: "",
    lines: preset.lines || [{ desc: "", qty: 1, rate: "", gstRate: gstOn ? defaultGst : 0 }],
  };
  const options = (api) => {
    const v = api.values();
    const supplier = ctx.state().suppliers.find((s) => s.id === v.supplierId);
    return { taxInclusive: v.taxInclusive, bizState: bizState(ctx.state()), partyState: supplier?.stateCode || stateFromGstin(supplier?.gstin), defaultGst: gstOn ? defaultGst : 0 };
  };
  openForm({
    ctx, size: "xl",
    title: bill ? `Edit purchase ${bill.billNo || ""}`.trim() : "New purchase",
    intro: state.settings.modules?.stock ? "Lines linked to a stock item add to your stock. Their cost reaches profit only when they're sold." : "",
    values,
    submitLabel: bill ? "Save" : "Save purchase",
    fields: [
      { k: "supplierId", label: "Supplier", type: "select", required: true, options: suppliers.map((s) => [s.id, s.name]), full: true },
      { k: "billNo", label: "Bill number", validate: (v, all) => { const clash = uniqueError(ctx.state().purchases.filter((p) => p.supplierId === all.supplierId), "billNo", v, bill?.id, "This bill number"); return clash ? `${clash} for this supplier` : ""; } },
      { k: "date", label: "Bill date", type: "date", required: true },
      { k: "due", label: "Due date", type: "date", validate: (v, all) => (v && all.date && v < all.date ? "The due date is before the bill date" : "") },
      { k: "category", label: "Expense category", type: "text-list", list: state.categories.expense, placeholder: "Purchases", hint: "Used for any lines that aren't stock." },
      ...(gstOn ? [{ k: "taxInclusive", label: "The rates I enter already include GST", type: "checkbox", full: true }] : []),
      linesField(ctx, { priceKey: "purchasePrice", getOptions: options }),
      ...(bill ? [] : [paymentField("purchase", { allowCredit: true, hideDue: true, label: "Has it been paid?", defaultMode: "credit", creditNote: "Recorded as unpaid, and added to what you owe this supplier." })]),
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      const data = { supplierId: v.supplierId, billNo: (v.billNo || "").trim(), date: v.date, due: v.due || "", category: (v.category || "").trim(), taxInclusive: !!v.taxInclusive, lines: v.lines, note: v.note || "" };
      if (bill) {
        ctx.store.update((s) => { Object.assign(s.purchases.find((x) => x.id === bill.id), data); });
        toast("Purchase saved");
        return;
      }
      ctx.store.update((s) => {
        const created = { id: uid(), payments: [], ...data };
        if (!created.due && v.payment.mode === "credit" && s.settings.invoice.dueDays) created.due = addDays(v.date, Number(s.settings.invoice.dueDays));
        s.purchases.push(created);
        if (data.category && !s.categories.expense.some((c) => c.toLowerCase() === data.category.toLowerCase())) s.categories.expense.push(data.category);
        if (v.payment.mode !== "credit") addPayment(s, "purchase", created.id, applyPayment({ date: v.date, amount: docTotals(created).total, tds: 0, note: "Paid when bought" }, v.payment));
      });
      toast("Purchase saved");
    },
  });
}

export function payBillForm(ctx, bill) {
  const t = docTotals(bill);
  openForm({
    ctx,
    title: `Pay ${bill.billNo || "this purchase"}`,
    intro: `${partyName(ctx.state(), "supplier", bill.supplierId, bill)}. ${ctx.money(t.balance)} still owed.`,
    values: { date: ctx.today(), amount: t.balance },
    submitLabel: "Save payment",
    fields: [
      { k: "date", label: "Paid on", type: "date", required: true },
      { k: "amount", label: "Amount paid", type: "money", required: true, validate: (v) => (round2(num(v)) > t.balance ? `That's more than the ${ctx.money(t.balance)} owed` : "") },
      paymentField("purchase-payment", { label: "How was it paid?" }),
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      ctx.store.update((s) => { addPayment(s, "purchase", bill.id, applyPayment({ date: v.date, amount: num(v.amount), tds: 0, note: v.note || "" }, v.payment)); });
      const after = docTotals(ctx.state().purchases.find((x) => x.id === bill.id));
      toast(after.status === "paid" ? "Purchase fully paid" : `Part payment saved. ${ctx.money(after.balance)} still owed`);
    },
  });
}

function renderList(root, ctx) {
  const state = ctx.state();
  const today = ctx.today();
  const month = state.settings.month;
  const rows = () => ctx.state().purchases.map((bill) => ({ id: bill.id, bill, t: docTotals(bill) }));
  const all = rows();
  const open = all.filter((r) => r.t.balance > 0);
  const overdue = open.filter((r) => r.bill.due && r.bill.due < today);
  const bought = sumMoney(all.filter((r) => monthOf(r.bill.date) === month).map((r) => r.t.total));
  const paid = sumMoney(all.flatMap((r) => r.bill.payments || []).filter((p) => monthOf(p.date) === month).map((p) => p.amount));
  const money = (n) => ctx.money(n);
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: "Purchases",
        sub: "What you've bought from suppliers, and what you still owe.",
        actions: html`
          <button type="button" class="btn" data-csv>${icon("download")}CSV</button>
          <button type="button" class="btn btn-primary" data-add>${icon("plus")}New purchase</button>`,
      })}
      <div class="kpis">
        ${kpi({ label: "You owe on purchases", value: ctx.money(sumMoney(open.map((r) => r.t.balance)), { decimals: 0 }), ic: "cart", tone: open.length ? "warn" : "good", sub: `${open.length} open` })}
        ${kpi({ label: "Overdue", value: overdue.length, ic: "clock", tone: overdue.length ? "bad" : "", sub: overdue.length ? ctx.money(sumMoney(overdue.map((r) => r.t.balance)), { decimals: 0 }) : "" })}
        ${kpi({ label: `Bought, ${monthLabel(month)}`, value: ctx.money(bought, { decimals: 0 }), ic: "chart" })}
        ${kpi({ label: `Paid, ${monthLabel(month)}`, value: ctx.money(paid, { decimals: 0 }), ic: "check-circle" })}
      </div>
      <section class="card card-flush" data-table></section>
    </div>`);
  const table = createTable($("[data-table]", root), {
    id: "purchases", label: "Purchases",
    rows,
    defaultSort: { key: "date", dir: "desc" },
    search: { placeholder: "Search by bill number or supplier", text: (r) => `${r.bill.billNo} ${partyName(ctx.state(), "supplier", r.bill.supplierId, r.bill)}` },
    filters: [
      { key: "status", label: "All statuses", options: [["open", "Unpaid and partly paid"], ["overdue", "Overdue"], ["paid", "Paid"]], test: (r, v) => (v === "paid" ? r.t.status === "paid" : v === "overdue" ? r.t.status !== "paid" && r.bill.due && r.bill.due < today : r.t.status !== "paid") },
      { key: "month", label: "All months", options: [...new Set(all.map((r) => monthOf(r.bill.date)))].sort().reverse().map((m) => [m, monthLabel(m)]), test: (r, v) => monthOf(r.bill.date) === v },
    ],
    columns: [
      { key: "no", label: "Bill", sortable: true, mobile: "title", value: (r) => r.bill.billNo, render: (r) => html`<span class="cell-title"><a href="#/purchases/${r.bill.id}">${r.bill.billNo || "No number"}</a></span><span class="cell-sub">${partyName(ctx.state(), "supplier", r.bill.supplierId, r.bill)}</span>` },
      { key: "date", label: "Date", sortable: true, mobile: "meta", value: (r) => r.bill.date, render: (r) => html`${formatDate(r.bill.date)}${r.bill.due ? html`<span class="cell-sub">Due ${formatDate(r.bill.due)}</span>` : ""}` },
      { key: "total", label: "Total", align: "num", sortable: true, mobile: "amount", value: (r) => r.t.total, render: (r) => money(r.t.total) },
      { key: "paid", label: "Paid", align: "num", sortable: true, value: (r) => r.t.received, render: (r) => money(r.t.received) },
      { key: "balance", label: "Balance", align: "num", sortable: true, value: (r) => r.t.balance, render: (r) => (r.t.balance > 0 ? html`<span class="strong">${money(r.t.balance)}</span>` : money(0)) },
      { key: "status", label: "Status", sortable: true, mobile: "status", value: (r) => billStatus(r.bill, r.t, today)[1], render: (r) => statusBadge(r.bill, r.t, today) },
    ],
    totals: (list) => ({ no: `Total, ${list.length} purchases`, total: money(sumMoney(list.map((r) => r.t.total))), paid: money(sumMoney(list.map((r) => r.t.received))), balance: money(sumMoney(list.map((r) => r.t.balance))) }),
    actions: (r) => [
      ...(r.t.status !== "paid" ? [{ label: "Pay", icon: "arrow-out", primary: true, onClick: () => payBillForm(ctx, r.bill) }] : []),
      { label: "Edit", icon: "edit", onClick: () => purchaseForm(ctx, r.bill) },
      { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "purchase", r.bill.id) },
    ],
    empty: { icon: "cart", title: "No purchases yet", hint: "Record supplier bills here, paid or on credit.", action: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}New purchase</button>` },
  });
  on(root, "click", "[data-add]", () => purchaseForm(ctx));
  on(root, "click", "[data-csv]", () => {
    downloadFile("purchases.csv", toCSV([
      ["Bill", "Date", "Due", "Supplier", "GSTIN", "Taxable", "GST", "Total", "Paid", "Balance", "Status"],
      ...table.visibleRows().map(({ bill, t }) => [bill.billNo, bill.date, bill.due, partyName(ctx.state(), "supplier", bill.supplierId, bill), ctx.state().suppliers.find((s) => s.id === bill.supplierId)?.gstin || "", t.subtotal, t.gst, t.total, t.received, t.balance, billStatus(bill, t, today)[1]]),
    ]));
  });
}

function renderDetail(root, ctx, id) {
  const state = ctx.state();
  const bill = state.purchases.find((x) => x.id === id);
  if (!bill) {
    setHTML(root, html`<div class="page">${pageHead({ title: "Purchase not found", back: { page: "purchases", label: "Purchases" } })}<section class="card">${emptyState({ icon: "cart", title: "This purchase doesn't exist", hint: "It may have been deleted. Check the Recycle Bin." })}</section></div>`);
    return;
  }
  const t = docTotals(bill);
  const money2 = (n) => ctx.money(n, { decimals: 2 });
  const supplier = state.suppliers.find((s) => s.id === bill.supplierId);
  const split = gstSplit(t.gst, bizState(state), supplier?.stateCode || stateFromGstin(supplier?.gstin));
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: bill.billNo ? `Purchase ${bill.billNo}` : "Purchase",
        back: { page: "purchases", label: "Purchases" },
        sub: html`${partyName(state, "supplier", bill.supplierId, bill)} · ${formatDate(bill.date)} ${statusBadge(bill, t, ctx.today())}`,
        actions: html`
          ${t.status !== "paid" ? html`<button type="button" class="btn btn-primary" data-pay>${icon("arrow-out")}Pay</button>` : ""}
          <button type="button" class="btn" data-edit>${icon("edit")}Edit</button>
          <button type="button" class="btn" data-delete>${icon("trash")}Delete</button>`,
      })}
      <div class="grid grid-2">
        <section class="card">
          <h2 class="card-title">Items</h2>
          <div class="lines">${(bill.lines || []).map((l) => html`<div class="line"><span class="line-label">${l.desc} · ${l.qty} × ${money2(l.rate)}${l.gstRate ? ` · GST ${l.gstRate}%` : ""}${l.itemId ? " · Stock" : ""}</span><span class="line-value">${money2(num(l.qty) * num(l.rate))}</span></div>`)}</div>
        </section>
        <section class="card">
          <h2 class="card-title">Totals</h2>
          <div class="lines">
            <div class="line"><span class="line-label">Taxable amount</span><span class="line-value">${money2(t.subtotal)}</span></div>
            ${t.gst ? (split.igst ? html`<div class="line"><span class="line-label">IGST</span><span class="line-value">${money2(split.igst)}</span></div>` : html`<div class="line"><span class="line-label">CGST</span><span class="line-value">${money2(split.cgst)}</span></div><div class="line"><span class="line-label">SGST</span><span class="line-value">${money2(split.sgst)}</span></div>`) : ""}
            <div class="line line-total"><span class="line-label">Total</span><span class="line-value">${money2(t.total)}</span></div>
            <div class="line"><span class="line-label">Paid</span><span class="line-value">${money2(t.received)}</span></div>
            <div class="line line-total"><span class="line-label">Balance</span><span class="line-value">${money2(t.balance)}</span></div>
          </div>
        </section>
      </div>
      <section class="card card-flush">
        <div class="card-head card-head-pad"><h2>Payments</h2></div>
        <div data-payments></div>
      </section>
    </div>`);
  createTable($("[data-payments]", root), {
    id: "purchase-payments", label: "Payments on this purchase",
    rows: () => ctx.state().purchases.find((x) => x.id === id)?.payments || [],
    columns: [
      { key: "date", label: "Date", mobile: "title", render: (p) => formatDate(p.date) },
      { key: "how", label: "How", mobile: "meta", render: (p) => paymentLabel(ctx.state(), p) },
      { key: "note", label: "Note", mobile: "meta" },
      { key: "amount", label: "Amount", align: "num", mobile: "amount", render: (p) => money2(p.amount) },
    ],
    actions: (p) => [{ label: "Delete payment", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "payment", p.id) }],
    empty: { icon: "wallet", title: "No payments yet", hint: "Payments you record against this purchase show here." },
  });
  on(root, "click", "[data-pay]", () => payBillForm(ctx, bill));
  on(root, "click", "[data-edit]", () => purchaseForm(ctx, bill));
  on(root, "click", "[data-delete]", () => confirmDelete(ctx, "purchase", bill.id, { onDeleted: () => ctx.navigate("purchases") }));
}

export default {
  id: "purchases",
  title: "Purchases",
  render(root, ctx, params) {
    if (params[0]) renderDetail(root, ctx, params[0]);
    else renderList(root, ctx);
  },
};
