// Invoices: billing clients, GST, part payments and TDS.
import { toCSV } from "../core/csv.js";
import { addDays, formatDate, monthLabel, monthOf } from "../core/dates.js";
import { addPayment, docTotals, gstSplit, stateFromGstin } from "../core/documents.js";
import { uid } from "../core/ids.js";
import { num, round2, sumMoney } from "../core/money.js";
import { partyName } from "../core/ledger.js";
import { uniqueError } from "../core/validate.js";
import { $, downloadFile, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { docHead, printDocument, signature, wordsLine } from "../ui/print.js";
import { createTable, emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { paymentLabel } from "../ui/payment-field.js";
import { kpi, pageHead } from "./_common.js";
import { linesField } from "./_lines.js";
import { applyPayment, paymentField } from "./_money.js";
import { stateOptions } from "./onboarding.js";
import { clientForm } from "./parties.js";

const invoiceStatus = (inv, t, today) => {
  if (t.status === "paid") return ["success", "Paid"];
  if (inv.due && inv.due < today) return ["danger", "Overdue"];
  return t.status === "partial" ? ["warning", "Partly paid"] : ["warning", "Unpaid"];
};
const statusBadge = (inv, t, today) => { const [tone, label] = invoiceStatus(inv, t, today); return html`<span class="badge badge-${tone}">${label}</span>`; };
const nextNumber = (state) => `${state.settings.invoice.prefix || ""}${String(state.settings.invoice.nextNo || 1).padStart(3, "0")}`;
const clientOf = (state, inv) => state.clients.find((c) => c.id === inv.clientId);
const partyStateOf = (state, inv) => inv.placeOfSupply || clientOf(state, inv)?.stateCode || stateFromGstin(clientOf(state, inv)?.gstin);
const bizState = (state) => state.profile.stateCode || stateFromGstin(state.profile.gstin);

export function invoiceForm(ctx, inv = null, preset = {}) {
  const state = ctx.state();
  const clients = state.clients.filter((c) => c.active !== false || c.id === inv?.clientId);
  if (!clients.length) {
    toast("Add a client first", { kind: "info" });
    clientForm(ctx, null, { onSaved: (id) => invoiceForm(ctx, null, { clientId: id }) });
    return;
  }
  const gstOn = state.settings.modules?.gst !== false;
  const defaultGst = state.settings.invoice.gstRate;
  const today = ctx.today();
  const first = clients.find((c) => c.id === (inv?.clientId || preset.clientId)) || clients[0];
  const dueFrom = (date) => (state.settings.invoice.dueDays ? addDays(date, Number(state.settings.invoice.dueDays)) : "");
  const values = inv ? { ...inv } : {
    clientId: first.id, no: nextNumber(state), date: today, due: dueFrom(today), placeOfSupply: first.stateCode || stateFromGstin(first.gstin) || "",
    reducesStock: true, taxInclusive: false, lines: preset.lines || [{ desc: "", qty: 1, rate: first.rate || "", gstRate: first.gst !== false && gstOn ? defaultGst : 0 }],
    payment: { mode: "credit" },
  };
  const options = (api) => {
    const v = api.values();
    const client = ctx.state().clients.find((c) => c.id === v.clientId);
    return { taxInclusive: v.taxInclusive, bizState: bizState(ctx.state()), partyState: v.placeOfSupply || client?.stateCode || stateFromGstin(client?.gstin), defaultGst: client?.gst !== false && gstOn ? defaultGst : 0 };
  };
  const form = openForm({
    ctx, size: "xl",
    title: inv ? `Edit invoice ${inv.no}` : "New invoice",
    values,
    submitLabel: inv ? "Save" : "Create invoice",
    fields: [
      { k: "clientId", label: "Client", type: "select", required: true, options: clients.map((c) => [c.id, c.name]), full: true },
      { k: "no", label: "Invoice number", required: true, validate: (v) => uniqueError(ctx.state().invoices, "no", v, inv?.id, "This invoice number") },
      { k: "date", label: "Invoice date", type: "date", required: true },
      { k: "due", label: "Due date", type: "date", validate: (v, all) => (v && all.date && v < all.date ? "The due date is before the invoice date" : "") },
      ...(gstOn ? [{ k: "placeOfSupply", label: "Place of supply", type: "select", options: stateOptions(), hint: "A different state from yours uses IGST." }] : []),
      ...(gstOn ? [{ k: "taxInclusive", label: "The rates I enter already include GST", type: "checkbox", full: true }] : []),
      linesField(ctx, { getOptions: options }),
      ...(state.settings.modules?.stock ? [{ k: "reducesStock", label: "Reduce stock for the stock items on this invoice", type: "checkbox", full: true }] : []),
      ...(inv ? [] : [paymentField("invoice", { allowCredit: true, hideDue: true, label: "Has it been paid?", defaultMode: "credit" })]),
      { k: "notes", label: "Notes printed on the invoice", type: "textarea", rows: 2, full: true },
    ],
    onSubmit(v) {
      const data = {
        clientId: v.clientId, no: v.no.trim(), date: v.date, due: v.due || "", placeOfSupply: v.placeOfSupply || "", taxInclusive: !!v.taxInclusive,
        // With the stock module off, keep whatever was set, so turning it back on doesn't change stock.
        reducesStock: ctx.state().settings.modules?.stock ? !!v.reducesStock : (inv?.reducesStock ?? false),
        lines: v.lines, notes: v.notes || "",
      };
      if (inv) {
        ctx.store.update((s) => { Object.assign(s.invoices.find((x) => x.id === inv.id), data); });
        toast(`Invoice ${data.no} saved`);
        return;
      }
      let created;
      ctx.store.update((s) => {
        created = { id: uid(), payments: [], ...data };
        s.invoices.push(created);
        if (data.no === nextNumber(s)) s.settings.invoice.nextNo = (Number(s.settings.invoice.nextNo) || 1) + 1;
        if (v.payment?.mode && v.payment.mode !== "credit") {
          addPayment(s, "invoice", created.id, applyPayment({ date: v.date, amount: docTotals(created).total, tds: 0, note: "Paid when invoiced" }, v.payment));
        }
      });
      toast(`Invoice ${data.no} created`);
    },
  });
  // Choosing a client sets up their usual place of supply, GST and rate.
  form.root.addEventListener("change", (e) => {
    if (e.target.name === "clientId") {
      const c = ctx.state().clients.find((x) => x.id === e.target.value);
      if (!c) return;
      form.setValue("placeOfSupply", c.stateCode || stateFromGstin(c.gstin) || "");
      if (!inv) {
        const gst = form.root.querySelector('[data-l="gstRate"]');
        if (gst) gst.value = c.gst !== false && gstOn ? defaultGst : 0;
        const rate = form.root.querySelector('[data-l="rate"]');
        if (rate && !rate.value && c.rate) rate.value = c.rate;
      }
    }
    if (e.target.name === "date" && !inv) form.setValue("due", dueFrom(e.target.value));
  });
}

export function receiveForm(ctx, inv) {
  const t = docTotals(inv);
  openForm({
    ctx,
    title: `Payment for ${inv.no}`,
    intro: `${partyName(ctx.state(), "client", inv.clientId, inv)}. ${ctx.money(t.balance)} still to come.`,
    values: { date: ctx.today(), amount: t.balance },
    submitLabel: "Save payment",
    fields: [
      { k: "date", label: "Received on", type: "date", required: true },
      { k: "amount", label: "Amount received", type: "money", required: true, validate: (v, all) => (round2(num(v) + num(all.tds)) > t.balance + 0.5 ? `That's more than the ${ctx.money(t.balance)} owed` : "") },
      { k: "tds", label: "TDS deducted by the client", type: "money", allowZero: true, hint: "If the client kept back TDS, enter it here so the invoice balances." },
      paymentField("invoice-receipt", { label: "How was it received?" }),
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      ctx.store.update((s) => { addPayment(s, "invoice", inv.id, applyPayment({ date: v.date, amount: num(v.amount), tds: num(v.tds), note: v.note || "" }, v.payment)); });
      const after = docTotals(ctx.state().invoices.find((x) => x.id === inv.id));
      toast(after.status === "paid" ? `${inv.no} is fully paid` : `Part payment saved. ${ctx.money(after.balance)} still to come`);
    },
  });
}

export function invoiceDocument(state, inv, money2) {
  const t = docTotals(inv);
  const client = clientOf(state, inv) || {};
  const split = gstSplit(t.gst, bizState(state), partyStateOf(state, inv));
  const hasHsn = (inv.lines || []).some((l) => l.hsn);
  const showGst = t.gst > 0;
  const iSet = state.settings.invoice;
  const lineAmount = (l) => num(l.qty) * num(l.rate);
  const taxLines = [];
  for (const s of t.gstByRate) {
    if (!s.gst) continue;
    if (split.igst) taxLines.push([`IGST ${s.rate}%`, s.gst]);
    else {
      const half = round2(s.gst / 2);
      taxLines.push([`CGST ${s.rate / 2}%`, half], [`SGST ${s.rate / 2}%`, round2(s.gst - half)]);
    }
  }
  const cols = 4 + (hasHsn ? 1 : 0);
  return html`
    <section class="doc">
      ${docHead(state, { title: showGst ? "Tax invoice" : "Invoice", lines: [`No. ${inv.no}`, `Date: ${formatDate(inv.date)}`, inv.due ? `Due: ${formatDate(inv.due)}` : ""] })}
      <div class="doc-cols">
        <div>
          <div class="doc-label">Bill to</div>
          <div><b>${client.name || inv.partyNameSnapshot || "—"}</b></div>
          ${client.address ? html`<div class="doc-small doc-pre">${client.address}</div>` : ""}
          ${client.gstin ? html`<div class="doc-small">GSTIN: ${client.gstin}</div>` : ""}
        </div>
      </div>
      <table class="doc-table">
        <thead><tr><th>#</th><th class="doc-desc">Description</th>${hasHsn ? html`<th>HSN/SAC</th>` : ""}<th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${(inv.lines || []).map((l, i) => html`<tr><td>${i + 1}</td><td>${l.desc}${l.gstRate && t.gstByRate.length > 1 ? html` <span class="doc-small">(GST ${l.gstRate}%)</span>` : ""}</td>${hasHsn ? html`<td>${l.hsn}</td>` : ""}<td class="num">${l.qty}</td><td class="num">${money2(l.rate)}</td><td class="num">${money2(lineAmount(l))}</td></tr>`)}
          <tr><td colspan="${cols}" class="num">Taxable amount</td><td class="num">${money2(t.subtotal)}</td></tr>
          ${taxLines.map(([label, amount]) => html`<tr><td colspan="${cols}" class="num">${label}</td><td class="num">${money2(amount)}</td></tr>`)}
          <tr class="total"><td colspan="${cols}" class="num">Total</td><td class="num">${money2(t.total)}</td></tr>
          ${t.received + t.tds > 0 ? html`
            <tr><td colspan="${cols}" class="num">Paid${t.tds ? " (including TDS)" : ""}</td><td class="num">${money2(t.received + t.tds)}</td></tr>
            <tr class="total"><td colspan="${cols}" class="num">Balance due</td><td class="num">${money2(t.balance)}</td></tr>` : ""}
        </tbody>
      </table>
      <p class="doc-words">${wordsLine(t.total, state.profile.currency)}.</p>
      ${inv.notes ? html`<p class="doc-small doc-pre">${inv.notes}</p>` : ""}
      ${iSet.bankLine ? html`<p class="doc-small"><b>Pay to:</b> ${iSet.bankLine}</p>` : ""}
      ${iSet.terms ? html`<p class="doc-small doc-pre">${iSet.terms}</p>` : ""}
      <div class="doc-signs"><span></span>${signature(`For ${state.profile.name || "the business"}`)}</div>
    </section>`;
}

function printRegister(ctx, rows, label) {
  const state = ctx.state();
  const money2 = (n) => ctx.money(n, { decimals: 2 });
  const sum = (key) => sumMoney(rows.map((r) => r.t[key]));
  printDocument(html`
    <section class="doc">
      ${docHead(state, { title: "Invoice register", lines: [label, `Printed ${formatDate(ctx.today())}`] })}
      <table class="doc-table">
        <thead><tr><th>No.</th><th>Date</th><th>Client</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map(({ inv, t }) => html`<tr><td class="nowrap">${inv.no}</td><td class="nowrap">${formatDate(inv.date)}</td><td>${partyName(state, "client", inv.clientId, inv)}</td><td class="num">${money2(t.subtotal)}</td><td class="num">${money2(t.gst)}</td><td class="num">${money2(t.total)}</td><td class="num">${money2(t.balance)}</td><td>${invoiceStatus(inv, t, ctx.today())[1]}</td></tr>`)}
          <tr class="total"><td colspan="3">Total, ${rows.length} invoices</td><td class="num">${money2(sum("subtotal"))}</td><td class="num">${money2(sum("gst"))}</td><td class="num">${money2(sum("total"))}</td><td class="num">${money2(sum("balance"))}</td><td></td></tr>
        </tbody>
      </table>
    </section>`, { title: "Invoice register" });
}

function renderList(root, ctx) {
  const state = ctx.state();
  const today = ctx.today();
  const month = state.settings.month;
  const rows = () => ctx.state().invoices.map((inv) => ({ id: inv.id, inv, t: docTotals(inv) }));
  const all = rows();
  const open = all.filter((r) => r.t.balance > 0);
  const overdue = open.filter((r) => r.inv.due && r.inv.due < today);
  const billed = sumMoney(all.filter((r) => monthOf(r.inv.date) === month).map((r) => r.t.total));
  const received = sumMoney(all.flatMap((r) => r.inv.payments || []).filter((p) => monthOf(p.date) === month).map((p) => p.amount));
  const money = (n) => ctx.money(n);
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: "Invoices",
        sub: "Bill clients, track what's paid, and print GST invoices.",
        actions: html`
          <button type="button" class="btn" data-csv>${icon("download")}CSV</button>
          <button type="button" class="btn" data-register>${icon("printer")}Print register</button>
          <button type="button" class="btn btn-primary" data-add>${icon("plus")}New invoice</button>`,
      })}
      <div class="kpis">
        ${kpi({ label: "Outstanding", value: ctx.money(sumMoney(open.map((r) => r.t.balance)), { decimals: 0 }), ic: "receipt", tone: open.length ? "warn" : "good", sub: `${open.length} open` })}
        ${kpi({ label: "Overdue", value: overdue.length, ic: "clock", tone: overdue.length ? "bad" : "", sub: overdue.length ? ctx.money(sumMoney(overdue.map((r) => r.t.balance)), { decimals: 0 }) : "" })}
        ${kpi({ label: `Billed, ${monthLabel(month)}`, value: ctx.money(billed, { decimals: 0 }), ic: "chart" })}
        ${kpi({ label: `Received, ${monthLabel(month)}`, value: ctx.money(received, { decimals: 0 }), ic: "check-circle", tone: received ? "good" : "" })}
      </div>
      <section class="card card-flush" data-table></section>
    </div>`);
  const table = createTable($("[data-table]", root), {
    id: "invoices", label: "Invoices",
    rows,
    defaultSort: { key: "date", dir: "desc" },
    search: { placeholder: "Search by number or client", text: (r) => `${r.inv.no} ${partyName(ctx.state(), "client", r.inv.clientId, r.inv)}` },
    filters: [
      { key: "status", label: "All statuses", options: [["open", "Unpaid and partly paid"], ["overdue", "Overdue"], ["paid", "Paid"]], test: (r, v) => (v === "paid" ? r.t.status === "paid" : v === "overdue" ? r.t.status !== "paid" && r.inv.due && r.inv.due < today : r.t.status !== "paid") },
      { key: "month", label: "All months", options: [...new Set(all.map((r) => monthOf(r.inv.date)))].sort().reverse().map((m) => [m, monthLabel(m)]), test: (r, v) => monthOf(r.inv.date) === v },
    ],
    columns: [
      { key: "no", label: "Number", sortable: true, mobile: "title", value: (r) => r.inv.no, render: (r) => html`<span class="cell-title"><a href="#/invoices/${r.inv.id}">${r.inv.no}</a></span><span class="cell-sub">${partyName(ctx.state(), "client", r.inv.clientId, r.inv)}</span>` },
      { key: "date", label: "Date", sortable: true, mobile: "meta", value: (r) => r.inv.date, render: (r) => html`${formatDate(r.inv.date)}${r.inv.due ? html`<span class="cell-sub">Due ${formatDate(r.inv.due)}</span>` : ""}` },
      { key: "total", label: "Total", align: "num", sortable: true, mobile: "amount", value: (r) => r.t.total, render: (r) => money(r.t.total) },
      { key: "received", label: "Received", align: "num", sortable: true, value: (r) => r.t.received + r.t.tds, render: (r) => money(r.t.received + r.t.tds) },
      { key: "balance", label: "Balance", align: "num", sortable: true, value: (r) => r.t.balance, render: (r) => (r.t.balance > 0 ? html`<span class="strong">${money(r.t.balance)}</span>` : money(0)) },
      { key: "status", label: "Status", sortable: true, mobile: "status", value: (r) => invoiceStatus(r.inv, r.t, today)[1], render: (r) => statusBadge(r.inv, r.t, today) },
    ],
    totals: (list) => ({ no: `Total, ${list.length} invoices`, total: money(sumMoney(list.map((r) => r.t.total))), received: money(sumMoney(list.map((r) => r.t.received + r.t.tds))), balance: money(sumMoney(list.map((r) => r.t.balance))) }),
    actions: (r) => [
      ...(r.t.status !== "paid" ? [{ label: "Receive", icon: "arrow-in", primary: true, onClick: () => receiveForm(ctx, r.inv) }] : []),
      { label: "Print", icon: "printer", menu: true, onClick: () => printDocument(invoiceDocument(ctx.state(), r.inv, (n) => ctx.money(n, { decimals: 2 })), { title: `Invoice ${r.inv.no}` }) },
      { label: "Edit", icon: "edit", onClick: () => invoiceForm(ctx, r.inv) },
      { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "invoice", r.inv.id) },
    ],
    empty: { icon: "receipt", title: "No invoices yet", hint: "Create your first invoice and it will appear here.", action: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}New invoice</button>` },
  });
  on(root, "click", "[data-add]", () => invoiceForm(ctx));
  on(root, "click", "[data-register]", () => {
    const list = table.visibleRows();
    if (!list.length) { toast("There's nothing to print", { kind: "info" }); return; }
    printRegister(ctx, list, `${list.length} invoices`);
  });
  on(root, "click", "[data-csv]", () => {
    const list = table.visibleRows();
    downloadFile("invoices.csv", toCSV([
      ["Number", "Date", "Due", "Client", "GSTIN", "Taxable", "GST", "Total", "Received", "TDS", "Balance", "Status"],
      ...list.map(({ inv, t }) => [inv.no, inv.date, inv.due, partyName(ctx.state(), "client", inv.clientId, inv), clientOf(ctx.state(), inv)?.gstin || "", t.subtotal, t.gst, t.total, t.received, t.tds, t.balance, invoiceStatus(inv, t, today)[1]]),
    ]));
  });
}

function renderDetail(root, ctx, id) {
  const state = ctx.state();
  const inv = state.invoices.find((x) => x.id === id);
  if (!inv) {
    setHTML(root, html`<div class="page">${pageHead({ title: "Invoice not found", back: { page: "invoices", label: "Invoices" } })}<section class="card">${emptyState({ icon: "receipt", title: "This invoice doesn't exist", hint: "It may have been deleted. Check the Recycle Bin." })}</section></div>`);
    return;
  }
  const t = docTotals(inv);
  const money2 = (n) => ctx.money(n, { decimals: 2 });
  const split = gstSplit(t.gst, bizState(state), partyStateOf(state, inv));
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: `Invoice ${inv.no}`,
        back: { page: "invoices", label: "Invoices" },
        sub: html`${partyName(state, "client", inv.clientId, inv)} · ${formatDate(inv.date)} ${statusBadge(inv, t, ctx.today())}`,
        actions: html`
          ${t.status !== "paid" ? html`<button type="button" class="btn btn-primary" data-receive>${icon("arrow-in")}Receive payment</button>` : ""}
          <button type="button" class="btn" data-print>${icon("printer")}Print</button>
          <button type="button" class="btn" data-edit>${icon("edit")}Edit</button>
          <button type="button" class="btn" data-delete>${icon("trash")}Delete</button>`,
      })}
      <div class="grid grid-2">
        <section class="card">
          <h2 class="card-title">Items</h2>
          <div class="lines">${(inv.lines || []).map((l) => html`<div class="line"><span class="line-label">${l.desc} · ${l.qty} × ${money2(l.rate)}${l.gstRate ? ` · GST ${l.gstRate}%` : ""}</span><span class="line-value">${money2(num(l.qty) * num(l.rate))}</span></div>`)}</div>
        </section>
        <section class="card">
          <h2 class="card-title">Totals</h2>
          <div class="lines">
            <div class="line"><span class="line-label">Taxable amount</span><span class="line-value">${money2(t.subtotal)}</span></div>
            ${t.gst ? (split.igst ? html`<div class="line"><span class="line-label">IGST</span><span class="line-value">${money2(split.igst)}</span></div>` : html`<div class="line"><span class="line-label">CGST</span><span class="line-value">${money2(split.cgst)}</span></div><div class="line"><span class="line-label">SGST</span><span class="line-value">${money2(split.sgst)}</span></div>`) : ""}
            <div class="line line-total"><span class="line-label">Total</span><span class="line-value">${money2(t.total)}</span></div>
            <div class="line"><span class="line-label">Received</span><span class="line-value">${money2(t.received)}</span></div>
            ${t.tds ? html`<div class="line"><span class="line-label">TDS deducted</span><span class="line-value">${money2(t.tds)}</span></div>` : ""}
            <div class="line line-total"><span class="line-label">Balance</span><span class="line-value">${money2(t.balance)}</span></div>
            ${t.overpaid ? html`<div class="line"><span class="line-label text-warning">Overpaid by</span><span class="line-value text-warning">${money2(t.overpaid)}</span></div>` : ""}
          </div>
        </section>
      </div>
      <section class="card card-flush">
        <div class="card-head card-head-pad"><h2>Payments</h2></div>
        <div data-payments></div>
      </section>
    </div>`);
  createTable($("[data-payments]", root), {
    id: "invoice-payments", label: "Payments on this invoice",
    rows: () => ctx.state().invoices.find((x) => x.id === id)?.payments || [],
    columns: [
      { key: "date", label: "Date", mobile: "title", render: (p) => formatDate(p.date) },
      { key: "how", label: "How", mobile: "meta", render: (p) => paymentLabel(ctx.state(), p) },
      { key: "note", label: "Note", mobile: "meta" },
      { key: "tds", label: "TDS", align: "num", render: (p) => (num(p.tds) ? money2(p.tds) : "") },
      { key: "amount", label: "Amount", align: "num", mobile: "amount", render: (p) => money2(p.amount) },
    ],
    actions: (p) => [{ label: "Delete payment", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "payment", p.id) }],
    empty: { icon: "wallet", title: "No payments yet", hint: "Payments you record against this invoice show here." },
  });
  on(root, "click", "[data-receive]", () => receiveForm(ctx, inv));
  on(root, "click", "[data-print]", () => printDocument(invoiceDocument(ctx.state(), inv, money2), { title: `Invoice ${inv.no}` }));
  on(root, "click", "[data-edit]", () => invoiceForm(ctx, inv));
  on(root, "click", "[data-delete]", () => confirmDelete(ctx, "invoice", inv.id, { onDeleted: () => ctx.navigate("invoices") }));
}

export default {
  id: "invoices",
  title: "Invoices",
  render(root, ctx, params) {
    if (params[0]) renderDetail(root, ctx, params[0]);
    else renderList(root, ctx);
  },
};
