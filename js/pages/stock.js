// Stock: items, what's on hand, stock in and out, and each item's history.
import { toCSV } from "../core/csv.js";
import { formatDate } from "../core/dates.js";
import { uid } from "../core/ids.js";
import { num, round2, sumMoney } from "../core/money.js";
import { lowStock, MOVE_REASONS, stockLedger, valuation } from "../core/stock.js";
import { uniqueError } from "../core/validate.js";
import { withArt } from "../ui/artwork.js";
import { $, downloadFile, html, on, raw, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { createTable, emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentField } from "./_money.js";
import { invoiceForm } from "./invoices.js";
import { purchaseForm } from "./purchases.js";

const rowFor = (state, id) => stockLedger(state).find((r) => r.item.id === id);
const qty = (n, unit) => `${Math.round(n * 1000) / 1000} ${unit || ""}`.trim();

function itemForm(ctx, item = null) {
  const state = ctx.state();
  const gstOn = state.settings.modules?.gst !== false;
  openForm({
    ctx,
    title: item ? `Edit ${item.name}` : "Add stock item",
    values: item ? { ...item } : { unit: state.categories.units[0] || "pcs", gstRate: state.settings.invoice.gstRate, openingQty: 0, reorderLevel: 0 },
    fields: [
      { k: "name", label: "Item name", required: true, full: true },
      { k: "sku", label: "SKU or code", validate: (v) => uniqueError(ctx.state().items, "sku", v, item?.id, "This SKU") },
      { k: "category", label: "Category", type: "text-list", list: state.categories.stock },
      { k: "unit", label: "Unit", type: "text-list", list: state.categories.units, required: true },
      { k: "reorderLevel", label: "Reorder level", type: "number", allowZero: true, hint: "You're alerted when stock falls to this." },
      { k: "purchasePrice", label: "Purchase price", type: "money", allowZero: true },
      { k: "salePrice", label: "Sale price", type: "money", allowZero: true },
      ...(gstOn ? [
        { k: "gstRate", label: "GST %", type: "number", allowZero: true, max: 100 },
        { k: "hsn", label: "HSN code", maxlength: 8 },
      ] : []),
      { type: "section", label: "Opening stock" },
      { k: "openingQty", label: "Opening quantity", type: "number", allowZero: true, hint: "What you held when you started tracking it." },
      { k: "openingCost", label: "Cost of each", type: "money", allowZero: true, hint: "Leave blank to use the purchase price." },
      ...(item ? [{ k: "active", label: "Active (shown when adding invoice and purchase lines)", type: "checkbox", full: true }] : []),
    ],
    onSubmit(v) {
      const data = {
        name: v.name.trim(), sku: (v.sku || "").trim(), category: (v.category || "").trim(), unit: v.unit.trim(), reorderLevel: num(v.reorderLevel),
        purchasePrice: num(v.purchasePrice), salePrice: num(v.salePrice), gstRate: num(v.gstRate), hsn: v.hsn || "", openingQty: num(v.openingQty), openingCost: num(v.openingCost),
      };
      ctx.store.update((s) => {
        for (const [list, value] of [["stock", data.category], ["units", data.unit]]) {
          if (value && !s.categories[list].some((c) => c.toLowerCase() === value.toLowerCase())) s.categories[list].push(value);
        }
        if (item) Object.assign(s.items.find((i) => i.id === item.id), data, { active: v.active !== false });
        else s.items.push({ id: uid(), active: true, ...data });
      });
      toast(item ? "Saved" : `${data.name} added`);
    },
  });
}

/** Stock in from a supplier goes through a purchase, so the bill, GST and payment are all recorded. */
function stockIn(ctx, item) {
  const gstOn = ctx.state().settings.modules?.gst !== false;
  purchaseForm(ctx, null, { lines: [{ desc: item.name, hsn: item.hsn || "", qty: 1, rate: item.purchasePrice || "", gstRate: gstOn ? item.gstRate || 0 : 0, itemId: item.id }] });
}

/** A sale without a formal invoice. It reduces stock and goes in the cash book. */
function saleForm(ctx, item) {
  const state = ctx.state();
  const row = rowFor(state, item.id);
  const gstOn = state.settings.modules?.gst !== false;
  const money2 = (n) => ctx.money(n, { decimals: 2 });
  const totals = (v) => {
    const taxable = round2(num(v.qty) * num(v.rate));
    const gst = gstOn ? round2(taxable * num(v.gstRate) / 100) : 0;
    return { taxable, gst, total: round2(taxable + gst) };
  };
  const form = openForm({
    ctx,
    title: `Sell ${item.name}`,
    intro: `${qty(row.onHand, item.unit)} in stock.`,
    values: { date: ctx.today(), qty: 1, rate: item.salePrice || "", gstRate: gstOn ? item.gstRate || 0 : 0 },
    submitLabel: "Save sale",
    footNote: "",
    fields: [
      { k: "date", label: "Date", type: "date", required: true },
      { k: "qty", label: `Quantity (${item.unit || "units"})`, type: "number", required: true, warn: (v) => (num(v) > row.onHand ? `That's more than the ${qty(row.onHand, item.unit)} in stock, so it will show as negative until you record the purchase.` : "") },
      { k: "rate", label: "Rate", type: "money", required: true },
      ...(gstOn ? [{ k: "gstRate", label: "GST %", type: "number", allowZero: true, max: 100 }] : []),
      { k: "partyId", label: "Client", type: "select", options: [["", "None"], ...state.clients.filter((c) => c.active !== false).map((c) => [c.id, c.name])], hint: "Needed if it's on credit." },
      paymentField("stock-sale", { allowCredit: true, label: "How was it received?", creditNeedsParty: "partyId" }),
      { k: "note", label: "Note", full: true },
      { type: "note", k: "invoiceHint", body: html`Need a formal invoice? <button type="button" class="btn-link" data-make-invoice>Create an invoice instead</button>.` },
      {
        k: "_total", type: "note", body: "",
        onAnyChange: (v, api) => {
          const t = totals(v);
          api.setFootNote(`Total ${money2(t.total)}${t.gst ? `, including ${money2(t.gst)} GST` : ""}`);
        },
      },
    ],
    onSubmit(v) {
      const t = totals(v);
      ctx.store.update((s) => {
        const category = s.categories.income[0] || "Sales";
        s.transactions.push(applyPayment({
          id: uid(), type: "income", date: v.date, category, note: v.note || `${v.qty} × ${item.name}`, amount: t.total, gstAmount: t.gst, gstRate: num(v.gstRate), scope: "business",
          partyType: v.partyId ? "client" : null, partyId: v.partyId || null, due: v.payment.due || "", recurringId: null, stockLine: { itemId: item.id, qty: num(v.qty), rate: num(v.rate) }, payments: [],
        }, v.payment));
      });
      toast(`Sold ${qty(num(v.qty), item.unit)} of ${item.name}`);
    },
  });
  form.root.addEventListener("click", (e) => {
    if (!e.target.closest("[data-make-invoice]")) return;
    form.close();
    const line = { desc: item.name, hsn: item.hsn || "", qty: 1, rate: item.salePrice || "", gstRate: gstOn ? item.gstRate || 0 : 0, itemId: item.id };
    invoiceForm(ctx, null, { lines: [line] });
  });
}

/** Stock leaving or arriving with no money changing hands: used, damaged, returned, or a recount. */
function moveForm(ctx, item, preset = "usage") {
  const row = rowFor(ctx.state(), item.id);
  const money = (n) => ctx.money(n);
  openForm({
    ctx,
    title: `Update stock of ${item.name}`,
    intro: `${qty(row.onHand, item.unit)} in stock, valued at ${money(row.avgCost)} each. No money moves for these.`,
    values: { reason: preset, date: ctx.today(), qty: "" },
    submitLabel: "Save",
    fields: [
      { k: "reason", label: "What happened?", type: "select", full: true, options: [...Object.entries(MOVE_REASONS).filter(([k]) => !k.startsWith("adjust")).map(([k, r]) => [k, r.label]), ["count", "I counted it, and the real figure is different"]] },
      { k: "date", label: "Date", type: "date", required: true },
      { k: "qty", label: "Quantity", type: "number", required: true, when: (v) => v.reason !== "count", warn: (v, all) => (all.reason !== "return" && num(v) > row.onHand ? `That's more than the ${qty(row.onHand, item.unit)} in stock.` : "") },
      { k: "actual", label: "Real quantity on hand", type: "number", required: true, allowZero: true, when: (v) => v.reason === "count" },
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      let reason = v.reason, amount = num(v.qty);
      if (v.reason === "count") {
        const diff = Math.round((num(v.actual) - row.onHand) * 1000) / 1000;
        if (!diff) { toast("It already matches", { kind: "info" }); return; }
        reason = diff > 0 ? "adjustIn" : "adjustOut";
        amount = Math.abs(diff);
      }
      ctx.store.update((s) => { s.stockMoves.push({ id: uid(), itemId: item.id, date: v.date, reason, qty: amount, unitCost: 0, note: v.note || "" }); });
      toast("Stock updated");
    },
  });
}

const statusOf = (r) => {
  if (r.item.active === false) return ["", "Inactive"];
  if (r.negative) return ["danger", "Below zero"];
  if (r.belowReorder) return ["warning", "Low stock"];
  return ["success", "In stock"];
};
const statusBadge = (r) => { const [tone, label] = statusOf(r); return html`<span class="badge ${tone ? `badge-${tone}` : ""}">${label}</span>`; };

function itemActions(ctx, r) {
  return [
    { label: "Stock in", icon: "arrow-in", primary: true, onClick: () => stockIn(ctx, r.item) },
    { label: "Sell", icon: "arrow-out", primary: true, onClick: () => saleForm(ctx, r.item) },
    { label: "Used, damaged or recounted", icon: "edit", menu: true, onClick: () => moveForm(ctx, r.item) },
    { label: "Edit item", icon: "edit", onClick: () => itemForm(ctx, r.item) },
    { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "item", r.item.id) },
  ];
}

function itemsTab(host, ctx) {
  const state = ctx.state();
  setHTML(host, html`<section class="card card-flush" data-table></section>`);
  const rows = () => stockLedger(ctx.state()).map((r) => ({ ...r, id: r.item.id }));
  const categories = [...new Set(state.items.map((i) => i.category).filter(Boolean))].sort();
  const money = (n) => ctx.money(n);
  const table = createTable($("[data-table]", host), {
    id: "stock", label: "Stock items",
    rows,
    defaultSort: { key: "name", dir: "asc" },
    search: { placeholder: "Search by name, SKU or category", text: (r) => `${r.item.name} ${r.item.sku} ${r.item.category}` },
    filters: [
      ...(categories.length ? [{ key: "category", label: "All categories", options: categories.map((c) => [c, c]), test: (r, v) => r.item.category === v }] : []),
      { key: "status", label: "All stock levels", options: [["low", "Low stock"], ["negative", "Below zero"], ["inactive", "Inactive"]], test: (r, v) => (v === "low" ? r.belowReorder : v === "negative" ? r.negative : r.item.active === false) },
    ],
    toolbar: html`<button type="button" class="btn" data-items-csv>${icon("download")}CSV</button>`,
    rowClass: (r) => (r.item.active === false ? "row-inactive" : ""),
    columns: [
      { key: "name", label: "Item", sortable: true, mobile: "title", value: (r) => r.item.name, render: (r) => withArt(r.item.name, html`<span class="cell-title"><a href="#/stock/${r.item.id}">${r.item.name}</a></span><span class="cell-sub">${[r.item.sku, r.item.category].filter(Boolean).join(" · ")}</span>`) },
      { key: "onHand", label: "On hand", align: "num", sortable: true, mobile: "amount", render: (r) => html`<span class="strong ${r.negative ? "text-danger" : ""}">${qty(r.onHand, r.item.unit)}</span>` },
      { key: "reorder", label: "Reorder at", align: "num", value: (r) => num(r.item.reorderLevel), render: (r) => (num(r.item.reorderLevel) ? r.item.reorderLevel : "—") },
      { key: "avgCost", label: "Average cost", align: "num", sortable: true, render: (r) => money(round2(r.avgCost)) },
      { key: "price", label: "Sale price", align: "num", value: (r) => num(r.item.salePrice), render: (r) => money(r.item.salePrice || 0) },
      { key: "value", label: "Value", align: "num", sortable: true, render: (r) => money(r.value) },
      { key: "status", label: "Status", sortable: true, mobile: "status", value: (r) => statusOf(r)[1], render: statusBadge },
    ],
    totals: (list) => ({ name: `${list.length} items`, value: money(sumMoney(list.map((r) => r.value))) }),
    actions: (r) => itemActions(ctx, r),
    empty: { icon: "box", title: "No stock items yet", hint: "Add what you buy and sell, and you'll see what's on hand and when to reorder.", action: html`<button type="button" class="btn btn-primary" data-add-item>${icon("plus")}Add stock item</button>` },
  });
  on(host, "click", "[data-items-csv]", () => {
    downloadFile("stock.csv", toCSV([
      ["Item", "SKU", "Category", "Unit", "On hand", "Reorder level", "Average cost", "Sale price", "GST %", "Value"],
      ...table.visibleRows().map((r) => [r.item.name, r.item.sku, r.item.category, r.item.unit, r.onHand, r.item.reorderLevel, round2(r.avgCost), r.item.salePrice, r.item.gstRate, r.value]),
    ]));
  });
}

const eventHref = (e) => (e.sourceType === "invoice" ? `#/invoices/${e.sourceId}` : e.sourceType === "purchase" ? `#/purchases/${e.sourceId}` : e.sourceType === "transaction" ? "#/cashbook" : "");
const eventColumns = (ctx, withItem) => [
  { key: "date", label: "Date", sortable: true, mobile: "meta", render: (e) => formatDate(e.date) },
  ...(withItem ? [{ key: "item", label: "Item", sortable: true, mobile: "title", value: (e) => e.itemName, render: (e) => html`<span class="cell-title"><a href="#/stock/${e.itemId}">${e.itemName}</a></span>` }] : []),
  { key: "label", label: "What", mobile: withItem ? "meta" : "title", render: (e) => (eventHref(e) ? html`<a href="${eventHref(e)}">${e.label}</a>` : e.label) },
  { key: "in", label: "In", align: "num", mobile: "amount", value: (e) => (e.dir === "in" ? e.qty : ""), isZero: (e) => e.dir !== "in", render: (e) => (e.dir === "in" ? html`<span class="text-success">+${e.qty}</span>` : "") },
  { key: "out", label: "Out", align: "num", mobile: "amount", value: (e) => (e.dir === "out" ? e.qty : ""), isZero: (e) => e.dir !== "out", render: (e) => (e.dir === "out" ? `-${e.qty}` : "") },
  { key: "balance", label: "Balance", align: "num", mobile: "detail", render: (e) => e.balance },
  { key: "cost", label: "Cost", align: "num", mobile: "detail", value: (e) => e.costAmount, render: (e) => ctx.money(e.costAmount) },
];

function movementsTab(host, ctx) {
  setHTML(host, html`<section class="card card-flush" data-table></section>`);
  const rows = () => stockLedger(ctx.state()).flatMap((r) => r.history.map((e, i) => ({ ...e, id: `${r.item.id}-${i}`, itemId: r.item.id, itemName: r.item.name })));
  createTable($("[data-table]", host), {
    id: "stock-moves", label: "Stock movements",
    rows,
    defaultSort: { key: "date", dir: "desc" },
    search: { placeholder: "Search movements", text: (e) => `${e.itemName} ${e.label}` },
    filters: [{ key: "dir", label: "In and out", options: [["in", "Stock in"], ["out", "Stock out"]], test: (e, v) => e.dir === v }],
    columns: eventColumns(ctx, true),
    actions: (e) => (e.sourceType === "stockMove" ? [{ label: "Delete movement", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "stockMove", e.sourceId) }] : []),
    empty: { icon: "box", title: "No movements yet", hint: "Purchases, sales, and anything used or damaged show here." },
  });
}

function renderDetail(root, ctx, id) {
  const state = ctx.state();
  const r = rowFor(state, id);
  if (!r) {
    setHTML(root, html`<div class="page">${pageHead({ title: "Stock item not found", back: { page: "stock", label: "Stock" } })}<section class="card">${emptyState({ icon: "box", title: "This item doesn't exist", hint: "It may have been deleted. Check the Recycle Bin." })}</section></div>`);
    return;
  }
  const { item } = r;
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: item.name, art: item.name, back: { page: "stock", label: "Stock" },
        sub: [item.sku, item.category].filter(Boolean).join(" · "),
        actions: html`
          <button type="button" class="btn" data-in>${icon("arrow-in")}Stock in</button>
          <button type="button" class="btn" data-sell>${icon("arrow-out")}Sell</button>
          <button type="button" class="btn" data-move>${icon("edit")}Used or recounted</button>
          <button type="button" class="btn" data-edit>Edit</button>
          <button type="button" class="btn" data-delete>${icon("trash")}Delete</button>`,
      })}
      ${r.negative ? html`<div class="banner banner-warning">${icon("alert")}<p>More has been sold or used than recorded as bought. Record the missing purchase, or recount it.</p></div>` : r.belowReorder ? html`<div class="banner banner-warning">${icon("alert")}<p>This is at or below its reorder level of ${item.reorderLevel}.</p></div>` : ""}
      <div class="kpis">
        ${kpi({ label: "On hand", value: qty(r.onHand, item.unit), ic: "box", tone: r.negative ? "bad" : r.belowReorder ? "warn" : "" })}
        ${kpi({ label: "Average cost", value: ctx.money(round2(r.avgCost)), ic: "percent" })}
        ${kpi({ label: "Stock value", value: ctx.money(r.value), ic: "wallet" })}
        ${kpi({ label: "Sale price", value: ctx.money(item.salePrice || 0), ic: "tag", sub: item.gstRate ? `GST ${item.gstRate}%` : "" })}
      </div>
      <section class="card card-flush">
        <div class="card-head card-head-pad"><h2>History</h2><span class="small muted">Opening stock: ${qty(r.openingQty, item.unit)}</span></div>
        <div data-history></div>
      </section>
    </div>`);
  createTable($("[data-history]", root), {
    id: "stock-history", label: `History of ${item.name}`,
    rows: () => r.history.map((e, i) => ({ ...e, id: String(i) })).reverse(),
    columns: eventColumns(ctx, false),
    actions: (e) => (e.sourceType === "stockMove" ? [{ label: "Delete movement", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "stockMove", e.sourceId) }] : []),
    empty: { icon: "box", title: "Nothing has moved yet", hint: "Purchases, sales, and anything used or damaged show here." },
  });
  on(root, "click", "[data-in]", () => stockIn(ctx, item));
  on(root, "click", "[data-sell]", () => saleForm(ctx, item));
  on(root, "click", "[data-move]", () => moveForm(ctx, item));
  on(root, "click", "[data-edit]", () => itemForm(ctx, item));
  on(root, "click", "[data-delete]", () => confirmDelete(ctx, "item", id, { onDeleted: () => ctx.navigate("stock") }));
}

export default {
  id: "stock",
  title: "Stock",
  render(root, ctx, params) {
    if (params[0] && params[0] !== "movements") { renderDetail(root, ctx, params[0]); return; }
    const tab = params[0] === "movements" ? "movements" : "items";
    const state = ctx.state();
    const ledger = stockLedger(state);
    const low = lowStock(ledger);
    const negative = ledger.filter((r) => r.negative);
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Stock",
          sub: "What you hold, what it's worth, and when to reorder. Costs use a moving average.",
          actions: html`<button type="button" class="btn btn-primary" data-add data-add-item>${icon("plus")}Add stock item</button>`,
        })}
        <div class="kpis">
          ${kpi({ label: "Stock value", value: ctx.money(valuation(ledger), { decimals: 0 }), ic: "wallet" })}
          ${kpi({ label: "Items", value: state.items.filter((i) => i.active !== false).length, ic: "box" })}
          ${kpi({ label: "Low stock", value: low.length, ic: "alert", tone: low.length ? "warn" : "", sub: low.slice(0, 2).map((r) => r.item.name).join(", ") })}
          ${kpi({ label: "Below zero", value: negative.length, ic: "alert", tone: negative.length ? "bad" : "" })}
        </div>
        <nav class="tabs" aria-label="Stock sections">
          <a class="tab" href="#/stock" ${tab === "items" ? raw('aria-current="page"') : ""}>Items</a>
          <a class="tab" href="#/stock/movements" ${tab === "movements" ? raw('aria-current="page"') : ""}>Movements</a>
        </nav>
        <div data-tab></div>
      </div>`);
    (tab === "movements" ? movementsTab : itemsTab)($("[data-tab]", root), ctx);
    on(root, "click", "[data-add-item]", () => itemForm(ctx));
  },
};
