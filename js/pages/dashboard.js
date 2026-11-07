// Today: what needs doing, where the money stands, and how the last six months went. The headline at the top is
// written from the records, like a story on the App Store's Today page.
import { daysBetween, formatDate, localToday, monthLabel } from "../core/dates.js";
import { ageing, dashboardSummary, todayStory, upNext } from "../core/reports.js";
import { artwork } from "../ui/artwork.js";
import { axisLabel, columnChart } from "../ui/chart.js";
import { $, downloadFile, html, on, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { toast } from "../ui/toast.js";
import { kpi, pageHead } from "./_common.js";
import { settleForm } from "./parties.js";
import { actionLabel, actOn, openUpNext, whenText } from "./up-next.js";

const BACKUP_NUDGE_DAYS = 14;
const LIST_LIMIT = 6;
const FACES = 4;
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

/** The headline card. Its colour and words both come from the state of the business. */
function storyCard(ctx, items) {
  const story = todayStory(items, (n) => ctx.money(n, { decimals: 0 }));
  const names = [...new Set(items.map((i) => i.name))];
  return html`
    <section class="story art-${story.tone}" aria-labelledby="story-title">
      <p class="story-eyebrow">${story.eyebrow}</p>
      <h2 class="story-title" id="story-title">${story.title}</h2>
      <p class="story-detail">${story.detail}</p>
      <div class="story-foot">
        ${items.length ? html`
          <button type="button" class="btn story-action" data-start-queue>Start Up Next</button>
          <span class="faces" aria-hidden="true">
            ${names.slice(0, FACES).map((n) => artwork(n))}
            ${names.length > FACES ? html`<span class="face-more">+${names.length - FACES}</span>` : ""}
          </span>` : ""}
      </div>
    </section>`;
}

/** A row like one in the App Store: artwork, name, a line of detail, and a pill to act on it. */
const queueRow = (ctx, item) => html`
  <li class="app-row">
    ${artwork(item.name, "md")}
    <div class="app-row-text">
      <span class="app-row-name">${item.name}</span>
      <span class="app-row-sub">${item.detail} · <span class="${item.days < 0 ? "text-danger" : ""}">${whenText(item)}</span></span>
    </div>
    <span class="app-row-amount ${item.direction === "in" ? "text-success" : ""}">${item.variable ? "Varies" : `${item.direction === "in" ? "+" : ""}${ctx.money(item.amount, { decimals: 0 })}`}</span>
    <button type="button" class="btn btn-sm btn-get" data-act="${item.key}" aria-label="${actionLabel(item)}: ${item.name}">${actionLabel(item)}</button>
  </li>`;

/** A sideways-scrolling row of people, like a shelf in Music. */
function shelf(ctx, title, rows, { kind, page, reportHref, verb }) {
  if (!rows.length) return "";
  return html`
    <section class="shelf" aria-labelledby="shelf-${kind}">
      <div class="shelf-head">
        <h2 id="shelf-${kind}">${title}</h2>
        <a class="shelf-all" href="#/${reportHref}">See all${icon("chevron-right", { cls: "icon-sm" })}</a>
      </div>
      <div class="shelf-track" role="group" aria-labelledby="shelf-${kind}" tabindex="0">
        ${rows.map((r) => html`
          <article class="shelf-card">
            <a class="shelf-link" href="#/${r.partyId ? `${page}/${r.partyId}` : reportHref}">
              ${artwork(r.name, "lg")}
              <span class="shelf-name">${r.name}</span>
            </a>
            <span class="shelf-amount">${ctx.money(r.total, { decimals: 0 })}</span>
            ${r.partyId ? html`<button type="button" class="btn btn-sm btn-get" data-settle="${kind}" data-party="${r.partyId}" aria-label="${verb}: ${r.name}">${verb}</button>` : ""}
          </article>`)}
      </div>
    </section>`;
}

const card = (title, rows, { emptyText, link, testId = "" } = {}) => html`
  <section class="card" data-testid="${testId}">
    <div class="card-head">
      <h2>${title}</h2>
      ${link ? html`<a class="small" href="#/${link.href}">${link.label}</a>` : ""}
    </div>
    ${rows.length ? html`<div class="lines">${rows.map((i) => html`
      <div class="line">
        <span class="line-label wrap-anywhere">${i.href ? html`<a class="plain-link" href="#/${i.href}">${i.label}</a>` : i.label}${i.badge ? html` <span class="badge badge-${i.tone || "warning"}">${i.badge}</span>` : ""}${i.sub ? html`<span class="cell-sub">${i.sub}</span>` : ""}</span>
        <span class="line-value">${i.value}</span>
      </div>`)}</div>` : html`<p class="muted">${emptyText}</p>`}
  </section>`;

export default {
  id: "dashboard",
  title: "Today",
  render(root, ctx) {
    const state = ctx.state();
    const today = ctx.today();
    const d = dashboardSummary(state, today);
    const items = upNext(state, today);
    const m0 = (n) => ctx.money(n, { decimals: 0 });
    const payroll = state.settings.modules?.payroll !== false;
    const stockOn = !!state.settings.modules?.stock;

    const accounts = d.accounts.map((a) => ({ label: a.name, href: `banks/${a.id}`, value: ctx.money(a.balance) }));
    const low = d.lowStock.slice(0, LIST_LIMIT).map((r) => ({ label: r.item.name, href: `stock/${r.item.id}`, badge: r.negative ? "Below zero" : "Low", tone: r.negative ? "danger" : "warning", value: `${r.onHand} ${r.item.unit || ""}`.trim() }));
    const recent = d.recent.slice(0, LIST_LIMIT).map((p) => ({ label: p.label || "Entry", sub: formatDate(p.date), value: p.amount > 0 ? html`<span class="text-success">+${ctx.money(p.amount)}</span>` : ctx.money(p.amount) }));
    const owed = ageing(state, { side: "receivable", asOf: today }).rows;
    const owing = ageing(state, { side: "payable", asOf: today }).rows;
    const showChart = d.trend.some((t) => t.income || t.spending);
    const date = new Date(`${today}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

    setHTML(root, html`
      <div class="page today">
        <p class="today-date">${date}</p>
        ${pageHead({ title: "Today", sub: `${state.profile.name || "Your business"} · ${monthLabel(d.month)}` })}
        ${backupNudge(ctx, state, today)}
        <div class="today-top">
          ${storyCard(ctx, items)}
          <div class="kpis kpis-today">
            ${kpi({ label: "Cash and bank", value: m0(d.totalMoney), ic: "bank", href: "banks", tone: d.totalMoney < 0 ? "bad" : "", sub: `Cash ${m0(d.cashTotal)}` })}
            ${kpi({ label: "Clients owe you", value: m0(d.receivables), ic: "receipt", href: "reports/receivable", sub: d.overdueReceivables.length ? `${d.overdueReceivables.length} overdue` : "" })}
            ${kpi({ label: "You owe suppliers", value: m0(d.payables), ic: "truck", href: "reports/payable", sub: d.overduePayables.length ? `${d.overduePayables.length} overdue` : "" })}
            ${kpi({ label: `Profit, ${monthLabel(d.month, { short: true })}`, value: m0(d.profit), ic: "chart", href: "reports/profit", tone: d.profit < 0 ? "bad" : d.profit > 0 ? "good" : "" })}
            ${payroll ? kpi({ label: "Salaries to pay", value: m0(d.salariesToPay), ic: "wallet", href: "salary" }) : ""}
            ${stockOn ? kpi({ label: "Stock value", value: m0(d.stockValue), ic: "box", href: "stock", sub: d.lowStock.length ? `${d.lowStock.length} low` : "" }) : ""}
          </div>
        </div>
        ${setupChecklist(state)}
        ${items.length ? html`
          <section class="card" data-testid="up-next-list">
            <div class="card-head">
              <h2>Up next</h2>
              ${items.length > LIST_LIMIT ? html`<button type="button" class="btn btn-sm" data-start-queue>See all ${items.length}</button>` : ""}
            </div>
            <ul class="app-rows">${items.slice(0, LIST_LIMIT).map((i) => queueRow(ctx, i))}</ul>
          </section>` : ""}
        ${shelf(ctx, "Who owes you", owed, { kind: "client", page: "clients", reportHref: "reports/receivable", verb: "Receive" })}
        ${shelf(ctx, "Who you owe", owing, { kind: "supplier", page: "suppliers", reportHref: "reports/payable", verb: "Pay" })}
        <div class="dash-cols">
          <div class="dash-col">
            ${showChart ? html`
              <section class="card">
                <div class="card-head"><h2>Income and spending, last 6 months</h2><a class="small" href="#/reports/profit">Profit & Loss</a></div>
                <div data-trend></div>
              </section>` : ""}
            ${card("Recent activity", recent, { emptyText: "Payments you record show here.", link: { href: "banks/activity", label: "All activity" } })}
          </div>
          <div class="dash-col">
            ${card("Accounts", accounts, { emptyText: "No accounts yet.", link: { href: "banks", label: "Banks & loans" } })}
            ${stockOn && low.length ? card("Low stock", low, { link: { href: "stock", label: "Stock" }, testId: "low-stock" }) : ""}
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
    on(root, "click", "[data-start-queue]", () => openUpNext(ctx));
    on(root, "click", "[data-act]", (e, el) => {
      const item = items.find((i) => i.key === el.dataset.act);
      if (item) actOn(ctx, item);
    });
    on(root, "click", "[data-settle]", (e, el) => settleForm(ctx, el.dataset.settle, el.dataset.party));
    on(root, "click", "[data-backup]", () => {
      downloadFile(`accounts-manager-backup-${today}.json`, ctx.store.exportBackup(), "application/json");
      ctx.store.markBackedUp();
      toast("Backup downloaded. Keep it somewhere safe");
    });
  },
};
