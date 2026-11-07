// The dashboard. This first version shows the headline figures, and M8 completes it.
import { monthLabel } from "../core/dates.js";
import { dashboardSummary } from "../core/reports.js";
import { html, setHTML } from "../ui/dom.js";
import { kpi, pageHead } from "./_common.js";

export default {
  id: "dashboard",
  title: "Dashboard",
  render(root, ctx) {
    const state = ctx.state();
    const d = dashboardSummary(state, ctx.today());
    setHTML(root, html`
      <div class="page">
        ${pageHead({ title: "Dashboard", sub: `${state.profile.name || "Your business"} · ${monthLabel(d.month)}` })}
        <div class="kpis">
          ${kpi({ label: "Cash and bank", value: ctx.money(d.totalMoney, { decimals: 0 }), ic: "bank", href: "banks", tone: d.totalMoney < 0 ? "bad" : "", sub: `Cash ${ctx.money(d.cashTotal, { decimals: 0 })}` })}
          ${kpi({ label: "Clients owe you", value: ctx.money(d.receivables, { decimals: 0 }), ic: "receipt", href: "invoices", tone: d.receivables ? "warn" : "", sub: d.overdueReceivables.length ? `${d.overdueReceivables.length} overdue` : "" })}
          ${kpi({ label: "You owe suppliers", value: ctx.money(d.payables, { decimals: 0 }), ic: "truck", href: "suppliers", tone: d.payables ? "warn" : "" })}
          ${kpi({ label: `Profit, ${monthLabel(d.month)}`, value: ctx.money(d.profit, { decimals: 0 }), ic: "chart", href: "reports", tone: d.profit < 0 ? "bad" : "good" })}
          ${kpi({ label: "Salaries to pay", value: ctx.money(d.salariesToPay, { decimals: 0 }), ic: "wallet", href: "salary", tone: d.salariesToPay ? "warn" : "" })}
          ${state.settings.modules?.stock ? kpi({ label: "Stock value", value: ctx.money(d.stockValue, { decimals: 0 }), ic: "box", href: "stock", tone: d.lowStock.length ? "warn" : "", sub: d.lowStock.length ? `${d.lowStock.length} low` : "" }) : ""}
        </div>
        ${state.settings.modules?.stock && d.lowStock.length ? html`
          <section class="card" data-testid="low-stock">
            <div class="card-head"><h2>Low stock</h2><a class="small" href="#/stock">Stock</a></div>
            <div class="lines">
              ${d.lowStock.map((r) => html`<div class="line">
                <span class="line-label wrap-anywhere"><a class="plain-link" href="#/stock/${r.item.id}">${r.item.name}</a> <span class="badge badge-${r.negative ? "danger" : "warning"}">${r.negative ? "Below zero" : "Low"}</span></span>
                <span class="line-value">${r.onHand} ${r.item.unit || ""}</span>
              </div>`)}
            </div>
          </section>` : ""}
      </div>`);
  },
};
