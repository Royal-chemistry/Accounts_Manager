// A living style guide at #/styleguide, for contributors and for testing every component.
import { html, setHTML } from "../ui/dom.js";
import { icon, iconNames } from "../ui/icons.js";
import { openForm } from "../ui/form.js";
import { openModal } from "../ui/modal.js";
import { createTable } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";

const ROWS = [
  { id: "1", name: "Harbour View Hotel", date: "2026-10-03", amount: 101480, status: "Paid" },
  { id: "2", name: "St. Mary's School", date: "2026-10-10", amount: 28800, status: "Partly paid" },
  { id: "3", name: "Coastal Chemicals Pvt Ltd", date: "2026-10-20", amount: 47790, status: "Overdue" },
];
const TONE = { Paid: "success", "Partly paid": "warning", Overdue: "danger" };

export default {
  id: "styleguide",
  title: "Style guide",
  render(root, ctx) {
    setHTML(root, html`
      <div class="page">
        ${pageHead({ title: "Style guide", sub: "Every component in one place, in the current theme." })}
        <section class="card stack">
          <h2>Colours</h2>
          <div class="swatches">
            ${["bg", "surface", "surface-2", "primary", "primary-soft", "success", "danger", "warning", "info"].map((s) => html`<div class="swatch swatch-${s}">${s}</div>`)}
          </div>
        </section>
        <section class="card stack">
          <h2>Type</h2>
          <h2>Section heading</h2><h3>Small heading</h3>
          <p>Body text for everyday reading, with <a href="#/styleguide">a link</a> and <span class="muted">muted text</span>.</p>
          <div class="stack-sm"><span class="num">₹1,23,456.00</span><span class="num">₹9,99,999.99</span><span class="num">₹1,11,111.11</span></div>
        </section>
        <section class="card stack">
          <h2>Buttons</h2>
          <div class="row">
            <button type="button" class="btn btn-primary">${icon("plus")}Primary</button>
            <button type="button" class="btn">Secondary</button>
            <button type="button" class="btn btn-ghost">Ghost</button>
            <button type="button" class="btn btn-danger">${icon("trash")}Danger</button>
            <button type="button" class="btn btn-sm">Small</button>
            <button type="button" class="btn" disabled>Disabled</button>
            <button type="button" class="icon-btn" aria-label="Edit">${icon("edit")}</button>
            <button type="button" class="btn-link">Link button</button>
          </div>
        </section>
        <section class="card stack">
          <h2>Status</h2>
          <div class="row">
            <span class="badge">Neutral</span><span class="badge badge-success">Paid</span><span class="badge badge-warning">Partly paid</span>
            <span class="badge badge-danger">Overdue</span><span class="badge badge-info">Info</span><span class="badge badge-primary">Selected</span>
          </div>
          <div class="banner">${icon("info")}<p>An information message.</p></div>
          <div class="banner banner-success">${icon("check-circle")}<p>A success message.</p></div>
          <div class="banner banner-warning">${icon("alert")}<p>A warning message.</p></div>
          <div class="banner banner-danger">${icon("alert")}<p>An error message.</p></div>
        </section>
        <div class="kpis">
          ${kpi({ label: "Money in banks", value: "₹8,34,481", sub: "3 accounts", ic: "bank" })}
          ${kpi({ label: "Clients owe you", value: "₹1,70,150", tone: "warn", ic: "receipt" })}
          ${kpi({ label: "Overdue", value: "2", tone: "bad", ic: "clock" })}
          ${kpi({ label: "Profit", value: "₹5,97,030", tone: "good", ic: "chart" })}
        </div>
        <section class="card stack">
          <h2>Windows and messages</h2>
          <div class="row">
            <button type="button" class="btn" data-demo-form>Open a form</button>
            <button type="button" class="btn" data-demo-modal>Open a window</button>
            <button type="button" class="btn" data-demo-toast>Show a message</button>
            <button type="button" class="btn" data-demo-undo>Show Undo</button>
          </div>
        </section>
        <section class="card card-flush" data-demo-table></section>
        <section class="card stack">
          <h2>Empty table</h2>
          <div data-demo-empty></div>
        </section>
        <section class="card stack">
          <h2>Icons</h2>
          <div class="row">${iconNames.map((n) => html`<span title="${n}">${icon(n)}</span>`)}</div>
        </section>
      </div>`);

    createTable(root.querySelector("[data-demo-table]"), {
      id: "styleguide", label: "Example table",
      rows: () => ROWS,
      defaultSort: { key: "date", dir: "desc" },
      search: { placeholder: "Search clients", text: (r) => r.name },
      filters: [{ key: "status", label: "All statuses", options: Object.keys(TONE).map((s) => [s, s]), test: (r, v) => r.status === v }],
      columns: [
        { key: "name", label: "Client", sortable: true, mobile: "title", render: (r) => html`<span class="cell-title">${r.name}</span>` },
        { key: "date", label: "Date", sortable: true, mobile: "meta" },
        { key: "status", label: "Status", sortable: true, mobile: "status", render: (r) => html`<span class="badge badge-${TONE[r.status]}">${r.status}</span>` },
        { key: "amount", label: "Amount", align: "num", sortable: true, mobile: "amount", render: (r) => ctx.money(r.amount) },
      ],
      totals: (rows) => ({ name: "Total", amount: ctx.money(rows.reduce((t, r) => t + r.amount, 0)) }),
      actions: () => [{ label: "Open", primary: true, onClick: () => toast("Opened") }, { label: "Delete", icon: "trash", danger: true, onClick: () => toast("Example only", { kind: "info" }) }],
    });
    createTable(root.querySelector("[data-demo-empty]"), {
      id: "styleguide-empty", label: "Empty example", rows: () => [], columns: [{ key: "a", label: "A" }],
      empty: { icon: "receipt", title: "No invoices yet", hint: "Create your first invoice and it will appear here.", action: html`<button type="button" class="btn btn-primary">${icon("plus")}New invoice</button>` },
    });

    root.querySelector("[data-demo-form]").addEventListener("click", () => openForm({
      title: "Example form", ctx,
      intro: "Every field shows its error beside it.",
      fields: [
        { k: "name", label: "Name", required: true, full: true, hint: "As it should appear on invoices." },
        { k: "amount", label: "Amount", type: "money", required: true },
        { k: "date", label: "Date", type: "date", required: true },
        { k: "kind", label: "Kind", type: "select", options: [["a", "First"], ["b", "Second"]] },
        { k: "note", label: "Note", type: "textarea", full: true },
        { k: "flag", label: "Tick this if it applies", type: "checkbox", full: true },
        { k: "payment", type: "payment", label: "How was it paid?", formId: "styleguide" },
      ],
      onSubmit: () => { toast("Saved"); },
    }));
    root.querySelector("[data-demo-modal]").addEventListener("click", () => openModal({ title: "Example window", body: html`<p>Press Esc to close.</p>`, foot: html`<button type="button" class="btn btn-primary" data-modal-close>Done</button>` }));
    root.querySelector("[data-demo-toast]").addEventListener("click", () => toast("Saved"));
    root.querySelector("[data-demo-undo]").addEventListener("click", () => toast("Moved to the Recycle Bin", { action: { label: "Undo", onClick: () => toast("Restored") }, duration: 8000 }));
  },
};
