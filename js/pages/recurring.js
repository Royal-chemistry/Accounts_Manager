// Recurring payments: rent, subscriptions and anything else that comes round again.
import { formatDate, monthLabel, monthOf } from "../core/dates.js";
import { uid } from "../core/ids.js";
import { num, round2, sumMoney } from "../core/money.js";
import { cycleStatus, FREQUENCIES, monthlyEquivalent } from "../core/recurring.js";
import { $, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { openModal } from "../ui/modal.js";
import { monthOptions } from "../ui/month-picker.js";
import { paymentLabel } from "../ui/payment-field.js";
import { createTable } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentField } from "./_money.js";

function recurringForm(ctx, item = null) {
  const state = ctx.state();
  openForm({
    ctx,
    title: item ? `Edit ${item.name}` : "Add recurring payment",
    values: item
      ? { ...item, payment: { mode: item.mode, accountId: item.accountId } }
      : { frequency: "monthly", dueDay: 5, startMonth: monthOf(ctx.today()), active: true },
    fields: [
      { k: "name", label: "Name", required: true, full: true, placeholder: "e.g. Shop rent" },
      { k: "category", label: "Category", type: "text-list", list: state.categories.expense, required: true },
      { k: "amount", label: "Amount", type: "money", required: true },
      { k: "frequency", label: "How often", type: "select", options: Object.entries(FREQUENCIES).map(([k, f]) => [k, f.label]) },
      { k: "dueDay", label: "Due day of the month", type: "number", required: true, max: 31, hint: "Short months use their last day.", validate: (v) => (Number(v) < 1 ? "Enter a day from 1 to 31" : "") },
      { k: "startMonth", label: "First due in", type: "select", required: true, options: monthOptions(item?.startMonth || monthOf(ctx.today()), ctx.today()).map((m) => [m, monthLabel(m)]) },
      { k: "variable", label: "The amount changes each time, like an electricity bill", type: "checkbox", full: true },
      paymentField("recurring", { label: "Usually paid by" }),
      { k: "note", label: "Note", full: true },
      ...(item ? [{ k: "active", label: "Active (untick to pause reminders)", type: "checkbox", full: true }] : []),
    ],
    onSubmit(v) {
      const category = String(v.category).trim();
      const data = {
        name: v.name.trim(), category, amount: num(v.amount), frequency: v.frequency, dueDay: Math.min(31, Math.max(1, Math.round(num(v.dueDay)) || 1)),
        startMonth: v.startMonth, variable: !!v.variable, note: v.note || "",
      };
      ctx.store.update((s) => {
        if (!s.categories.expense.some((c) => c.toLowerCase() === category.toLowerCase())) s.categories.expense.push(category);
        if (item) {
          const doc = s.recurring.find((r) => r.id === item.id);
          Object.assign(doc, data, { active: v.active !== false });
          doc.mode = v.payment.mode; doc.accountId = v.payment.accountId;
        } else {
          s.recurring.push({ id: uid(), ...data, active: true, paid: {}, mode: v.payment.mode, accountId: v.payment.accountId });
        }
      });
      toast(item ? "Saved" : `${data.name} added`);
    },
  });
}

function payForm(ctx, item) {
  const status = cycleStatus(item, ctx.today());
  openForm({
    ctx,
    title: `Pay ${item.name}`,
    intro: `For ${monthLabel(status.month)}, due ${formatDate(status.due)}.${item.variable ? " This amount varies, so check it matches the bill." : ""}`,
    values: { date: ctx.today(), amount: item.amount, payment: { mode: item.mode, accountId: item.accountId } },
    submitLabel: "Mark paid",
    fields: [
      { k: "date", label: "Paid on", type: "date", required: true },
      { k: "amount", label: "Amount", type: "money", required: true },
      paymentField("recurring-pay", { label: "How was it paid?" }),
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        const id = uid();
        s.transactions.push(applyPayment({
          id, type: "expense", date: v.date, category: item.category || "Recurring", note: item.name, amount: num(v.amount), gstAmount: 0, scope: "business",
          partyType: null, partyId: null, due: "", recurringId: item.id, stockLine: null, payments: [],
        }, v.payment));
        const doc = s.recurring.find((r) => r.id === item.id);
        doc.paid ??= {};
        doc.paid[status.month] = id;
      });
      toast(`${item.name} paid and added to the cash book`);
    },
  });
}

function showHistory(ctx, item) {
  const state = ctx.state();
  const entries = state.transactions.filter((t) => t.recurringId === item.id).sort((a, b) => b.date.localeCompare(a.date));
  openModal({
    title: `${item.name}: payments`, size: "sm",
    body: entries.length
      ? html`<div class="lines">${entries.map((t) => html`<div class="line"><span class="line-label">${formatDate(t.date)} · ${paymentLabel(state, t)}</span><span class="line-value">${ctx.money(t.amount)}</span></div>`)}</div>`
      : html`<p class="muted">No payments recorded yet.</p>`,
    foot: html`<button type="button" class="btn btn-primary" data-modal-close>Done</button>`,
  });
}

const statusBadge = (r) => {
  if (r.item.active === false) return html`<span class="badge">Paused</span>`;
  if (r.status.overdue) return html`<span class="badge badge-danger">Overdue ${Math.abs(r.status.days)} ${Math.abs(r.status.days) === 1 ? "day" : "days"}</span>`;
  if (r.status.days === 0) return html`<span class="badge badge-warning">Due today</span>`;
  if (r.status.soon) return html`<span class="badge badge-warning">Due in ${r.status.days} ${r.status.days === 1 ? "day" : "days"}</span>`;
  return html`<span class="badge badge-success">Up to date</span>`;
};

export default {
  id: "recurring",
  title: "Recurring",
  render(root, ctx) {
    const today = ctx.today();
    const rows = () => ctx.state().recurring.map((item) => ({ id: item.id, item, status: cycleStatus(item, today) }));
    const all = rows();
    const active = all.filter((r) => r.item.active !== false);
    const overdue = active.filter((r) => r.status.overdue);
    const soon = active.filter((r) => r.status.soon);
    const next = active.filter((r) => !r.status.overdue).sort((a, b) => a.status.due.localeCompare(b.status.due))[0];
    const perMonth = round2(active.reduce((t, r) => t + monthlyEquivalent(r.item.amount, r.item.frequency), 0));
    const money = (n) => ctx.money(n);
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Recurring payments",
          sub: "Rent, subscriptions, bills and anything else that comes round again.",
          actions: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Add recurring payment</button>`,
        })}
        <div class="kpis">
          ${kpi({ label: "About each month", value: ctx.money(perMonth, { decimals: 0 }), ic: "repeat", sub: `${ctx.money(perMonth * 12, { decimals: 0 })} a year` })}
          ${kpi({ label: "Overdue", value: overdue.length, ic: "alert", tone: overdue.length ? "bad" : "", sub: overdue.length ? ctx.money(sumMoney(overdue.map((r) => r.item.amount)), { decimals: 0 }) : "" })}
          ${kpi({ label: "Due in 7 days", value: soon.length, ic: "clock", tone: soon.length ? "warn" : "", sub: soon.length ? ctx.money(sumMoney(soon.map((r) => r.item.amount)), { decimals: 0 }) : "" })}
          ${kpi({ label: "Next due", value: next ? formatDate(next.status.due) : "—", ic: "attendance", sub: next ? `${next.item.name}, ${ctx.money(next.item.amount, { decimals: 0 })}` : "" })}
        </div>
        <section class="card card-flush" data-table></section>
      </div>`);
    createTable($("[data-table]", root), {
      id: "recurring", label: "Recurring payments",
      rows,
      defaultSort: { key: "due", dir: "asc" },
      search: { placeholder: "Search recurring payments", text: (r) => `${r.item.name} ${r.item.category} ${r.item.note}` },
      filters: [{
        key: "state", label: "All", options: [["overdue", "Overdue"], ["soon", "Due in 7 days"], ["paused", "Paused"]],
        test: (r, v) => (v === "paused" ? r.item.active === false : r.item.active !== false && (v === "overdue" ? r.status.overdue : r.status.soon)),
      }],
      rowClass: (r) => (r.item.active === false ? "row-inactive" : ""),
      columns: [
        { key: "name", label: "Name", sortable: true, mobile: "title", value: (r) => r.item.name, render: (r) => html`<span class="cell-title">${r.item.name}</span><span class="cell-sub">${r.item.category}${r.item.variable ? " · Varies" : ""}${r.item.note ? ` · ${r.item.note}` : ""}</span>` },
        { key: "due", label: "Next due", sortable: true, mobile: "meta", value: (r) => r.status.due, render: (r) => formatDate(r.status.due) },
        { key: "frequency", label: "How often", mobile: "meta", value: (r) => r.item.frequency, render: (r) => FREQUENCIES[r.item.frequency]?.label || "Every month" },
        { key: "how", label: "Paid by", mobile: "hide", render: (r) => html`<span class="small">${paymentLabel(ctx.state(), r.item)}</span>` },
        { key: "amount", label: "Amount", align: "num", sortable: true, mobile: "amount", value: (r) => r.item.amount, render: (r) => money(r.item.amount) },
        { key: "status", label: "Status", sortable: true, mobile: "status", value: (r) => r.status.days, render: statusBadge },
      ],
      actions: (r) => [
        ...(r.item.active !== false ? [{ label: "Pay", icon: "check", primary: true, onClick: () => payForm(ctx, r.item) }] : []),
        { label: "Payment history", icon: "clock", menu: true, onClick: () => showHistory(ctx, r.item) },
        { label: "Edit", icon: "edit", onClick: () => recurringForm(ctx, r.item) },
        {
          label: r.item.active === false ? "Resume" : "Pause", icon: r.item.active === false ? "undo" : "pause",
          onClick: () => { const on = r.item.active === false; ctx.store.update((s) => { s.recurring.find((x) => x.id === r.item.id).active = on; }); toast(`${r.item.name} ${on ? "resumed" : "paused"}`); },
        },
        { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "recurring", r.item.id) },
      ],
      empty: { icon: "repeat", title: "No recurring payments yet", hint: "Add rent, subscriptions and bills, and you'll see what's coming up.", action: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Add recurring payment</button>` },
    });
    on(root, "click", "[data-add]", () => recurringForm(ctx));
  },
};
