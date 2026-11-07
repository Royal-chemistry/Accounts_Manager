// Reports: Profit & Loss, cash flow, ageing, GST, stock and staff pay. Each one has a date range,
// a CSV export, and a print layout that also saves as a PDF.
import { toCSV } from "../core/csv.js";
import { formatDate, monthEnd, monthLabel, monthStart, periodPresets } from "../core/dates.js";
import { ageing, BUCKET_LABELS, cashFlow, gstSummary, profitLoss, staffPaySummary, stockReport } from "../core/reports.js";
import { $, downloadFile, html, on, raw, setHTML } from "../ui/dom.js";
import { axisLabel, columnChart } from "../ui/chart.js";
import { icon } from "../ui/icons.js";
import { docHead, printDocument } from "../ui/print.js";
import { emptyState } from "../ui/table.js";
import { kpi, pageHead } from "./_common.js";
import { entryForm } from "./cashbook.js";

const RANGE_KEY = "accounts-manager:report-range";
const BASIS_KEY = "accounts-manager:report-basis";
const AS_OF_KEY = "accounts-manager:report-as-of";
const session = {
  get(key, fallback) { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* not important */ } },
};

const TABS = [
  ["profit", "Profit & Loss"], ["cash", "Cash flow"], ["receivable", "Who owes you"], ["payable", "Who you owe"],
  ["gst", "GST"], ["stock", "Stock"], ["staff", "Staff pay"],
];

const money2 = (ctx) => (n) => ctx.money(n, { decimals: 2 });
const lineRow = (label, value, cls = "") => html`<div class="line ${cls}"><span class="line-label">${label}</span><span class="line-value">${value}</span></div>`;

// On a phone each row is a small card, so lines that are zero are left out to keep it short.
const isZeroCell = (c) => c === 0 || (typeof c === "string" && /^[^\d-]*0(\.0+)?$/.test(c));
const mobileRole = (c, i) => (i === 0 ? "title" : isZeroCell(c) ? "hide" : "detail");

/** A plain report table, shared by the screen and print. */
function reportTable({ head, rows, foot, numFrom = 1, label }) {
  const isNum = (i) => i >= numFrom;
  return html`
    <div class="table-wrap report-table" role="region" aria-label="${label}" tabindex="0">
      <table class="tbl" role="table">
        <thead role="rowgroup"><tr role="row">${head.map((h, i) => html`<th role="columnheader" scope="col" class="${isNum(i) ? "col-num" : ""}">${h}</th>`)}</tr></thead>
        <tbody role="rowgroup">${rows.map((r) => html`<tr role="row">${r.map((c, i) => html`<td role="cell" class="${isNum(i) ? "col-num" : ""}" data-label="${head[i]}" data-mobile="${mobileRole(c, i)}">${c}</td>`)}</tr>`)}</tbody>
        ${foot ? html`<tfoot role="rowgroup"><tr role="row">${foot.map((c, i) => html`<td role="cell" class="${isNum(i) ? "col-num" : ""}" data-label="${head[i]}" data-mobile="${mobileRole(c, i)}">${c}</td>`)}</tr></tfoot>` : ""}
      </table>
    </div>`;
}

const printTable = ({ head, rows, foot, numFrom = 1 }) => html`
  <table class="doc-table">
    <thead><tr>${head.map((h, i) => html`<th class="${i >= numFrom ? "num" : ""}">${h}</th>`)}</tr></thead>
    <tbody>
      ${rows.map((r) => html`<tr>${r.map((c, i) => html`<td class="${i >= numFrom ? "num" : ""}">${c}</td>`)}</tr>`)}
      ${foot ? html`<tr class="total">${foot.map((c, i) => html`<td class="${i >= numFrom ? "num" : ""}">${c}</td>`)}</tr>` : ""}
    </tbody>
  </table>`;

function profitReport(ctx, range) {
  const state = ctx.state();
  const basis = session.get(BASIS_KEY, "accrual");
  const p = profitLoss(state, { ...range, basis });
  const m = money2(ctx);
  // Months with nothing in them only add noise: the table skips them, and the chart runs from the first month with activity to the last.
  const hasActivity = (x) => x.revenue || x.costOfSales || x.expenses || x.staffCost || x.loanInterest;
  const active = p.monthly.filter(hasActivity);
  const span = p.monthly.slice(p.monthly.findIndex(hasActivity), p.monthly.findLastIndex(hasActivity) + 1);
  const showMonths = active.length > 1;
  const rows = [
    ...p.revenue.lines.map((l) => [l.label, l.amount, ""]),
    ["Total revenue", p.revenue.total, "total"],
    ...(p.costOfSales ? [["Cost of goods sold", -p.costOfSales, ""], ["Gross profit", p.grossProfit, "total"]] : []),
    ...p.expenses.lines.map((l) => [l.label, -l.amount, ""]),
    ...(p.staffCost ? [["Staff cost", -p.staffCost, ""]] : []),
    ...(p.loanInterest ? [["Loan interest", -p.loanInterest, ""]] : []),
    ["Net profit", p.netProfit, "total"],
  ];
  const monthlyTable = { head: ["Month", "Revenue", "Cost of goods", "Expenses", "Staff", "Interest", "Net profit"], rows: active.map((x) => [monthLabel(x.month), m(x.revenue), m(x.costOfSales), m(x.expenses), m(x.staffCost), m(x.loanInterest), m(x.netProfit)]), foot: ["Total", m(p.revenue.total), m(p.costOfSales), m(p.expenses.total), m(p.staffCost), m(p.loanInterest), m(p.netProfit)], label: "Profit by month" };
  return {
    title: "Profit & Loss",
    fileName: "profit-and-loss",
    controls: html`
      <div class="seg" role="radiogroup" aria-label="Basis">
        <label><input type="radio" name="basis" value="accrual" ${basis === "accrual" ? raw("checked") : ""}><span>When invoiced</span></label>
        <label><input type="radio" name="basis" value="cash" ${basis === "cash" ? raw("checked") : ""}><span>When paid</span></label>
      </div>`,
    screen: html`
      <div class="kpis">
        ${kpi({ label: "Revenue", value: ctx.money(p.revenue.total, { decimals: 0 }), ic: "arrow-in" })}
        ${kpi({ label: "Spending", value: ctx.money(p.costOfSales + p.expenses.total + p.staffCost + p.loanInterest, { decimals: 0 }), ic: "arrow-out" })}
        ${kpi({ label: "Net profit", value: ctx.money(p.netProfit, { decimals: 0 }), ic: "chart", tone: p.netProfit < 0 ? "bad" : "good" })}
      </div>
      ${showMonths ? html`<section class="card"><h2 class="card-title">Revenue and spending by month</h2><div data-chart></div></section>` : ""}
      <section class="card">
        <h2 class="card-title">${basis === "cash" ? "Counted when money was received or paid" : "Counted when invoiced or incurred"}</h2>
        <div class="lines">${rows.map(([label, amount, cls]) => (cls === "total" ? lineRow(label, m(amount), "line-total") : lineRow(label, m(amount))))}</div>
        <p class="small muted report-note">GST, personal spending, loan principal and opening balances aren't part of profit. Staff cost counts in the month worked.${p.excludedAdjustments ? ` ${p.excludedAdjustments} balance ${p.excludedAdjustments === 1 ? "adjustment isn't" : "adjustments aren't"} counted.` : ""}</p>
      </section>
      ${showMonths ? html`<section class="card card-flush"><div class="card-head card-head-pad"><h2>Month by month</h2></div>${reportTable(monthlyTable)}</section>` : ""}`,
    mount(root) {
      const host = $("[data-chart]", root);
      if (!host) return;
      columnChart(host, {
        title: "Revenue and spending by month",
        categories: span.map((x) => monthLabel(x.month, { short: true })),
        series: [
          { key: "revenue", name: "Revenue", cls: "series-1", values: span.map((x) => x.revenue) },
          { key: "spending", name: "Spending", cls: "series-2", values: span.map((x) => Math.round((x.costOfSales + x.expenses + x.staffCost + x.loanInterest) * 100) / 100) },
        ],
        format: (n) => ctx.money(n, { decimals: 0 }),
        axis: (n) => axisLabel(n, state.profile.currency),
      });
    },
    print: html`
      ${printTable({ head: ["", "Amount"], rows: rows.map(([l, a]) => [l, m(a)]) })}
      ${showMonths ? html`<div class="doc-h">Month by month</div>${printTable(monthlyTable)}` : ""}
      <p class="doc-foot">Basis: ${basis === "cash" ? "cash" : "accrual"}. GST, personal spending, loan principal and opening balances aren't part of profit.</p>`,
    csv: [["Line", "Amount"], ...rows.map(([l, a]) => [l, a]), [], ["Month", "Revenue", "Cost of goods", "Expenses", "Staff", "Interest", "Net profit"], ...p.monthly.map((x) => [x.month, x.revenue, x.costOfSales, x.expenses, x.staffCost, x.loanInterest, x.netProfit])],
  };
}

function cashReport(ctx, range) {
  const c = cashFlow(ctx.state(), range);
  const m = money2(ctx);
  const rows = [
    ["Opening balance", c.opening, true],
    ...c.inflow.lines.map((l) => [l.label, l.amount]),
    ["Money in", c.inflow.total, true],
    ...c.outflow.lines.map((l) => [l.label, -l.amount]),
    ["Money out", -c.outflow.total, true],
    ["Net change", c.net, true],
    ["Closing balance", c.closing, true],
  ];
  const unlinked = c.unlinked.in || c.unlinked.out;
  return {
    title: "Cash flow",
    fileName: "cash-flow",
    screen: html`
      <div class="kpis">
        ${kpi({ label: "Money in", value: ctx.money(c.inflow.total, { decimals: 0 }), ic: "arrow-in" })}
        ${kpi({ label: "Money out", value: ctx.money(c.outflow.total, { decimals: 0 }), ic: "arrow-out" })}
        ${kpi({ label: "Closing balance", value: ctx.money(c.closing, { decimals: 0 }), ic: "bank", tone: c.closing < 0 ? "bad" : "" })}
      </div>
      <section class="card">
        <div class="lines">${rows.map(([l, a, total]) => lineRow(l, m(a), total ? "line-total" : ""))}</div>
        ${c.closing === c.actualClosing ? html`<p class="small muted report-note">${icon("check-circle", { cls: "icon-sm icon-inline" })} The closing balance matches your accounts. Transfers between your own accounts aren't counted.</p>` : ""}
        ${unlinked ? html`<div class="banner report-note">${icon("info")}<p>Older entries not linked to any account aren't in these balances: ${m(c.unlinked.in)} in and ${m(c.unlinked.out)} out.</p></div>` : ""}
      </section>`,
    print: html`${printTable({ head: ["", "Amount"], rows: rows.map(([l, a]) => [l, m(a)]) })}<p class="doc-foot">Transfers between your own accounts aren't counted.</p>`,
    csv: [["Line", "Amount"], ...rows.map(([l, a]) => [l, a])],
  };
}

function ageingReport(ctx, range, side) {
  const a = ageing(ctx.state(), { side, asOf: range.asOf });
  const m = (n) => ctx.money(n);
  const keys = Object.keys(BUCKET_LABELS);
  const head = [side === "receivable" ? "Client" : "Supplier", ...keys.map((k) => BUCKET_LABELS[k]), "Total"];
  const page = side === "receivable" ? "clients" : "suppliers";
  const printable = { head, rows: a.rows.map((r) => [r.name, ...keys.map((k) => m(r[k])), m(r.total)]), foot: ["Total", ...keys.map((k) => m(a.totals[k])), m(a.totals.total)] };
  const overdue = a.totals.total - a.totals.notDue;
  return {
    title: side === "receivable" ? "Who owes you" : "Who you owe",
    fileName: side === "receivable" ? "receivables-ageing" : "payables-ageing",
    asOfOnly: true,
    screen: a.rows.length ? html`
      <div class="kpis">
        ${kpi({ label: side === "receivable" ? "Total owed to you" : "Total you owe", value: ctx.money(a.totals.total, { decimals: 0 }), ic: "receipt", tone: "warn" })}
        ${kpi({ label: "Overdue", value: ctx.money(overdue, { decimals: 0 }), ic: "clock", tone: overdue ? "bad" : "good" })}
        ${kpi({ label: "Over 90 days", value: ctx.money(a.totals.d90plus, { decimals: 0 }), ic: "alert", tone: a.totals.d90plus ? "bad" : "" })}
      </div>
      <section class="card card-flush">
        ${reportTable({ ...printable, label: "Ageing", rows: a.rows.map((r) => [r.partyId ? html`<a href="#/${page}/${r.partyId}">${r.name}</a>` : r.name, ...keys.map((k) => m(r[k])), html`<span class="strong">${m(r.total)}</span>`]) })}
      </section>
      <p class="small muted">Age runs from each due date, or from the document date when there's no due date, up to ${formatDate(range.asOf)}.</p>`
      : html`<section class="card">${emptyState({ icon: "check-circle", title: "Nothing outstanding", hint: `Nothing was open on ${formatDate(range.asOf)}.` })}</section>`,
    print: printTable(printable),
    csv: [head, ...a.rows.map((r) => [r.name, ...keys.map((k) => r[k]), r.total]), ["Total", ...keys.map((k) => a.totals[k]), a.totals.total]],
  };
}

function gstReport(ctx, range) {
  const g = gstSummary(ctx.state(), range);
  const m = money2(ctx);
  const slabRows = (slabs) => slabs.map((s) => [`${s.rate}%`, m(s.taxable), m(s.cgst), m(s.sgst), m(s.igst), m(s.gst)]);
  const head = ["GST rate", "Taxable", "CGST", "SGST", "IGST", "GST"];
  const section = (x) => ({ head, rows: slabRows(x.slabs), foot: ["Total", m(x.taxable), m(x.cgst), m(x.sgst), m(x.igst), m(x.gst)], label: "GST" });
  const summary = [["GST collected (output)", m(g.output.gst)], ["GST on purchases (input)", m(-g.input.gst)], ["GST paid to the government", m(-g.gstPaid)]];
  return {
    title: "GST summary",
    fileName: "gst-summary",
    controls: html`<button type="button" class="btn" data-gst-pay>${icon("plus")}Record GST payment</button>`,
    screen: html`
      <div class="kpis">
        ${kpi({ label: "GST collected", value: ctx.money(g.output.gst, { decimals: 0 }), ic: "arrow-in" })}
        ${kpi({ label: "GST on purchases", value: ctx.money(g.input.gst, { decimals: 0 }), ic: "arrow-out" })}
        ${kpi({ label: g.netPayable >= 0 ? "Net GST payable" : "GST credit", value: ctx.money(Math.abs(g.netPayable), { decimals: 0 }), ic: "percent", tone: g.netPayable > 0 ? "warn" : "good", sub: g.gstPaid ? `After ${ctx.money(g.gstPaid, { decimals: 0 })} paid` : "" })}
        ${kpi({ label: "TDS deducted by clients", value: ctx.money(g.tdsDeducted, { decimals: 0 }), ic: "receipt" })}
      </div>
      <section class="card card-flush"><div class="card-head card-head-pad"><h2>GST collected on sales</h2></div>${g.output.slabs.length ? reportTable(section(g.output)) : html`<p class="muted report-empty">No GST on sales in this period.</p>`}</section>
      <section class="card card-flush"><div class="card-head card-head-pad"><h2>GST on purchases</h2></div>${g.input.slabs.length ? reportTable({ ...section(g.input), label: "GST on purchases" }) : html`<p class="muted report-empty">No GST on purchases in this period.</p>`}</section>
      <section class="card">
        <div class="lines">${summary.map(([l, v]) => lineRow(l, v))}${lineRow(g.netPayable >= 0 ? "Net GST payable" : "GST credit", m(Math.abs(g.netPayable)), "line-total")}</div>
        <p class="small muted report-note">A working summary from your records, not a tax filing. Please check it with your accountant.</p>
      </section>`,
    print: html`
      <div class="doc-h">GST collected on sales</div>${printTable(section(g.output))}
      <div class="doc-h">GST on purchases</div>${printTable(section(g.input))}
      ${printTable({ head: ["", "Amount"], rows: [...summary, [g.netPayable >= 0 ? "Net GST payable" : "GST credit", m(Math.abs(g.netPayable))], ["TDS deducted by clients", m(g.tdsDeducted)]] })}
      <p class="doc-foot">A working summary from your records, not a tax filing. Please check it with your accountant.</p>`,
    csv: [
      ["GST collected on sales"], ["Rate", "Taxable", "CGST", "SGST", "IGST", "GST"], ...g.output.slabs.map((s) => [s.rate, s.taxable, s.cgst, s.sgst, s.igst, s.gst]), ["Total", g.output.taxable, g.output.cgst, g.output.sgst, g.output.igst, g.output.gst], [],
      ["GST on purchases"], ["Rate", "Taxable", "CGST", "SGST", "IGST", "GST"], ...g.input.slabs.map((s) => [s.rate, s.taxable, s.cgst, s.sgst, s.igst, s.gst]), ["Total", g.input.taxable, g.input.cgst, g.input.sgst, g.input.igst, g.input.gst], [],
      ["GST paid", g.gstPaid], ["Net payable", g.netPayable], ["TDS deducted by clients", g.tdsDeducted],
    ],
    mount(root) {
      on(root, "click", "[data-gst-pay]", () => entryForm(ctx, "expense", null, { category: "GST payment", date: ctx.today() }));
    },
  };
}

function stockReportView(ctx, range) {
  const r = stockReport(ctx.state(), range);
  const m = (n) => ctx.money(n);
  const head = ["Item", "Opening", "In", "Out", "Closing", "Average cost", "Value now"];
  const table = { head, rows: r.rows.map((x) => [x.item.name, x.opening, x.in, x.out, x.closing, m(x.avgCost), m(x.value)]), foot: ["Total", "", "", "", "", "", m(r.totalValue)] };
  return {
    title: "Stock report",
    fileName: "stock-report",
    screen: r.rows.length ? html`
      <div class="kpis">
        ${kpi({ label: "Stock value today", value: ctx.money(r.totalValue, { decimals: 0 }), ic: "wallet" })}
        ${kpi({ label: "Items", value: r.rows.length, ic: "box" })}
        ${kpi({ label: "Low stock", value: r.low.length, ic: "alert", tone: r.low.length ? "warn" : "", sub: r.low.slice(0, 2).map((x) => x.item.name).join(", ") })}
      </div>
      <section class="card card-flush">${reportTable({ ...table, label: "Stock", rows: r.rows.map((x) => [html`<a href="#/stock/${x.item.id}">${x.item.name}</a>`, x.opening, x.in, x.out, html`<span class="strong">${x.closing}</span>`, m(x.avgCost), m(x.value)]) })}</section>`
      : html`<section class="card">${emptyState({ icon: "box", title: "No stock items", hint: "Add stock items to see them here." })}</section>`,
    print: printTable(table),
    csv: [["Item", "SKU", "Unit", "Opening", "In", "Out", "Closing", "Average cost", "Value now"], ...r.rows.map((x) => [x.item.name, x.item.sku, x.item.unit, x.opening, x.in, x.out, x.closing, x.avgCost, x.value])],
  };
}

function staffReport(ctx, range) {
  const r = staffPaySummary(ctx.state(), range);
  const m = (n) => ctx.money(n);
  const head = ["Staff", "Days", "Gross", "Advances", "Other cuts", "PF", "ESI", "Net", "Paid", "Pending"];
  const cells = (x) => [x.days, m(x.gross), m(x.advances), m(x.otherDeductions), m(x.pf), m(x.esi), m(x.net), m(x.paid), m(x.pending)];
  const table = { head, rows: r.rows.map((x) => [x.staff.name, ...cells(x)]), foot: ["Total", ...cells(r.totals)] };
  const teamsTable = { head: ["Team", ...head.slice(1)], rows: r.teams.map((x) => [`${x.team} (${x.count})`, ...cells(x)]), foot: null };
  return {
    title: "Staff pay",
    fileName: "staff-pay",
    screen: r.rows.length ? html`
      <div class="kpis">
        ${kpi({ label: "Gross pay", value: ctx.money(r.totals.gross, { decimals: 0 }), ic: "wallet" })}
        ${kpi({ label: "Paid", value: ctx.money(r.totals.paid, { decimals: 0 }), ic: "check-circle", tone: "good" })}
        ${kpi({ label: "Pending", value: ctx.money(r.totals.pending, { decimals: 0 }), ic: "clock", tone: r.totals.pending ? "warn" : "good" })}
        ${r.totals.pf || r.totals.esi ? kpi({ label: "PF and ESI to remit", value: ctx.money(r.totals.pf + r.totals.esi, { decimals: 0 }), ic: "percent" }) : ""}
      </div>
      <section class="card card-flush">${reportTable({ ...table, label: "Staff pay", rows: r.rows.map((x) => [html`<a href="#/staff/${x.staff.id}">${x.staff.name}</a>`, ...cells(x)]) })}</section>
      ${r.teams.length > 1 ? html`<section class="card card-flush"><div class="card-head card-head-pad"><h2>By team</h2></div>${reportTable({ ...teamsTable, label: "Pay by team" })}</section>` : ""}
      <p class="small muted">A month counts when its last day is in the range.</p>`
      : html`<section class="card">${emptyState({ icon: "users", title: "No pay in this period", hint: "A month counts when its last day is in the range. Try a wider one." })}</section>`,
    print: html`${printTable(table)}${r.teams.length > 1 ? html`<div class="doc-h">By team</div>${printTable(teamsTable)}` : ""}`,
    csv: [["Staff", "Team", "Days", "Gross", "Advances", "Other cuts", "PF", "ESI", "Net", "Paid", "Pending", "Staff cost"], ...r.rows.map((x) => [x.staff.name, x.team, x.days, x.gross, x.advances, x.otherDeductions, x.pf, x.esi, x.net, x.paid, x.pending, x.cost]), ["Total", "", r.totals.days, r.totals.gross, r.totals.advances, r.totals.otherDeductions, r.totals.pf, r.totals.esi, r.totals.net, r.totals.paid, r.totals.pending, r.totals.cost]],
  };
}

const BUILD = {
  profit: profitReport, cash: cashReport,
  receivable: (ctx, range) => ageingReport(ctx, range, "receivable"),
  payable: (ctx, range) => ageingReport(ctx, range, "payable"),
  gst: gstReport, stock: stockReportView, staff: staffReport,
};

function currentRange(ctx) {
  const state = ctx.state();
  const presets = periodPresets(ctx.today(), state.profile.fyStartMonth);
  const saved = session.get(RANGE_KEY, null);
  if (saved?.id === "custom" && saved.from && saved.to) return { id: "custom", from: saved.from, to: saved.to, presets };
  const chosen = presets.find((p) => p.id === saved?.id);
  if (chosen) return { id: chosen.id, from: chosen.from, to: chosen.to, presets };
  // Until a period is chosen, reports follow the month in the top bar, so a dashboard figure opens on the same month.
  const from = monthStart(state.settings.month);
  const to = monthEnd(state.settings.month);
  return { id: presets.find((p) => p.from === from && p.to === to)?.id || "custom", from, to, presets };
}

export default {
  id: "reports",
  title: "Reports",
  render(host, ctx, params) {
    // Each draw gets a fresh container, so changing a date can't leave old click handlers behind.
    const root = document.createElement("div");
    host.replaceChildren(root);
    const tabs = TABS.filter(([id]) => (id !== "stock" || ctx.state().settings.modules?.stock) && (id !== "staff" || ctx.state().settings.modules?.payroll !== false) && (id !== "gst" || ctx.state().settings.modules?.gst !== false));
    const tab = tabs.some(([id]) => id === params[0]) ? params[0] : "profit";
    const range = currentRange(ctx);
    const asOf = session.get(AS_OF_KEY, null) || ctx.today();
    const report = BUILD[tab](ctx, { from: range.from, to: range.to, asOf });
    const periodLine = report.asOfOnly ? `As of ${formatDate(asOf)}` : `${formatDate(range.from)} to ${formatDate(range.to)}`;
    const periodFile = report.asOfOnly ? `as-of-${asOf}` : `${range.from}-to-${range.to}`;
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Reports",
          sub: periodLine,
          actions: html`
            <button type="button" class="btn" data-report-csv>${icon("download")}CSV</button>
            <button type="button" class="btn" data-report-print>${icon("printer")}Print or save as PDF</button>`,
        })}
        <nav class="tabs" aria-label="Reports">
          ${tabs.map(([id, label]) => html`<a class="tab" href="#/reports/${id}" ${id === tab ? raw('aria-current="page"') : ""}>${label}</a>`)}
        </nav>
        <div class="report-controls">
          ${report.asOfOnly ? html`
            <div class="field"><label class="field-label" for="report-as-of">As of</label><input class="input fit" type="date" id="report-as-of" data-as-of value="${asOf}"></div>` : html`
            <div class="field">
              <label class="field-label" for="report-period">Period</label>
              <select class="input fit" id="report-period" data-period>
                ${range.presets.map((p) => html`<option value="${p.id}" ${p.id === range.id ? raw("selected") : ""}>${p.label}</option>`)}
                <option value="custom" ${range.id === "custom" ? raw("selected") : ""}>Custom dates</option>
              </select>
            </div>
            ${range.id === "custom" ? html`
              <div class="field"><label class="field-label" for="report-from">From</label><input class="input fit" type="date" id="report-from" data-custom="from" value="${range.from}"></div>
              <div class="field"><label class="field-label" for="report-to">To</label><input class="input fit" type="date" id="report-to" data-custom="to" value="${range.to}"></div>` : ""}`}
          ${report.controls ? html`<div class="report-extra">${report.controls}</div>` : ""}
        </div>
        ${report.screen}
      </div>`);
    report.mount?.(root);
    const rerender = () => this.render(host, ctx, params);
    on(root, "change", "[data-period]", (e, el) => {
      if (el.value === "custom") session.set(RANGE_KEY, { id: "custom", from: range.from, to: range.to });
      else session.set(RANGE_KEY, { id: el.value });
      rerender();
    });
    on(root, "change", "[data-custom]", (e, el) => {
      const next = { id: "custom", from: range.from, to: range.to, [el.dataset.custom]: el.value };
      if (!next.from || !next.to || next.from > next.to) { el.setAttribute("aria-invalid", "true"); return; }
      session.set(RANGE_KEY, next);
      rerender();
    });
    on(root, "change", "[data-as-of]", (e, el) => {
      if (!el.value) { el.setAttribute("aria-invalid", "true"); return; }
      session.set(AS_OF_KEY, el.value);
      rerender();
    });
    on(root, "change", 'input[name="basis"]', (e, el) => { session.set(BASIS_KEY, el.value); rerender(); });
    on(root, "click", "[data-report-csv]", () => downloadFile(`${report.fileName}-${periodFile}.csv`, toCSV(report.csv)));
    on(root, "click", "[data-report-print]", () => {
      printDocument(html`<section class="doc">${docHead(ctx.state(), { title: report.title, lines: [periodLine, `Printed ${formatDate(ctx.today())}`] })}${report.print}</section>`, { title: `${report.title} ${periodFile.replaceAll("-to-", " to ").replace("as-of-", "as of ")}` });
    });
  },
};
