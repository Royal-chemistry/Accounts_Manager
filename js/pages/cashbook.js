// The cash book: everyday income and expenses, by category and account, with a monthly picture.
import { toCSV } from "../core/csv.js";
import { dayInMonth, formatDate, monthEnd, monthLabel, monthOf, monthStart } from "../core/dates.js";
import { txBalance } from "../core/documents.js";
import { uid } from "../core/ids.js";
import { partyName } from "../core/ledger.js";
import { num, round2, sumMoney } from "../core/money.js";
import { profitLoss } from "../core/reports.js";
import { $, downloadFile, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { paymentLabel } from "../ui/payment-field.js";
import { createTable } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentField } from "./_money.js";
import { settleForm } from "./parties.js";

const defaultDate = (ctx) => {
  const month = ctx.state().settings.month;
  return monthOf(ctx.today()) === month ? ctx.today() : dayInMonth(month, 1);
};

/** Opens the form for a new or existing income or expense entry. */
export function entryForm(ctx, type, entry = null, preset = {}) {
  const state = ctx.state();
  const income = type === "income";
  const parties = income ? state.clients : state.suppliers;
  const partyType = income ? "client" : "supplier";
  const active = parties.filter((p) => p.active !== false || p.id === entry?.partyId);
  const hasPayments = !!entry?.payments?.length;
  const gstOn = state.settings.modules?.gst !== false;
  openForm({
    ctx,
    title: entry ? `Edit ${income ? "income" : "expense"}` : income ? "Add sale or income" : "Add expense",
    againLabel: entry ? null : "Save and add another",
    values: entry
      ? { ...entry, gstAmount: entry.gstAmount || "", personal: entry.scope === "personal", payment: { mode: entry.mode, accountId: entry.accountId, untracked: entry.untracked, due: entry.due } }
      : { date: preset.date || defaultDate(ctx), category: preset.category || "" },
    fields: [
      { k: "date", label: "Date", type: "date", required: true },
      { k: "amount", label: gstOn ? "Amount, including any GST" : "Amount", type: "money", required: true },
      { k: "category", label: "Category", type: "text-list", required: true, list: income ? state.categories.income : state.categories.expense, hint: "Pick one, or type a new one." },
      { k: "partyId", label: income ? "Client" : "Supplier", type: "select", options: [["", "None"], ...active.map((p) => [p.id, p.name])], hint: "Needed if it's on credit." },
      ...(gstOn ? [{ k: "gstAmount", label: "GST included", type: "money", allowZero: true, hint: "Counted in your GST summary, and left out of profit.", validate: (v, all) => (num(v) > num(all.amount) ? "GST can't be more than the amount" : "") }] : []),
      { k: "note", label: "Note", full: !gstOn },
      ...(hasPayments ? [{ type: "note", k: "paidNote", body: `${entry.payments.length} ${entry.payments.length === 1 ? "payment has" : "payments have"} been made against this, so it stays on credit.` }] : [paymentField(`entry-${type}`, { allowCredit: true, label: income ? "How was it received?" : "How was it paid?", creditNeedsParty: "partyId" })]),
      ...(income ? [] : [{ k: "personal", label: "This is personal, not a business cost", type: "checkbox", full: true, hint: "It still comes out of the account, but stays out of profit." }]),
    ],
    onSubmit(v, api) {
      const category = String(v.category).trim();
      const data = {
        type, date: v.date, category, note: v.note || "", amount: num(v.amount), gstAmount: num(v.gstAmount),
        scope: v.personal ? "personal" : "business", partyType: v.partyId ? partyType : null, partyId: v.partyId || null,
      };
      ctx.store.update((s) => {
        const list = income ? "income" : "expense";
        if (!s.categories[list].some((c) => c.toLowerCase() === category.toLowerCase())) s.categories[list].push(category);
        if (entry) {
          const doc = s.transactions.find((t) => t.id === entry.id);
          Object.assign(doc, data);
          if (!hasPayments) { applyPayment(doc, v.payment); doc.due = v.payment.due || ""; }
        } else {
          s.transactions.push(applyPayment({ id: uid(), ...data, due: v.payment.due || "", recurringId: null, stockLine: null, payments: [] }, v.payment));
        }
      });
      if (monthOf(v.date) !== ctx.state().settings.month && !entry) toast(`Saved in ${monthLabel(monthOf(v.date))}, which isn't the month on screen`, { kind: "info" });
      else toast(entry ? "Saved" : `${income ? "Income" : "Expense"} added`);
      if (api.again) setTimeout(() => entryForm(ctx, type, null, { date: v.date, category }), 0);
    },
  });
}

export default {
  id: "cashbook",
  title: "Cash book",
  render(root, ctx) {
    const state = ctx.state();
    const month = state.settings.month;
    const pl = profitLoss(state, { from: monthStart(month), to: monthEnd(month) });
    const rows = () => ctx.state().transactions.filter((t) => monthOf(t.date) === month && !t.opening);
    const all = rows();
    const moneyIn = sumMoney(all.filter((t) => t.type === "income").map((t) => t.amount));
    const moneyOut = sumMoney(all.filter((t) => t.type !== "income").map((t) => t.amount));
    const categories = [...new Set(all.map((t) => String(t.category || "").trim() || "Other"))].sort();
    const money = (n) => ctx.money(n);
    const byCategory = {};
    for (const t of all) {
      const k = String(t.category || "").trim() || "Other";
      byCategory[k] = round2((byCategory[k] || 0) + (t.type === "income" ? 1 : -1) * num(t.amount));
    }
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Cash book",
          sub: `${monthLabel(month)}. Everyday income and expenses. Salaries, advances, invoice receipts and loan payments are recorded on their own pages, so don't add them here too.`,
          actions: html`
            <button type="button" class="btn" data-csv>${icon("download")}CSV</button>
            <button type="button" class="btn" data-add-income>${icon("arrow-in")}Add income</button>
            <button type="button" class="btn btn-primary" data-add data-add-expense>${icon("arrow-out")}Add expense</button>`,
        })}
        <div class="kpis">
          ${kpi({ label: "Income in the cash book", value: ctx.money(moneyIn, { decimals: 0 }), ic: "arrow-in", tone: moneyIn ? "good" : "" })}
          ${kpi({ label: "Expenses in the cash book", value: ctx.money(moneyOut, { decimals: 0 }), ic: "arrow-out" })}
          ${kpi({ label: `Profit, ${monthLabel(month)}`, value: ctx.money(pl.netProfit, { decimals: 0 }), ic: "chart", tone: pl.netProfit < 0 ? "bad" : "good", href: "reports", sub: "Includes invoices and salaries" })}
        </div>
        <section class="card card-flush" data-table></section>
        ${categories.length ? html`
          <section class="card">
            <h2 class="card-title">By category</h2>
            <div class="lines">
              ${Object.entries(byCategory).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => html`<div class="line"><span class="line-label">${k}</span><span class="line-value ${v > 0 ? "text-success" : ""}">${v > 0 ? "+" : ""}${money(v)}</span></div>`)}
            </div>
          </section>` : ""}
      </div>`);
    const table = createTable($("[data-table]", root), {
      id: "cashbook", label: `Cash book for ${monthLabel(month)}`,
      rows,
      defaultSort: { key: "date", dir: "desc" },
      search: { placeholder: "Search category, note or party", text: (t) => `${t.category} ${t.note} ${t.partyId ? partyName(ctx.state(), t.partyType, t.partyId, t) : ""}` },
      filters: [
        { key: "type", label: "Income and expenses", options: [["income", "Income"], ["expense", "Expenses"]], test: (t, v) => t.type === v },
        ...(categories.length > 1 ? [{ key: "category", label: "All categories", options: categories.map((c) => [c, c]), test: (t, v) => (String(t.category || "").trim() || "Other") === v }] : []),
        { key: "mode", label: "All payment types", options: [["cash", "Cash"], ["bank", "Bank"], ["upi", "UPI"], ["credit", "Credit"]], test: (t, v) => t.mode === v },
      ],
      columns: [
        { key: "date", label: "Date", sortable: true, mobile: "meta", render: (t) => formatDate(t.date) },
        {
          key: "category", label: "Category", sortable: true, mobile: "title",
          render: (t) => html`<span class="cell-title">${t.category || "Other"}</span>${t.note ? html`<span class="cell-sub">${t.note}</span>` : ""}${t.scope === "personal" ? html`<span class="badge">Personal</span>` : ""}`,
        },
        { key: "party", label: "Party", sortable: true, mobile: "meta", value: (t) => (t.partyId ? partyName(ctx.state(), t.partyType, t.partyId, t) : ""), render: (t) => (t.partyId ? partyName(ctx.state(), t.partyType, t.partyId, t) : "") },
        {
          key: "how", label: "How", mobile: "meta", value: (t) => t.mode,
          render: (t) => {
            const owed = txBalance(t);
            if (t.mode !== "credit") return html`<span class="small">${paymentLabel(ctx.state(), t)}</span>`;
            return owed > 0 ? html`<span class="badge badge-warning">Credit, ${money(owed)} open</span>` : html`<span class="badge badge-success">Credit, settled</span>`;
          },
        },
        { key: "income", label: "Income", align: "num", sortable: true, value: (t) => (t.type === "income" ? num(t.amount) : ""), isZero: (t) => t.type !== "income", mobile: "amount", render: (t) => (t.type === "income" ? html`<span class="text-success">${money(t.amount)}</span>` : "") },
        { key: "expense", label: "Expense", align: "num", sortable: true, value: (t) => (t.type !== "income" ? num(t.amount) : ""), isZero: (t) => t.type === "income", mobile: "amount", render: (t) => (t.type !== "income" ? money(t.amount) : "") },
      ],
      totals: (list) => ({ category: "Total", income: money(sumMoney(list.filter((t) => t.type === "income").map((t) => t.amount))), expense: money(sumMoney(list.filter((t) => t.type !== "income").map((t) => t.amount))) }),
      actions: (t) => [
        ...(t.mode === "credit" && txBalance(t) > 0 && t.partyId ? [{ label: "Settle", icon: "check", primary: true, onClick: () => settleForm(ctx, t.partyType, t.partyId) }] : []),
        { label: "Edit", icon: "edit", onClick: () => entryForm(ctx, t.type === "income" ? "income" : "expense", t) },
        { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "transaction", t.id) },
      ],
      empty: { icon: "book", title: `No entries in ${monthLabel(month)}`, hint: "Add your income and expenses here as they happen.", action: html`<button type="button" class="btn btn-primary" data-add-expense>${icon("plus")}Add expense</button>` },
    });
    on(root, "click", "[data-add-expense]", () => entryForm(ctx, "expense"));
    on(root, "click", "[data-add-income]", () => entryForm(ctx, "income"));
    on(root, "click", "[data-csv]", () => {
      const list = table.visibleRows();
      downloadFile(`cash-book-${month}.csv`, toCSV([
        ["Date", "Type", "Category", "Note", "Party", "How", "Account", "Amount", "GST included", "Scope"],
        ...list.map((t) => [t.date, t.type, t.category, t.note, t.partyId ? partyName(ctx.state(), t.partyType, t.partyId, t) : "", t.mode, paymentLabel(ctx.state(), t), t.amount, t.gstAmount || 0, t.scope || "business"]),
      ]));
    });
  },
};
