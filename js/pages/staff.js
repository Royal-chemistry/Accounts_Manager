// Staff: everyone the business pays, with a detail page for each person.
import { parseCSV, toCSV } from "../core/csv.js";
import { formatDate, monthLabel } from "../core/dates.js";
import { uid } from "../core/ids.js";
import { sumMoney } from "../core/money.js";
import { attendanceSummary, payFor, salaryPaymentFor, staffFromCSV, staffTemplateRows } from "../core/payroll.js";
import { ifscError, phoneError, uniqueError } from "../core/validate.js";
import { withArt } from "../ui/artwork.js";
import { $, downloadFile, html, on, pickFile, setHTML } from "../ui/dom.js";
import { confirmDelete } from "../ui/confirm-delete.js";
import { openForm } from "../ui/form.js";
import { icon } from "../ui/icons.js";
import { openModal } from "../ui/modal.js";
import { createTable, emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";

const teams = (state) => [...new Set(state.staff.map((s) => s.team).filter(Boolean))].sort();
const whatsappUrl = (phone) => `https://wa.me/${String(phone).replace(/\D/g, "")}`;

function nextCode(state) {
  const nums = state.staff.map((s) => /^E(\d+)$/.exec(s.code || "")?.[1]).filter(Boolean).map(Number);
  return `E${String((nums.length ? Math.max(...nums) : state.staff.length) + 1).padStart(3, "0")}`;
}

export function staffForm(ctx, person = null) {
  const state = ctx.state();
  openForm({
    ctx,
    title: person ? `Edit ${person.name || "staff member"}` : "Add staff",
    values: person ? { ...person } : { code: nextCode(state), team: state.staff.at(-1)?.team || "", salary: state.staff.at(-1)?.salary ?? "", active: true },
    fields: [
      { k: "name", label: "Full name", required: true, full: true },
      { k: "code", label: "Staff code", validate: (v) => uniqueError(ctx.state().staff, "code", v, person?.id, "This code") },
      { k: "team", label: "Team or branch", type: "text-list", list: teams(state) },
      { k: "position", label: "Position" },
      { k: "joinedOn", label: "Joining date", type: "date" },
      { k: "salary", label: "Monthly salary", type: "money", required: true, allowZero: true },
      { k: "phone", label: "Phone", type: "tel", validate: (v) => phoneError(v) },
      { type: "section", label: "Payment details" },
      { k: "bank", label: "Bank" },
      { k: "account", label: "Account number" },
      { k: "ifsc", label: "IFSC", warn: (v) => ifscError(v), maxlength: 11 },
      { k: "upi", label: "UPI ID", placeholder: "name@upi" },
      ...(person ? [{ k: "active", label: "Active (shown on salary sheets)", type: "checkbox", full: true }] : []),
    ],
    onSubmit(v) {
      const doc = { ...v, ifsc: String(v.ifsc || "").toUpperCase(), salary: Number(v.salary) || 0 };
      delete doc.payment;
      ctx.store.update((s) => {
        if (person) Object.assign(s.staff.find((x) => x.id === person.id), doc);
        else s.staff.push({ id: uid(), active: true, ...doc });
      });
      toast(person ? "Saved" : `${v.name} added`);
    },
  });
}

async function importCSV(ctx) {
  const file = await pickFile(".csv,text/csv");
  if (!file) return;
  const { people, skipped } = staffFromCSV(parseCSV(await file.text()), uid);
  if (!people.length) { toast("No rows found. The CSV needs a Name column", { kind: "error", duration: 8000 }); return; }
  const existing = new Set(ctx.state().staff.map((s) => s.name.trim().toLowerCase()));
  const duplicates = people.filter((p) => existing.has(p.name.trim().toLowerCase())).length;
  const m = openModal({
    title: `Import ${people.length} ${people.length === 1 ? "person" : "people"}?`, size: "lg",
    body: html`
      <div class="stack">
        ${skipped ? html`<div class="banner banner-warning">${icon("alert")}<p>${skipped} ${skipped === 1 ? "row has" : "rows have"} no name and will be skipped.</p></div>` : ""}
        ${duplicates ? html`<div class="banner banner-warning">${icon("alert")}<p>${duplicates} ${duplicates === 1 ? "name is" : "names are"} already on your staff list, so you may get duplicates.</p></div>` : ""}
        <div class="table-wrap" tabindex="0" role="region" aria-label="Preview of the import">
          <table class="tbl" role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Name</th><th role="columnheader" scope="col">Team</th><th role="columnheader" scope="col" class="col-num">Salary</th><th role="columnheader" scope="col">Account</th><th role="columnheader" scope="col">Phone</th></tr></thead>
            <tbody role="rowgroup">${people.slice(0, 50).map((p) => html`<tr role="row"><td role="cell" data-mobile="title" class="cell-title">${p.name}</td><td role="cell" data-label="Team" data-mobile="meta">${p.team}</td><td role="cell" class="col-num" data-mobile="amount">${ctx.money(p.salary)}</td><td role="cell" data-label="Account" data-mobile="meta">${p.account}</td><td role="cell" data-label="Phone" data-mobile="meta">${p.phone}</td></tr>`)}</tbody>
          </table>
        </div>
        ${people.length > 50 ? html`<p class="small muted">Showing the first 50.</p>` : ""}
      </div>`,
    foot: html`<button type="button" class="btn" data-modal-close>Cancel</button><button type="button" class="btn btn-primary" data-confirm-import>Import ${people.length}</button>`,
  });
  $("[data-confirm-import]", m.dialog).addEventListener("click", () => {
    m.close();
    const ids = new Set(people.map((p) => p.id));
    ctx.store.update((s) => { s.staff.push(...people); });
    toast(`Imported ${people.length} ${people.length === 1 ? "person" : "people"}`, { action: { label: "Undo", onClick: () => ctx.store.update((s) => { s.staff = s.staff.filter((p) => !ids.has(p.id)); }) }, duration: 8000 });
  });
}

function renderList(root, ctx) {
  const state = ctx.state();
  const active = state.staff.filter((s) => s.active !== false);
  const bill = sumMoney(active.map((s) => s.salary));
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: "Staff",
        sub: "Everyone you pay.",
        actions: html`
          <button type="button" class="btn" data-import>${icon("upload")}Import CSV</button>
          <button type="button" class="btn" data-template>${icon("download")}CSV template</button>
          <button type="button" class="btn btn-primary" data-add>${icon("plus")}Add staff</button>`,
      })}
      <div class="kpis">
        ${kpi({ label: "Active staff", value: active.length, ic: "users", sub: state.staff.length > active.length ? `${state.staff.length - active.length} inactive` : "" })}
        ${kpi({ label: "Monthly salaries", value: ctx.money(bill, { decimals: 0 }), ic: "wallet" })}
        ${kpi({ label: "Teams", value: teams(state).length || "—", ic: "building" })}
      </div>
      <section class="card card-flush" data-table></section>
    </div>`);
  createTable($("[data-table]", root), {
    id: "staff", label: "Staff list",
    rows: () => ctx.state().staff,
    defaultSort: { key: "name", dir: "asc" },
    search: { placeholder: "Search by name, code, team or phone", text: (s) => `${s.name} ${s.code} ${s.team} ${s.position} ${s.phone}` },
    filters: [
      ...(teams(state).length ? [{ key: "team", label: "All teams", options: teams(state).map((t) => [t, t]), test: (s, v) => s.team === v }] : []),
      { key: "active", label: "Active and inactive", options: [["active", "Active"], ["inactive", "Inactive"]], test: (s, v) => (v === "active") === (s.active !== false) },
    ],
    rowClass: (s) => (s.active === false ? "row-inactive" : ""),
    columns: [
      { key: "name", label: "Name", sortable: true, mobile: "title", render: (s) => withArt(s.name, html`<span class="cell-title"><a href="#/staff/${s.id}">${s.name || "(no name)"}</a></span><span class="cell-sub">${[s.code, s.position].filter(Boolean).join(" · ")}</span>`) },
      { key: "team", label: "Team", sortable: true, mobile: "meta" },
      { key: "salary", label: "Monthly salary", align: "num", sortable: true, mobile: "amount", value: (s) => Number(s.salary) || 0, render: (s) => ctx.money(s.salary || 0) },
      { key: "payto", label: "Pay to", mobile: "meta", render: (s) => (s.account ? html`<span class="small num">A/c ${s.account}</span>` : s.upi ? html`<span class="small">${s.upi}</span>` : html`<span class="badge badge-warning">Missing</span>`) },
      { key: "phone", label: "Phone", mobile: "meta" },
      { key: "active", label: "Status", sortable: true, mobile: "status", value: (s) => (s.active !== false ? 0 : 1), render: (s) => (s.active === false ? html`<span class="badge">Inactive</span>` : html`<span class="badge badge-success">Active</span>`) },
    ],
    actions: (s) => [
      { label: "Edit", icon: "edit", primary: false, onClick: () => staffForm(ctx, s) },
      { label: "Delete", icon: "trash", danger: true, onClick: () => confirmDelete(ctx, "staff", s.id) },
    ],
    empty: { icon: "users", title: "No staff yet", hint: "Add someone, or import a list from a spreadsheet.", action: html`<button type="button" class="btn btn-primary" data-add>${icon("plus")}Add staff</button>` },
  });
  on(root, "click", "[data-add]", () => staffForm(ctx));
  on(root, "click", "[data-import]", () => importCSV(ctx));
  on(root, "click", "[data-template]", () => downloadFile("staff-template.csv", toCSV(staffTemplateRows())));
}

function renderDetail(root, ctx, id) {
  const state = ctx.state();
  const person = state.staff.find((s) => s.id === id);
  if (!person) {
    setHTML(root, html`<div class="page">${pageHead({ title: "Staff member not found", back: { page: "staff", label: "Staff" } })}<section class="card">${emptyState({ icon: "users", title: "This person isn't on your staff list", hint: "They may have been deleted. Check the Recycle Bin." })}</section></div>`);
    return;
  }
  const months = [...new Set([...Object.keys(state.entries).filter((m) => state.entries[m]?.[id]), ...state.salaryPayments.filter((p) => p.staffId === id).map((p) => p.month), ...state.advances.filter((a) => a.staffId === id).map((a) => a.date.slice(0, 7))])].sort().reverse();
  const rows = months.map((month) => ({ id: month, month, pay: payFor(state, person, month), paid: salaryPaymentFor(state, id, month), marks: attendanceSummary(state.attendance[month]?.[id], state.settings.pay) }));
  const advances = state.advances.filter((a) => a.staffId === id).slice().sort((a, b) => b.date.localeCompare(a.date));
  setHTML(root, html`
    <div class="page">
      ${pageHead({
        title: person.name || "(no name)", art: person.name,
        back: { page: "staff", label: "Staff" },
        sub: [person.code, person.position, person.team].filter(Boolean).join(" · "),
        actions: html`
          ${person.phone ? html`<a class="btn" href="${whatsappUrl(person.phone)}" target="_blank" rel="noopener">${icon("message")}WhatsApp</a>` : ""}
          <button type="button" class="btn" data-edit>${icon("edit")}Edit</button>
          <button type="button" class="btn" data-delete>${icon("trash")}Delete</button>`,
      })}
      ${person.active === false ? html`<div class="banner banner-warning">${icon("pause")}<p>${person.name} is inactive, so they aren't shown on new salary sheets.</p></div>` : ""}
      <section class="card">
        <dl class="facts">
          <div><dt>Monthly salary</dt><dd class="num">${ctx.money(person.salary || 0)}</dd></div>
          <div><dt>Joined</dt><dd>${formatDate(person.joinedOn)}</dd></div>
          <div><dt>Phone</dt><dd>${person.phone || "—"}</dd></div>
          <div><dt>Bank</dt><dd>${person.bank || "—"}</dd></div>
          <div><dt>Account</dt><dd>${person.account || "—"}</dd></div>
          <div><dt>IFSC</dt><dd>${person.ifsc || "—"}</dd></div>
          <div><dt>UPI</dt><dd>${person.upi || "—"}</dd></div>
        </dl>
      </section>
      <section class="card card-flush">
        <div class="card-head card-head-pad"><h2>Pay history</h2></div>
        <div data-pay-table></div>
      </section>
      <section class="card card-flush">
        <div class="card-head card-head-pad"><h2>Advances</h2></div>
        <div data-advance-table></div>
      </section>
    </div>`);
  createTable($("[data-pay-table]", root), {
    id: "staff-pay", label: "Pay history",
    rows: () => rows,
    defaultSort: { key: "month", dir: "desc" },
    columns: [
      { key: "month", label: "Month", sortable: true, mobile: "title", render: (r) => html`<span class="cell-title">${monthLabel(r.month)}</span>` },
      { key: "days", label: "Days", align: "num", value: (r) => r.pay.days, render: (r) => r.pay.days },
      { key: "gross", label: "Gross", align: "num", value: (r) => r.pay.gross, render: (r) => ctx.money(r.pay.gross) },
      { key: "deductions", label: "Deductions", align: "num", value: (r) => r.pay.deductions, render: (r) => ctx.money(r.pay.deductions) },
      { key: "net", label: "Net pay", align: "num", sortable: true, mobile: "amount", value: (r) => r.pay.net, render: (r) => ctx.money(r.pay.net) },
      { key: "paid", label: "Status", mobile: "status", render: (r) => (r.paid ? html`<span class="badge badge-success">Paid ${formatDate(r.paid.date)}</span>` : r.pay.net > 0 ? html`<span class="badge badge-warning">Unpaid</span>` : html`<span class="badge">Nothing to pay</span>`) },
    ],
    empty: { icon: "sheet", title: "No pay records yet", hint: "Their pay shows here once you fill in the pay sheet." },
  });
  createTable($("[data-advance-table]", root), {
    id: "staff-advances", label: "Advances",
    rows: () => advances,
    defaultSort: { key: "date", dir: "desc" },
    columns: [
      { key: "date", label: "Date", sortable: true, mobile: "title", render: (a) => formatDate(a.date) },
      { key: "note", label: "Note", mobile: "meta" },
      { key: "amount", label: "Amount", align: "num", sortable: true, mobile: "amount", render: (a) => ctx.money(a.amount) },
    ],
    empty: { icon: "wallet", title: "No advances", hint: "Advances recorded for this person show here." },
  });
  on(root, "click", "[data-edit]", () => staffForm(ctx, person));
  on(root, "click", "[data-delete]", () => confirmDelete(ctx, "staff", person.id, { onDeleted: () => ctx.navigate("staff") }));
}

export default {
  id: "staff",
  title: "Staff",
  render(root, ctx, params) {
    if (params[0]) renderDetail(root, ctx, params[0]);
    else renderList(root, ctx);
  },
};
