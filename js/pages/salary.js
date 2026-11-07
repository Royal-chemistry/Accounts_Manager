// The salary sheet: what everyone earned, marking it paid, payslips and payout lists.
import { toCSV } from "../core/csv.js";
import { formatDate, monthLabel } from "../core/dates.js";
import { uid } from "../core/ids.js";
import { sumMoney } from "../core/money.js";
import { payoutRows, payrollRows, salarySheetRows, totals, whatsappSummary } from "../core/payroll.js";
import { $, downloadFile, html, on, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { openMenu } from "../ui/menu.js";
import { openModal } from "../ui/modal.js";
import { docHead, printDocument, signature, wordsLine } from "../ui/print.js";
import { createTable } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { applyPayment, paymentField } from "./_money.js";

const STATUS = {
  paid: ["success", "Paid"], unpaid: ["warning", "Unpaid"], hold: ["info", "On hold"], none: ["", "Nothing to pay"],
};
const statusBadge = (r) => {
  const [tone, label] = STATUS[r.status];
  return html`<span class="badge ${tone ? `badge-${tone}` : ""}">${label}${r.paid ? ` ${formatDate(r.paid.date)}` : ""}</span>`;
};

function markPaid(ctx, rows, month) {
  const total = sumMoney(rows.map((r) => r.pay.net));
  const money = ctx.money;
  openForm({
    ctx,
    title: rows.length > 1 ? `Mark ${rows.length} salaries paid` : `Pay ${rows[0].staff.name}`,
    intro: `${monthLabel(month)}. Total ${money(total)}.`,
    values: { date: ctx.today() },
    submitLabel: "Mark paid",
    fields: [
      { k: "date", label: "Paid on", type: "date", required: true },
      paymentField("salary", { label: "How was it paid?" }),
    ],
    onSubmit(v) {
      ctx.store.update((s) => {
        for (const r of rows) {
          s.salaryPayments.push(applyPayment({ id: uid(), staffId: r.staff.id, month, date: v.date, amount: r.pay.net }, v.payment));
        }
      });
      toast(rows.length > 1 ? `${rows.length} salaries marked paid` : `${rows[0].staff.name} marked paid`);
    },
  });
}

function setHold(ctx, row, month, hold) {
  ctx.store.update((s) => {
    s.entries[month] ??= {};
    s.entries[month][row.staff.id] ??= {};
    s.entries[month][row.staff.id].hold = hold;
  });
  toast(hold ? `${row.staff.name} is on hold` : `${row.staff.name} released`);
}

export function payslip(state, row, month, money) {
  const { staff, pay } = row;
  const currency = state.profile.currency;
  const earnings = [["Basic pay", pay.base], ...[["Extra shifts", pay.extra], ["Bonus", pay.bonus]].filter(([, v]) => v)];
  const deductions = [["Advance", pay.advance], ["Food", pay.food], ["Kit", pay.kit], ["PF", pay.pf], ["ESI", pay.esi], ["Other", pay.other]].filter(([, v]) => v);
  const lines = Math.max(earnings.length, deductions.length);
  return html`
    <section class="doc">
      ${docHead(state, { title: "Payslip", lines: [monthLabel(month)] })}
      <table class="doc-table">
        <tr><th>Name</th><td>${staff.name}</td><th>Code</th><td>${staff.code || "—"}</td></tr>
        <tr><th>Team</th><td>${staff.team || "—"}</td><th>Position</th><td>${staff.position || "—"}</td></tr>
        <tr><th>Monthly salary</th><td>${money(staff.salary || 0)}</td><th>Days worked</th><td>${pay.days} (${money(pay.rate)} a day)</td></tr>
        <tr><th>Account</th><td>${[staff.account, staff.ifsc].filter(Boolean).join(" · ") || "—"}</td><th>UPI</th><td>${staff.upi || "—"}</td></tr>
      </table>
      <table class="doc-table">
        <thead><tr><th>Earnings</th><th class="num">Amount</th><th>Deductions</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${Array.from({ length: lines }, (_, i) => html`<tr>
            <td>${earnings[i]?.[0] || ""}</td><td class="num">${earnings[i] ? money(earnings[i][1]) : ""}</td>
            <td>${deductions[i]?.[0] || ""}</td><td class="num">${deductions[i] ? money(deductions[i][1]) : ""}</td>
          </tr>`)}
          <tr class="total"><td>Gross</td><td class="num">${money(pay.gross)}</td><td>Total deductions</td><td class="num">${money(pay.deductions)}</td></tr>
          <tr class="total"><td colspan="3">Net pay</td><td class="num">${money(pay.net)}</td></tr>
        </tbody>
      </table>
      <p class="doc-words">${wordsLine(pay.net, currency)}.</p>
      <div class="doc-signs">${signature("Employee signature")}${signature(`For ${state.profile.name || "the employer"}`)}</div>
    </section>`;
}

async function copySummary(ctx, rows, month) {
  const state = ctx.state();
  const text = whatsappSummary(rows, { business: state.profile.name, monthName: monthLabel(month), money: (n) => ctx.money(n, { decimals: 0 }) });
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it into WhatsApp");
  } catch {
    const m = openModal({
      title: "Copy this summary", size: "sm",
      body: html`<label class="field-label" for="wa-text">Select the text and copy it</label><textarea class="input" id="wa-text" rows="10" readonly>${text}</textarea>`,
      foot: html`<button type="button" class="btn btn-primary" data-modal-close>Done</button>`,
    });
    $("#wa-text", m.dialog).select();
  }
}

export default {
  id: "salary",
  title: "Salary sheet",
  render(root, ctx) {
    const state = ctx.state();
    const month = state.settings.month;
    const rows = () => payrollRows(ctx.state(), month).map((r) => ({ ...r, id: r.staff.id }));
    const all = rows();
    const t = totals(all.map((r) => r.pay));
    const payable = all.filter((r) => r.pay.net > 0);
    const paidAmt = sumMoney(payable.filter((r) => r.paid).map((r) => r.pay.net));
    const toPay = sumMoney(payable.filter((r) => r.status === "unpaid").map((r) => r.pay.net));
    const held = sumMoney(payable.filter((r) => r.status === "hold").map((r) => r.pay.net));
    const owing = all.filter((r) => r.pay.net < 0);
    const byTeam = {};
    for (const r of all) {
      const k = r.staff.team || "No team";
      byTeam[k] ??= { n: 0, days: 0, net: 0 };
      byTeam[k].n++; byTeam[k].days += r.pay.days; byTeam[k].net += r.pay.net;
    }
    const teams = Object.keys(byTeam).sort();

    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Salary sheet",
          sub: `${monthLabel(month)}. Pay basis: ${state.settings.pay.basis === "calendar" ? "salary ÷ days in the month" : `salary ÷ ${state.settings.pay.basis}`}.`,
          actions: html`
            <a class="btn" href="#/attendance/pay">${icon("edit")}Pay sheet</a>
            <button type="button" class="btn" data-export aria-haspopup="menu" aria-expanded="false">${icon("download")}Export${icon("chevron-down", { cls: "icon-sm" })}</button>
            <button type="button" class="btn" data-print-all>${icon("printer")}Print payslips</button>
            <button type="button" class="btn btn-primary" data-pay-all>${icon("check")}Mark all paid</button>`,
        })}
        <div class="kpis">
          ${kpi({ label: "Staff", value: all.length, ic: "users", sub: `${t.days} days worked` })}
          ${kpi({ label: "Gross pay", value: ctx.money(t.gross, { decimals: 0 }), ic: "wallet", sub: `Deductions ${ctx.money(t.deductions, { decimals: 0 })}` })}
          ${kpi({ label: "Paid", value: ctx.money(paidAmt, { decimals: 0 }), ic: "check-circle", tone: paidAmt ? "good" : "" })}
          ${kpi({ label: "Still to pay", value: ctx.money(toPay, { decimals: 0 }), ic: "clock", tone: toPay ? "warn" : "good", sub: held ? `${ctx.money(held, { decimals: 0 })} on hold` : "" })}
        </div>
        ${owing.length ? html`<div class="banner banner-warning">${icon("alert")}<p>${owing.map((r) => r.staff.name).join(", ")} ${owing.length > 1 ? "owe" : "owes"} you money this month because deductions are more than pay, so they're left out of the payout.</p></div>` : ""}
        <section class="card card-flush" data-table></section>
        ${teams.length > 1 ? html`
          <section class="card">
            <h2 class="card-title">By team</h2>
            <div class="lines">
              ${teams.map((k) => html`<div class="line"><span class="line-label">${k} · ${byTeam[k].n} staff · ${byTeam[k].days} days</span><span class="line-value">${ctx.money(byTeam[k].net)}</span></div>`)}
            </div>
          </section>` : ""}
      </div>`);

    const money = (n) => ctx.money(n);
    const payColumn = ([key, label]) => ({ key, label, align: "num", value: (r) => r.pay[key], isZero: (r) => !r.pay[key], render: (r) => money(r.pay[key]) });
    createTable($("[data-table]", root), {
      id: "salary", label: `Salary sheet for ${monthLabel(month)}`,
      rows,
      defaultSort: { key: "name", dir: "asc" },
      search: { placeholder: "Search by name or team", text: (r) => `${r.staff.name} ${r.staff.team}` },
      filters: [
        ...(teams.length > 1 ? [{ key: "team", label: "All teams", options: teams.map((x) => [x, x]), test: (r, v) => (r.staff.team || "No team") === v }] : []),
        { key: "status", label: "All statuses", options: Object.entries(STATUS).map(([k, [, l]]) => [k, l]), test: (r, v) => r.status === v },
      ],
      columns: [
        { key: "name", label: "Staff", sortable: true, mobile: "title", value: (r) => r.staff.name, render: (r) => html`<span class="cell-title"><a href="#/staff/${r.staff.id}">${r.staff.name || "(no name)"}</a></span><span class="cell-sub">${r.staff.team}</span>` },
        { key: "days", label: "Days", align: "num", sortable: true, value: (r) => r.pay.days, render: (r) => r.pay.days },
        { key: "earned", label: "Earned", align: "num", value: (r) => r.pay.base, render: (r) => money(r.pay.base) },
        // Columns that are zero for everyone are left out, so the sheet stays readable.
        ...[["extra", "Extra"], ["bonus", "Bonus"]].filter(([k]) => all.some((r) => r.pay[k])).map(payColumn),
        { key: "gross", label: "Gross", align: "num", sortable: true, value: (r) => r.pay.gross, render: (r) => money(r.pay.gross) },
        ...[["advance", "Advance"], ["food", "Food"], ["kit", "Kit"], ["other", "Other"], ["pf", "PF"], ["esi", "ESI"]].filter(([k]) => all.some((r) => r.pay[k])).map(payColumn),
        { key: "net", label: "Net pay", align: "num", sortable: true, mobile: "amount", value: (r) => r.pay.net, render: (r) => html`<span class="strong ${r.pay.net < 0 ? "text-danger" : ""}">${money(r.pay.net)}</span>` },
        { key: "status", label: "Status", sortable: true, mobile: "status", value: (r) => r.status, render: statusBadge },
      ],
      totals: (list) => {
        const x = totals(list.map((r) => r.pay));
        return { name: `${list.length} staff`, days: x.days, earned: money(x.base), extra: money(x.extra), bonus: money(x.bonus), gross: money(x.gross), advance: money(x.advance), food: money(x.food), kit: money(x.kit), other: money(x.other), pf: money(x.pf), esi: money(x.esi), net: money(x.net) };
      },
      actions: (r) => {
        const items = [];
        if (r.status === "unpaid") items.push({ label: "Pay", icon: "check", primary: true, onClick: () => markPaid(ctx, [r], month) });
        if (r.status === "hold") items.push({ label: "Release", icon: "undo", primary: true, onClick: () => setHold(ctx, r, month, false) });
        items.push({ label: "Print payslip", icon: "printer", menu: true, onClick: () => printDocument(payslip(ctx.state(), r, month, money), { title: `Payslip ${r.staff.name} ${monthLabel(month)}` }) });
        if (r.status === "unpaid") items.push({ label: "Put on hold", icon: "pause", onClick: () => setHold(ctx, r, month, true) });
        if (r.paid) items.push({ label: "Undo payment", icon: "undo", danger: true, onClick: () => confirmDelete(ctx, "salaryPayment", r.paid.id, { verb: "Undo payment" }) });
        return items;
      },
      empty: { icon: "sheet", title: "No staff to pay", hint: "Add staff, then fill in the pay sheet.", action: html`<a class="btn btn-primary" href="#/staff">${icon("plus")}Go to Staff</a>` },
    });

    on(root, "click", "[data-pay-all]", () => {
      const list = rows().filter((r) => r.status === "unpaid");
      if (!list.length) { toast("Nobody is waiting to be paid", { kind: "info" }); return; }
      markPaid(ctx, list, month);
    });
    on(root, "click", "[data-print-all]", () => {
      const list = rows();
      if (!list.length) { toast("Add staff first", { kind: "info" }); return; }
      printDocument(html`${list.map((r) => payslip(ctx.state(), r, month, money))}`, { title: `Payslips ${monthLabel(month)}` });
    });
    on(root, "click", "[data-export]", (e, b) => openMenu(b, [
      { label: "Salary sheet (CSV)", icon: "sheet", onSelect: () => downloadFile(`salary-sheet-${month}.csv`, toCSV(salarySheetRows(rows()))) },
      {
        label: "Bank payout list (CSV)", icon: "bank",
        onSelect: () => {
          const list = rows();
          downloadFile(`payout-list-${month}.csv`, toCSV(payoutRows(list, `Salary ${monthLabel(month)}`)));
          const missing = list.filter((r) => r.status === "unpaid" && !r.staff.account && !r.staff.upi).length;
          if (missing) toast(`${missing} ${missing > 1 ? "people have" : "person has"} no account or UPI ID. Add them under Staff`, { kind: "info", duration: 8000 });
        },
      },
      { label: "Copy WhatsApp summary", icon: "message", onSelect: () => copySummary(ctx, rows(), month) },
    ], { label: "Export" }));
  },
};
