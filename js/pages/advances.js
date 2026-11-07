// Advances: money given to staff before payday. It comes off that month's pay automatically.
import { formatDate, monthLabel, monthOf, dayInMonth } from "../core/dates.js";
import { uid } from "../core/ids.js";
import { num, sumMoney } from "../core/money.js";
import { $, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { createTable } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentCell, paymentField } from "./_money.js";

function advanceForm(ctx, advance = null) {
  const state = ctx.state();
  const people = state.staff.filter((s) => s.active !== false || s.id === advance?.staffId);
  if (!people.length) { toast("Add staff first", { kind: "info" }); ctx.navigate("staff"); return; }
  const month = state.settings.month;
  const defaultDate = monthOf(ctx.today()) === month ? ctx.today() : dayInMonth(month, 1);
  openForm({
    ctx,
    title: advance ? "Edit advance" : "Record advance",
    values: advance ? { ...advance, payment: { mode: advance.mode, accountId: advance.accountId, untracked: advance.untracked } } : { date: defaultDate },
    fields: [
      { k: "staffId", label: "Staff", type: "select", required: true, full: true, options: [["", "Choose a person"], ...people.map((s) => [s.id, [s.name, s.team].filter(Boolean).join(" · ")])] },
      { k: "date", label: "Date", type: "date", required: true },
      { k: "amount", label: "Amount", type: "money", required: true },
      paymentField("advance", { label: "How was it paid?" }),
      { k: "note", label: "Note", full: true },
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        const data = { staffId: v.staffId, date: v.date, amount: num(v.amount), note: v.note || "" };
        if (advance) applyPayment(Object.assign(s.advances.find((x) => x.id === advance.id), data), v.payment);
        else s.advances.push(applyPayment({ id: uid(), ...data }, v.payment));
      });
      toast(`Advance saved. It comes off ${monthLabel(monthOf(v.date))} pay`);
    },
  });
}

export default {
  id: "advances",
  title: "Advances",
  render(root, ctx) {
    const state = ctx.state();
    const month = state.settings.month;
    const rows = () => ctx.state().advances.filter((a) => monthOf(a.date) === month);
    const name = (id) => ctx.state().staff.find((s) => s.id === id)?.name || "(removed)";
    const team = (id) => ctx.state().staff.find((s) => s.id === id)?.team || "";
    const list = rows();
    const total = sumMoney(list.map((a) => a.amount));
    const byPerson = {};
    for (const a of list) byPerson[a.staffId] = (byPerson[a.staffId] || 0) + num(a.amount);
    const largest = Object.entries(byPerson).sort((a, b) => b[1] - a[1])[0];
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Advances",
          sub: `${monthLabel(month)}. Money given before payday comes off that month's pay automatically.`,
          actions: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Record advance</button>`,
        })}
        <div class="kpis">
          ${kpi({ label: "Given this month", value: ctx.money(total, { decimals: 0 }), ic: "wallet", tone: total ? "warn" : "" })}
          ${kpi({ label: "People", value: Object.keys(byPerson).length, ic: "users", sub: `${list.length} ${list.length === 1 ? "entry" : "entries"}` })}
          ${kpi({ label: "Largest", value: largest ? ctx.money(largest[1], { decimals: 0 }) : "—", ic: "chart", sub: largest ? name(largest[0]) : "" })}
        </div>
        <section class="card card-flush" data-table></section>
      </div>`);
    createTable($("[data-table]", root), {
      id: "advances", label: `Advances for ${monthLabel(month)}`,
      rows,
      defaultSort: { key: "date", dir: "desc" },
      search: { placeholder: "Search by name or note", text: (a) => `${name(a.staffId)} ${a.note} ${team(a.staffId)}` },
      columns: [
        { key: "date", label: "Date", sortable: true, mobile: "meta", render: (a) => formatDate(a.date) },
        { key: "staff", label: "Staff", sortable: true, mobile: "title", value: (a) => name(a.staffId), render: (a) => html`<span class="cell-title">${name(a.staffId)}</span><span class="cell-sub">${team(a.staffId)}</span>` },
        { key: "paid", label: "Paid by", mobile: "meta", render: (a) => paymentCell(ctx.state(), a) },
        { key: "note", label: "Note", mobile: "meta" },
        { key: "amount", label: "Amount", align: "num", sortable: true, mobile: "amount", value: (a) => num(a.amount), render: (a) => ctx.money(a.amount) },
      ],
      totals: (all) => ({ staff: "Total", amount: ctx.money(sumMoney(all.map((a) => a.amount))) }),
      actions: (a) => [
        { label: "Edit", icon: "edit", onClick: () => advanceForm(ctx, a) },
        { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "advance", a.id) },
      ],
      empty: { icon: "wallet", title: `No advances in ${monthLabel(month)}`, hint: "Record money given to staff before payday, and it comes off their pay.", action: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Record advance</button>` },
    });
    on(root, "click", "[data-add]", () => advanceForm(ctx));
  },
};
