// Clients and suppliers share the same screens: who they are, what they owe or are owed, and settling up.
import { formatDate } from "../core/dates.js";
import { allocatePayment, docTotals, openDocs, outstanding, settle, stateFromGstin } from "../core/documents.js";
import { uid } from "../core/ids.js";
import { num, round2, sumMoney } from "../core/money.js";
import { emailError, gstinError, phoneError } from "../core/validate.js";
import { $, $$, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { createTable, emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentField } from "./_money.js";
import { stateOptions } from "./onboarding.js";

const KIND = {
  client: { collection: "clients", side: "receivable", one: "client", One: "Client", many: "Clients", page: "clients", owesLabel: "Owes you", owesKpi: "Clients owe you", icon: "building", docs: "invoices", docKey: "clientId", docOne: "invoice", settleVerb: "Receive payment", settleTitle: "Receive from", newDoc: "invoice", direction: "Received" },
  supplier: { collection: "suppliers", side: "payable", one: "supplier", One: "Supplier", many: "Suppliers", page: "suppliers", owesLabel: "You owe", owesKpi: "You owe suppliers", icon: "truck", docs: "purchases", docKey: "supplierId", docOne: "purchase", settleVerb: "Pay supplier", settleTitle: "Pay", newDoc: "purchase", direction: "Paid" },
};
const whatsappUrl = (phone) => `https://wa.me/${String(phone).replace(/\D/g, "")}`;

function partyForm(ctx, kind, party = null, { onSaved } = {}) {
  const k = KIND[kind];
  const gstOn = ctx.state().settings.modules?.gst !== false;
  openForm({
    ctx,
    title: party ? `Edit ${party.name}` : `Add ${k.one}`,
    values: party ? { ...party } : { active: true, gst: true, stateCode: "" },
    fields: [
      { k: "name", label: `${k.One} name`, required: true, full: true },
      { k: "contact", label: "Contact person" },
      { k: "phone", label: "Phone", type: "tel", validate: (v) => phoneError(v) },
      { k: "email", label: "Email", type: "email", validate: (v) => emailError(v) },
      ...(gstOn ? [
        { k: "gstin", label: "GSTIN", warn: (v) => gstinError(v), maxlength: 15, onChange: (v, _all, api) => { const code = stateFromGstin(v); if (code) api.setValue("stateCode", code); } },
        { k: "stateCode", label: "State", type: "select", options: stateOptions(), hint: "Used to choose between IGST and CGST + SGST." },
      ] : []),
      { k: "address", label: "Address", type: "textarea", rows: 2, full: true },
      ...(kind === "client" ? [
        { k: "rate", label: "Usual rate", type: "money", allowZero: true, hint: "Pre-fills new invoices." },
        ...(gstOn ? [{ k: "gst", label: "Charge GST on invoices", type: "checkbox" }] : []),
      ] : []),
      ...(party ? [] : [{ k: "openingBalance", label: `${kind === "client" ? "They owe you" : "You owe them"} from before`, type: "money", allowZero: true, hint: "Anything outstanding before you started using this app. Leave blank if nothing." }]),
      ...(party ? [{ k: "active", label: "Active (shown when creating new entries)", type: "checkbox", full: true }] : []),
    ],
    onSubmit(v) {
      const opening = num(v.openingBalance);
      const { openingBalance, ...fields } = v;
      fields.gstin = String(fields.gstin || "").trim().toUpperCase();
      if (fields.rate !== undefined) fields.rate = num(fields.rate);
      let savedId = party?.id;
      ctx.store.update((s) => {
        if (party) { Object.assign(s[k.collection].find((x) => x.id === party.id), fields); return; }
        savedId = uid();
        s[k.collection].push({ id: savedId, active: true, ...fields });
        if (opening > 0) {
          s.transactions.push({
            id: uid(), type: kind === "client" ? "income" : "expense", date: ctx.today(), category: "Opening balance", note: "From before using this app", amount: opening, gstAmount: 0,
            scope: "business", partyType: kind, partyId: savedId, due: "", recurringId: null, stockLine: null, payments: [], mode: "credit", accountId: null, untracked: false, opening: true,
          });
        }
      });
      toast(party ? "Saved" : `${v.name} added`);
      onSaved?.(savedId);
    },
  });
}

export const clientForm = (ctx, client, opts) => partyForm(ctx, "client", client, opts);
export const supplierForm = (ctx, supplier, opts) => partyForm(ctx, "supplier", supplier, opts);

/** Records a real payment against what a party owes, splitting it across their open documents, oldest first. */
export function settleForm(ctx, kind, partyId) {
  const k = KIND[kind];
  const state = ctx.state();
  const party = state[k.collection].find((p) => p.id === partyId);
  const docs = openDocs(state, k.side, { partyId });
  const owed = sumMoney(docs.map((d) => d.balance));
  if (!docs.length) { toast(`Nothing is outstanding with ${party?.name || "them"}`, { kind: "info" }); return; }
  const money2 = (n) => ctx.money(n, { decimals: 2 });
  const label = (d) => `${d.docType === "invoice" ? "Invoice" : d.docType === "purchase" ? "Purchase" : ""} ${d.no || d.note || "Entry"}`.trim();
  const allocField = {
    k: "allocations", type: "custom", full: true, label: "Applied to",
    read: (el) => $$("[data-alloc]", el).map((input) => ({ docType: input.dataset.docType, id: input.dataset.id, amount: num(String(input.value).replace(/,/g, "")) })).filter((a) => a.amount > 0),
    validate: (list, all) => {
      const total = sumMoney((list || []).map((a) => a.amount));
      if (round2(total) !== round2(num(all.amount))) return `The split adds up to ${money2(total)}, but the payment is ${money2(num(all.amount))}`;
      const over = (list || []).find((a) => round2(a.amount) > docs.find((d) => d.id === a.id).balance);
      return over ? "One of these is more than that document's balance" : "";
    },
    mount(el, api) {
      setHTML(el, html`
        <div class="alloc-list">
          ${docs.map((d) => html`
            <div class="alloc-row">
              <div class="grow"><div class="strong">${label(d)}</div><div class="small muted">${formatDate(d.date)}${d.due ? ` · Due ${formatDate(d.due)}` : ""} · ${money2(d.balance)} open</div></div>
              <label class="sr-only" for="alloc-${d.id}">Amount for ${label(d)}</label>
              <input class="input input-num alloc-input" id="alloc-${d.id}" inputmode="decimal" data-alloc data-doc-type="${d.docType}" data-id="${d.id}">
            </div>`)}
        </div>`);
      const spread = () => {
        const { allocations } = allocatePayment(docs, num(api.values().amount));
        for (const input of $$("[data-alloc]", el)) {
          const a = allocations.find((x) => x.id === input.dataset.id);
          input.value = a ? a.amount : "";
        }
      };
      api.spread = spread;
      spread();
    },
  };
  openForm({
    ctx, size: "lg",
    title: `${k.settleTitle} ${party?.name || ""}`.trim(),
    intro: `${money2(owed)} is outstanding across ${docs.length} ${docs.length === 1 ? "document" : "documents"}. The payment goes to the oldest first, and you can change the split.`,
    values: { date: ctx.today(), amount: owed },
    submitLabel: k.settleVerb,
    fields: [
      { k: "date", label: "Date", type: "date", required: true },
      { k: "amount", label: "Amount", type: "money", required: true, validate: (v) => (round2(num(v)) > owed ? `That's more than the ${money2(owed)} outstanding` : ""), onChange: (_v, _all, api) => api.spread?.() },
      paymentField(`settle-${kind}`, { label: kind === "client" ? "How was it received?" : "How was it paid?" }),
      allocField,
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        settle(s, { side: k.side, partyId, date: v.date, ...applyPayment({}, v.payment), note: v.note || "", allocations: v.allocations });
      });
      toast(`${k.direction} ${money2(num(v.amount))} ${kind === "client" ? "from" : "to"} ${party?.name}`);
    },
  });
}

function partyStats(state, kind, party) {
  const k = KIND[kind];
  const docs = state[k.docs].filter((d) => d[k.docKey] === party.id);
  const billed = sumMoney(docs.map((d) => docTotals(d).total));
  return { count: docs.length, billed, owed: outstanding(state, k.side, party.id) };
}

function renderList(root, ctx, kind) {
  const k = KIND[kind];
  const state = ctx.state();
  const rows = () => ctx.state()[k.collection].map((p) => ({ id: p.id, party: p, ...partyStats(ctx.state(), kind, p) }));
  const all = rows();
  const totalOwed = sumMoney(all.map((r) => r.owed));
  const owing = all.filter((r) => r.owed > 0).length;
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: k.many,
        sub: kind === "client" ? "Customers you sell to and what they owe." : "Who you buy from and what you owe them.",
        actions: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Add ${k.one}</button>`,
      })}
      <div class="kpis">
        ${kpi({ label: k.owesKpi, value: ctx.money(totalOwed, { decimals: 0 }), ic: k.icon, tone: totalOwed ? "warn" : "good", sub: owing ? `${owing} with a balance` : "All settled" })}
        ${kpi({ label: k.many, value: all.filter((r) => r.party.active !== false).length, ic: "users" })}
        ${kpi({ label: kind === "client" ? "Invoiced in total" : "Purchased in total", value: ctx.money(sumMoney(all.map((r) => r.billed)), { decimals: 0 }), ic: "receipt" })}
      </div>
      <section class="card card-flush" data-table></section>
    </div>`);
  createTable($("[data-table]", root), {
    id: k.page, label: k.many,
    rows,
    defaultSort: { key: "name", dir: "asc" },
    search: { placeholder: `Search ${k.many.toLowerCase()}`, text: (r) => `${r.party.name} ${r.party.contact} ${r.party.phone} ${r.party.gstin}` },
    filters: [
      { key: "balance", label: "Any balance", options: [["owing", k.owesLabel], ["clear", "Nothing outstanding"]], test: (r, v) => (v === "owing") === (r.owed > 0) },
      { key: "active", label: "Active and inactive", options: [["active", "Active"], ["inactive", "Inactive"]], test: (r, v) => (v === "active") === (r.party.active !== false) },
    ],
    rowClass: (r) => (r.party.active === false ? "row-inactive" : ""),
    columns: [
      { key: "name", label: k.One, sortable: true, mobile: "title", value: (r) => r.party.name, render: (r) => html`<span class="cell-title"><a href="#/${k.page}/${r.party.id}">${r.party.name}</a></span>${r.party.contact ? html`<span class="cell-sub">${r.party.contact}</span>` : ""}` },
      { key: "phone", label: "Phone", mobile: "meta", value: (r) => r.party.phone, render: (r) => r.party.phone },
      { key: "gstin", label: "GSTIN", mobile: "hide", value: (r) => r.party.gstin, render: (r) => html`<span class="small num">${r.party.gstin || ""}</span>` },
      { key: "billed", label: kind === "client" ? "Invoiced" : "Purchased", align: "num", sortable: true, mobile: "detail", render: (r) => ctx.money(r.billed) },
      { key: "owed", label: k.owesLabel, align: "num", sortable: true, mobile: "amount", render: (r) => (r.owed > 0 ? html`<span class="strong text-warning">${ctx.money(r.owed)}</span>` : ctx.money(0)) },
      { key: "active", label: "Status", mobile: "hide", render: (r) => (r.party.active === false ? html`<span class="badge">Inactive</span>` : "") },
    ],
    totals: (list) => ({ name: "Total", billed: ctx.money(sumMoney(list.map((r) => r.billed))), owed: ctx.money(sumMoney(list.map((r) => r.owed))) }),
    actions: (r) => [
      ...(r.owed > 0 ? [{ label: k.settleVerb, icon: kind === "client" ? "arrow-in" : "arrow-out", primary: true, onClick: () => settleForm(ctx, kind, r.party.id) }] : []),
      { label: "Edit", icon: "edit", onClick: () => partyForm(ctx, kind, r.party) },
      { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, kind, r.party.id) },
    ],
    empty: { icon: k.icon, title: `No ${k.many.toLowerCase()} yet`, hint: kind === "client" ? "Add the customers you invoice or sell to on credit." : "Add the people and companies you buy from.", action: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Add ${k.one}</button>` },
  });
  on(root, "click", "[data-add]", () => partyForm(ctx, kind));
}

function renderDetail(root, ctx, kind, id) {
  const k = KIND[kind];
  const state = ctx.state();
  const party = state[k.collection].find((p) => p.id === id);
  if (!party) {
    setHTML(root, html`<div class="page">${pageHead({ title: `${k.One} not found`, back: { page: k.page, label: k.many } })}<section class="card">${emptyState({ icon: k.icon, title: `This ${k.one} doesn't exist`, hint: "They may have been deleted. Check the Recycle Bin." })}</section></div>`);
    return;
  }
  const { owed, billed } = partyStats(state, kind, party);
  const money2 = (n) => ctx.money(n, { decimals: 2 });
  const docs = () => {
    const s = ctx.state();
    const documents = s[k.docs].filter((d) => d[k.docKey] === id).map((d) => {
      const t = docTotals(d);
      return { id: d.id, date: d.date, due: d.due, no: d.no || d.billNo || "", total: t.total, balance: t.balance, status: t.status, type: k.docOne, href: `#/${k.docs}/${d.id}` };
    });
    const entries = s.transactions.filter((t) => t.partyType === kind && t.partyId === id).map((t) => ({
      id: t.id, date: t.date, due: t.due, no: t.opening ? "Opening balance" : t.category, total: num(t.amount), balance: openDocs(s, k.side, { partyId: id }).find((o) => o.id === t.id)?.balance || 0,
      status: t.mode === "credit" ? "credit" : "paid", type: "entry", href: "",
    }));
    return [...documents, ...entries];
  };
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: party.name,
        back: { page: k.page, label: k.many },
        sub: [party.contact, party.phone].filter(Boolean).join(" · "),
        actions: html`
          ${owed > 0 ? html`<button type="button" class="btn btn-primary" data-settle>${icon(kind === "client" ? "arrow-in" : "arrow-out")}${k.settleVerb}</button>` : ""}
          ${party.phone ? html`<a class="btn" href="${whatsappUrl(party.phone)}" target="_blank" rel="noopener">${icon("message")}WhatsApp</a>` : ""}
          <button type="button" class="btn" data-edit>${icon("edit")}Edit</button>
          <button type="button" class="btn" data-delete>${icon("trash")}Delete</button>`,
      })}
      <div class="kpis">
        ${kpi({ label: k.owesLabel, value: ctx.money(owed), ic: k.icon, tone: owed ? "warn" : "good" })}
        ${kpi({ label: kind === "client" ? "Invoiced in total" : "Purchased in total", value: ctx.money(billed), ic: "receipt" })}
      </div>
      <section class="card">
        <dl class="facts">
          <div><dt>Contact</dt><dd>${party.contact || "—"}</dd></div>
          <div><dt>Phone</dt><dd>${party.phone || "—"}</dd></div>
          <div><dt>Email</dt><dd>${party.email || "—"}</dd></div>
          <div><dt>GSTIN</dt><dd>${party.gstin || "—"}</dd></div>
          <div><dt>Address</dt><dd>${party.address || "—"}</dd></div>
        </dl>
      </section>
      <section class="card card-flush">
        <div class="card-head card-head-pad"><h2>History</h2></div>
        <div data-history></div>
      </section>
    </div>`);
  createTable($("[data-history]", root), {
    id: `${k.page}-history`, label: "History",
    rows: docs,
    defaultSort: { key: "date", dir: "desc" },
    columns: [
      { key: "no", label: "Document", sortable: true, mobile: "title", render: (r) => (r.href ? html`<span class="cell-title"><a href="${r.href}">${r.no || k.docOne}</a></span>` : html`<span class="cell-title">${r.no}</span>`) },
      { key: "date", label: "Date", sortable: true, mobile: "meta", render: (r) => html`${formatDate(r.date)}${r.due ? html`<span class="cell-sub">Due ${formatDate(r.due)}</span>` : ""}` },
      { key: "total", label: "Total", align: "num", sortable: true, mobile: "amount", render: (r) => money2(r.total) },
      { key: "balance", label: "Balance", align: "num", sortable: true, render: (r) => money2(r.balance) },
    ],
    empty: { icon: "receipt", title: "Nothing recorded yet", hint: `${k.docOne === "invoice" ? "Invoices" : "Purchases"} and credit entries with ${party.name} show here.` },
  });
  on(root, "click", "[data-settle]", () => settleForm(ctx, kind, id));
  on(root, "click", "[data-edit]", () => partyForm(ctx, kind, party));
  on(root, "click", "[data-delete]", () => confirmDelete(ctx, kind, id, { onDeleted: () => ctx.navigate(k.page) }));
}

const makePage = (kind) => ({
  id: KIND[kind].page,
  title: KIND[kind].many,
  render(root, ctx, params) {
    if (params[0]) renderDetail(root, ctx, kind, params[0]);
    else renderList(root, ctx, kind);
  },
});

export const clients = makePage("client");
export const suppliers = makePage("supplier");
