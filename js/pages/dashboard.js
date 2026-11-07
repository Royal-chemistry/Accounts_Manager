// The dashboard: where the money is, what needs attention today, and how the last six months went.
import { daysBetween, formatDate, localToday, monthLabel } from "../core/dates.js";
import { partyName } from "../core/ledger.js";
import { dashboardSummary } from "../core/reports.js";
import { axisLabel, columnChart } from "../ui/chart.js";
import { $, downloadFile, html, on, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";

const BACKUP_NUDGE_DAYS = 14;
const LIST_LIMIT = 6;
const SETUP_DONE_AT = 3; // by then the app is familiar, and the list has done its job

const hasRecords = (s) => s.staff.length || s.invoices.length || s.purchases.length || s.transactions.length || s.clients.length || s.items.length;

function setupChecklist(state) {
  const steps = [
    { done: state.accounts.some((a) => a.kind !== "cash"), label: "Add your bank account", href: "banks", icon: "bank" },
    { done: state.clients.length > 0, label: "Add a client", href: "clients", icon: "building" },
    { done: state.invoices.length > 0, label: "Create your first invoice", href: "invoices", icon: "receipt" },
    { done: state.transactions.length > 0, label: "Record an expense in the cash book", href: "cashbook", icon: "book" },
    ...(state.settings.modules?.payroll !== false ? [{ done: state.staff.length > 0, label: "Add your staff", href: "staff", icon: "users" }] : []),
    ...(state.settings.modules?.stock ? [{ done: state.items.length > 0, label: "Add your stock items", href: "stock", icon: "box" }] : []),
  ];
  if (steps.filter((s) => s.done).length >= SETUP_DONE_AT) return "";
  return html`
    <section class="card">
      <h2 class="card-title">Get set up</h2>
      <ul class="setup-list">
        ${steps.map((s) => html`<li><a class="setup-step ${s.done ? "setup-done" : ""}" href="#/${s.href}">${icon(s.done ? "check-circle" : s.icon)}<span>${s.label}</span>${s.done ? html`<span class="sr-only"> (done)</span>` : ""}</a></li>`)}
      </ul>
    </section>`;
}

function backupNudge(ctx, state, today) {
  if (ctx.store.isSample || !hasRecords(state)) return "";
  const last = state.settings.lastBackupAt;
  const lastDay = last ? localToday(new Date(last)) : "";
  if (last && daysBetween(lastDay, today) < BACKUP_NUDGE_DAYS) return "";
  return html`
    <div class="banner banner-warning backup-nudge">
      ${icon("shield")}
      <p class="grow">${last ? `Your last backup was on ${formatDate(lastDay)}.` : "You haven't made a backup yet."} Your records are only in this browser, so keep a copy somewhere safe.</p>
      <button type="button" class="btn btn-sm" data-backup>${icon("download", { cls: "icon-sm" })}Download backup</button>
    </div>`;
}

/** A compact list inside a card. Each row can link somewhere. */
const rows = (items) => html`<div class="lines">${items.map((i) => html`
  <div class="line">
    <span class="line-label wrap-anywhere">${i.href ? html`<a class="plain-link" href="#/${i.href}">${i.label}</a>` : i.label}${i.badge ? html` <span class="badge badge-${i.tone || "warning"}">${i.badge}</span>` : ""}${i.sub ? html`<span class="cell-sub">${i.sub}</span>` : ""}</span>
    <span class="line-value">${i.value}</span>
  </div>`)}</div>`;

const card = (title, items, { emptyText, link, testId = "" } = {}) => html`
  <section class="card" data-testid="${testId}">
    <div class="card-head">
      <h2>${title}</h2>
      ${link ? html`<a class="small" href="#/${link.href}">${link.label}</a>` : ""}
    </div>
    ${items.length ? rows(items.slice(0, LIST_LIMIT)) : html`<p class="muted">${emptyText}</p>`}
    ${items.length > LIST_LIMIT ? html`<p class="small muted report-note">and ${items.length - LIST_LIMIT} more</p>` : ""}
  </section>`;

export default {
  id: "dashboard",
  title: "Dashboard",
  render(root, ctx) {
    const state = ctx.state();
    const today = ctx.today();
    const d = dashboardSummary(state, today);
    const m0 = (n) => ctx.money(n, { decimals: 0 });
    const payroll = state.settings.modules?.payroll !== false;
    const stockOn = !!state.settings.modules?.stock;

    const docName = (doc) => {
      const source = (doc.docType === "invoice" ? state.invoices : doc.docType === "purchase" ? state.purchases : state.transactions).find((x) => x.id === doc.id);
      return [doc.no || doc.note || "Credit entry", partyName(state, doc.partyType, doc.partyId, source)].filter(Boolean).join(" · ");
    };
    const docLink = (doc) => {
      if (doc.docType === "invoice") return `invoices/${doc.id}`;
      if (doc.docType === "purchase") return `purchases/${doc.id}`;
      if (!doc.partyId) return "cashbook";
      return `${doc.partyType === "client" ? "clients" : "suppliers"}/${doc.partyId}`;
    };
    const late = (due) => { const n = daysBetween(due, today); return `${n} ${n === 1 ? "day" : "days"} late`; };
    const whenDue = (due) => { const n = daysBetween(today, due); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : formatDate(due); };
    const recurringAmount = (r) => (r.variable ? "Varies" : m0(r.amount));
    const incoming = (n) => html`<span class="text-success">+${m0(n)}</span>`;

    const attention = [
      ...d.overdueRecurring.map((u) => ({ label: u.r.name, href: "recurring", badge: late(u.due), tone: "danger", value: recurringAmount(u.r) })),
      ...d.overduePayables.map((doc) => ({ label: docName(doc), href: docLink(doc), badge: late(doc.due), tone: "danger", value: m0(doc.balance) })),
      ...d.overdueReceivables.map((doc) => ({ label: docName(doc), href: docLink(doc), badge: late(doc.due), tone: "danger", value: incoming(doc.balance) })),
    ];
    const dueSoon = [
      ...d.dueSoon.map((u) => ({ due: u.due, label: u.r.name, href: "recurring", value: recurringAmount(u.r) })),
      ...d.dueSoonPayables.map((doc) => ({ due: doc.due, label: docName(doc), href: docLink(doc), value: m0(doc.balance) })),
      ...d.dueSoonReceivables.map((doc) => ({ due: doc.due, label: docName(doc), href: docLink(doc), value: incoming(doc.balance) })),
    ].sort((a, b) => a.due.localeCompare(b.due)).map((i) => ({ ...i, badge: whenDue(i.due), tone: daysBetween(today, i.due) <= 1 ? "warning" : "info" }));
    const accounts = d.accounts.map((a) => ({ label: a.name, href: `banks/${a.id}`, value: ctx.money(a.balance) }));
    const low = d.lowStock.map((r) => ({ label: r.item.name, href: `stock/${r.item.id}`, badge: r.negative ? "Below zero" : "Low", tone: r.negative ? "danger" : "warning", value: `${r.onHand} ${r.item.unit || ""}`.trim() }));
    const recent = d.recent.map((p) => ({ label: p.label || "Entry", sub: formatDate(p.date), value: p.amount > 0 ? html`<span class="text-success">+${ctx.money(p.amount)}</span>` : ctx.money(p.amount) }));
    const showChart = d.trend.some((t) => t.income || t.spending);
    const six = payroll && stockOn;

    setHTML(root, html`
      <div class="page">
        ${pageHead({ title: "Dashboard", sub: `${state.profile.name || "Your business"} · ${monthLabel(d.month)}` })}
        ${backupNudge(ctx, state, today)}
        <div class="kpis ${six ? "kpis-6" : ""}">
          ${kpi({ label: "Cash and bank", value: m0(d.totalMoney), ic: "bank", href: "banks", tone: d.totalMoney < 0 ? "bad" : "", sub: `Cash ${m0(d.cashTotal)}` })}
          ${kpi({ label: "Clients owe you", value: m0(d.receivables), ic: "receipt", href: "reports/receivable", tone: d.receivables ? "warn" : "", sub: d.overdueReceivables.length ? `${d.overdueReceivables.length} overdue` : "" })}
          ${kpi({ label: "You owe suppliers", value: m0(d.payables), ic: "truck", href: "reports/payable", tone: d.payables ? "warn" : "", sub: d.overduePayables.length ? `${d.overduePayables.length} overdue` : "" })}
          ${kpi({ label: `Profit, ${monthLabel(d.month, { short: true })}`, value: m0(d.profit), ic: "chart", href: "reports/profit", tone: d.profit < 0 ? "bad" : "good" })}
          ${payroll ? kpi({ label: "Salaries to pay", value: m0(d.salariesToPay), ic: "wallet", href: "salary", tone: d.salariesToPay ? "warn" : "" }) : ""}
          ${stockOn ? kpi({ label: "Stock value", value: m0(d.stockValue), ic: "box", href: "stock", sub: d.lowStock.length ? `${d.lowStock.length} low` : "", tone: d.lowStock.length ? "warn" : "" }) : ""}
        </div>
        ${setupChecklist(state)}
        <div class="dash-cols">
          <div class="dash-col">
            ${attention.length ? card("Needs attention", attention) : ""}
            ${card("Due soon", dueSoon, { emptyText: "Nothing due in the next 7 days.", link: { href: "recurring", label: "Recurring" } })}
            ${showChart ? html`
              <section class="card">
                <div class="card-head"><h2>Income and spending, last 6 months</h2><a class="small" href="#/reports/profit">Profit & Loss</a></div>
                <div data-trend></div>
              </section>` : ""}
          </div>
          <div class="dash-col">
            ${card("Accounts", accounts, { emptyText: "No accounts yet.", link: { href: "banks", label: "Banks & loans" } })}
            ${stockOn && low.length ? card("Low stock", low, { link: { href: "stock", label: "Stock" }, testId: "low-stock" }) : ""}
            ${card("Recent activity", recent, { emptyText: "Payments you record show here.", link: { href: "banks/activity", label: "All activity" } })}
          </div>
        </div>
      </div>`);

    if (showChart) {
      columnChart($("[data-trend]", root), {
        title: "Income and spending, last 6 months",
        categories: d.trend.map((t) => monthLabel(t.month, { short: true })),
        series: [
          { key: "income", name: "Income", cls: "series-1", values: d.trend.map((t) => t.income) },
          { key: "spending", name: "Spending", cls: "series-2", values: d.trend.map((t) => t.spending) },
        ],
        format: m0,
        axis: (n) => axisLabel(n, state.profile.currency),
      });
    }
    on(root, "click", "[data-backup]", () => {
      downloadFile(`accounts-manager-backup-${today}.json`, ctx.store.exportBackup(), "application/json");
      ctx.store.markBackedUp();
      toast("Backup downloaded. Keep it somewhere safe");
    });
  },
};
