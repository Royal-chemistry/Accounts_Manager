import { readFileSync } from "node:fs";
import { migrate } from "../../js/core/migrate.js";

export const TODAY = "2026-11-07";

export const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const golden = (name) => fixture(`${name}.golden`);
export const migrated = (name) => migrate(fixture(name), { today: TODAY }).state;

/** The sample business plus suppliers, purchases, stock and credit, so every record type exists. */
export function richState() {
  const s = migrated("v1-sample");
  s.settings.modules.stock = true;
  s.suppliers = [
    { id: "sup1", name: "Acme Wholesale", contact: "", phone: "", email: "", gstin: "27AAPFU0939F1ZV", stateCode: "27", address: "", active: true },
    { id: "sup2", name: "Local Supplies", contact: "", phone: "", email: "", gstin: "", stateCode: "", address: "", active: true },
  ];
  s.items = [
    { id: "item1", name: "Widget", sku: "W-1", category: "Parts", unit: "pcs", purchasePrice: 100, salePrice: 150, gstRate: 18, hsn: "", openingQty: 10, openingCost: 100, reorderLevel: 11, active: true },
    { id: "item2", name: "Bolt", sku: "B-1", category: "Parts", unit: "box", purchasePrice: 50, salePrice: 80, gstRate: 5, hsn: "", openingQty: 0, openingCost: 0, reorderLevel: 0, active: true },
  ];
  s.purchases = [
    { id: "bill1", billNo: "A-1", supplierId: "sup1", date: "2026-10-05", due: "2026-10-20", taxInclusive: false, lines: [{ desc: "Widget", hsn: "", qty: 5, rate: 120, gstRate: 18, itemId: "item1" }], payments: [{ id: "bp1", date: "2026-10-10", amount: 200, tds: 0, note: "", settlementId: null, mode: "bank", accountId: "b1", untracked: false }] },
    { id: "bill2", billNo: "A-2", supplierId: "sup2", date: "2026-10-06", due: "", taxInclusive: false, lines: [{ desc: "Stationery", hsn: "", qty: 1, rate: 1000, gstRate: 0, itemId: null }], payments: [] },
  ];
  s.invoices.push({ id: "inv-stock", no: "ST-010", clientId: "c1", date: "2026-10-15", due: "2026-10-30", placeOfSupply: "", taxInclusive: false, reducesStock: true, lines: [{ desc: "Widget", hsn: "", qty: 3, rate: 150, gstRate: 18, itemId: "item1" }], payments: [] });
  s.stockMoves = [{ id: "mv1", itemId: "item1", date: "2026-10-20", reason: "damage", qty: 2, unitCost: 0, note: "Dropped" }];
  s.transactions.push(
    { id: "credit-exp", type: "expense", date: "2026-10-08", category: "Repairs", note: "On account", amount: 590, gstAmount: 90, gstRate: 18, scope: "business", partyType: "supplier", partyId: "sup1", due: "2026-10-25", recurringId: null, stockLine: null, payments: [], mode: "credit", accountId: null, untracked: false },
    { id: "personal", type: "expense", date: "2026-10-09", category: "Other", note: "Owner's phone", amount: 700, gstAmount: 0, scope: "personal", partyType: null, partyId: null, due: "", recurringId: null, stockLine: null, payments: [], mode: "cash", accountId: "b3", untracked: false },
  );
  return s;
}
