// Stock is always calculated from the records, never stored, so editing or deleting an invoice or
// purchase corrects it automatically. Costs use a moving weighted average.
import { num, round2 } from "./money.js";
import { inRange } from "./dates.js";
import { lineTaxable } from "./documents.js";

export const MOVE_REASONS = {
  usage: { label: "Used in the business", dir: "out", writeOff: true },
  damage: { label: "Damaged or lost", dir: "out", writeOff: true },
  return: { label: "Returned to stock", dir: "in" },
  adjustIn: { label: "Count adjustment (more)", dir: "in" },
  adjustOut: { label: "Count adjustment (less)", dir: "out", writeOff: true },
};

const roundQty = (q) => Math.round(q * 1000) / 1000;

function eventsFor(state) {
  const byItem = new Map(state.items.map((i) => [i.id, []]));
  const add = (itemId, e) => byItem.get(itemId)?.push(e);
  // Sequence keeps same-day order stable, with stock arriving before it leaves.
  for (const p of state.purchases) {
    for (const l of p.lines || []) {
      if (l.itemId) add(l.itemId, { date: p.date, dir: "in", reason: "purchase", qty: num(l.qty), unitCost: lineTaxable({ ...l, qty: 1 }, p.taxInclusive), sourceType: "purchase", sourceId: p.id, label: `Purchase ${p.billNo || ""}`.trim() });
    }
  }
  for (const i of state.invoices) {
    if (i.reducesStock === false) continue;
    for (const l of i.lines || []) {
      if (l.itemId) add(l.itemId, { date: i.date, dir: "out", reason: "sale", qty: num(l.qty), unitPrice: lineTaxable({ ...l, qty: 1 }, i.taxInclusive), sourceType: "invoice", sourceId: i.id, label: `Invoice ${i.no}` });
    }
  }
  for (const t of state.transactions) {
    const s = t.stockLine;
    if (s?.itemId) add(s.itemId, { date: t.date, dir: t.type === "income" ? "out" : "in", reason: t.type === "income" ? "sale" : "purchase", qty: num(s.qty), unitCost: num(s.rate), unitPrice: num(s.rate), sourceType: "transaction", sourceId: t.id, label: t.category || "Sale" });
  }
  for (const m of state.stockMoves) {
    const r = MOVE_REASONS[m.reason];
    if (r) add(m.itemId, { date: m.date, dir: r.dir, reason: m.reason, qty: num(m.qty), unitCost: num(m.unitCost), sourceType: "stockMove", sourceId: m.id, label: r.label + (m.note ? ` · ${m.note}` : ""), writeOff: !!r.writeOff });
  }
  return byItem;
}

/** The full stock picture: for each item, its history, quantity on hand, average cost and value. */
export function stockLedger(state) {
  const byItem = eventsFor(state);
  return state.items.map((item) => {
    const openingQty = num(item.openingQty);
    const fallbackCost = num(item.openingCost) || num(item.purchasePrice);
    let qty = openingQty, avg = fallbackCost;
    const events = (byItem.get(item.id) || []).slice().sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) || (a.dir === b.dir ? 0 : a.dir === "in" ? -1 : 1));
    const history = [];
    for (const e of events) {
      if (e.dir === "in") {
        const cost = e.unitCost || avg || fallbackCost;
        const held = Math.max(0, qty);
        avg = held + e.qty > 0 ? (held * avg + e.qty * cost) / (held + e.qty) : cost;
        qty = roundQty(qty + e.qty);
        history.push({ ...e, unitCost: cost, costAmount: round2(e.qty * cost), balance: qty, avgCost: avg });
      } else {
        const cost = avg || fallbackCost;
        qty = roundQty(qty - e.qty);
        history.push({ ...e, unitCost: cost, costAmount: round2(e.qty * cost), balance: qty, avgCost: avg });
      }
    }
    const reorder = num(item.reorderLevel);
    return {
      item, openingQty, history, onHand: qty, avgCost: avg,
      value: round2(Math.max(0, qty) * avg),
      belowReorder: item.active !== false && reorder > 0 && qty <= reorder,
      negative: qty < 0,
    };
  });
}

export const onHand = (state, itemId) => stockLedger(state).find((r) => r.item.id === itemId)?.onHand ?? 0;
export const valuation = (ledger) => round2(ledger.reduce((t, r) => t + r.value, 0));
export const lowStock = (ledger) => ledger.filter((r) => r.belowReorder);

/** Cost of stock sold in a period, and cost of stock written off in a period. */
export function stockCosts(ledger, from, to) {
  let cogs = 0, writeOffs = 0;
  for (const r of ledger) {
    for (const e of r.history) {
      if (!inRange(e.date, from, to)) continue;
      if (e.reason === "sale") cogs += e.costAmount;
      else if (e.writeOff) writeOffs += e.costAmount;
    }
  }
  return { cogs: round2(cogs), writeOffs: round2(writeOffs) };
}

/** Whether a line on a purchase adds to stock, as opposed to being an ordinary expense. */
export const isStockLine = (state, line) => !!line.itemId && state.items.some((i) => i.id === line.itemId);
