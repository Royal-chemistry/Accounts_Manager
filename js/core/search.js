// Search across the whole business, for the Search tab.
import { docTotals } from "./documents.js";
import { partyName } from "./ledger.js";
import { num } from "./money.js";

const PER_GROUP = 6;

/**
 * Finds records matching a query. Every word has to match somewhere in the record.
 * Returns [{ title, results: [{ key, name, detail, href, amount }] }], leaving out groups with no matches.
 */
export function searchAll(state, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const matches = (...parts) => {
    const text = parts.filter((p) => p !== null && p !== undefined).join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const modules = state.settings.modules ?? {};
  const groups = [
    { title: "Clients", results: state.clients.filter((c) => matches(c.name, c.contact, c.phone, c.gstin)).map((c) => ({ key: `client:${c.id}`, name: c.name, detail: c.contact || c.gstin || "", href: `clients/${c.id}` })) },
    { title: "Suppliers", results: state.suppliers.filter((c) => matches(c.name, c.contact, c.phone, c.gstin)).map((c) => ({ key: `supplier:${c.id}`, name: c.name, detail: c.contact || c.gstin || "", href: `suppliers/${c.id}` })) },
    { title: "Invoices", results: state.invoices.map((i) => ({ i, party: partyName(state, "client", i.clientId, i) })).filter(({ i, party }) => matches(i.no, party)).map(({ i, party }) => ({ key: `invoice:${i.id}`, name: i.no, detail: party, href: `invoices/${i.id}`, amount: docTotals(i).total })) },
    { title: "Purchases", results: state.purchases.map((b) => ({ b, party: partyName(state, "supplier", b.supplierId, b) })).filter(({ b, party }) => matches(b.billNo, party)).map(({ b, party }) => ({ key: `purchase:${b.id}`, name: b.billNo || party, detail: party, href: `purchases/${b.id}`, amount: docTotals(b).total })) },
    ...(modules.payroll !== false ? [{ title: "Staff", results: state.staff.filter((s) => matches(s.name, s.code, s.team, s.position)).map((s) => ({ key: `staff:${s.id}`, name: s.name, detail: [s.position, s.team].filter(Boolean).join(" · "), href: `staff/${s.id}` })) }] : []),
    ...(modules.stock ? [{ title: "Stock", results: state.items.filter((i) => matches(i.name, i.sku, i.category)).map((i) => ({ key: `item:${i.id}`, name: i.name, detail: [i.sku, i.category].filter(Boolean).join(" · "), href: `stock/${i.id}` })) }] : []),
    { title: "Cash book", results: state.transactions.filter((t) => !t.opening && matches(t.category, t.note)).map((t) => ({ key: `entry:${t.id}`, name: t.note || t.category || "Entry", detail: t.category || "", href: "cashbook", amount: num(t.amount) })) },
  ];
  return groups.filter((g) => g.results.length).map((g) => ({ ...g, more: Math.max(0, g.results.length - PER_GROUP), results: g.results.slice(0, PER_GROUP) }));
}
