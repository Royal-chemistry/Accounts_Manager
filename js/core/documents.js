// Invoices, purchases and credit transactions: totals, GST, what's outstanding, and settling it.
import { num, round2 } from "./money.js";
import { uid } from "./ids.js";

/** What one line is worth before GST. */
export function lineTaxable(line, taxInclusive = false) {
  const gross = num(line.qty) * num(line.rate);
  return taxInclusive ? gross / (1 + num(line.gstRate) / 100) : gross;
}

/** Totals for an invoice or purchase. */
export function docTotals(doc) {
  const lines = doc.lines || [];
  const slabs = new Map();
  for (const l of lines) {
    const r = num(l.gstRate);
    slabs.set(r, (slabs.get(r) || 0) + num(l.qty) * num(l.rate));
  }
  const gstByRate = [];
  let subtotal, gst;
  if (doc.taxInclusive) {
    subtotal = 0; gst = 0;
    for (const [rate, raw] of slabs) {
      const gross = round2(raw);
      const taxable = round2(gross / (1 + rate / 100));
      const tax = round2(gross - taxable);
      gstByRate.push({ rate, taxable, gst: tax });
      subtotal += taxable; gst += tax;
    }
    subtotal = round2(subtotal); gst = round2(gst);
  } else {
    subtotal = Math.round([...slabs.values()].reduce((t, v) => t + v, 0) * 100) / 100;
    gst = 0;
    for (const [rate, raw] of slabs) {
      const taxable = Math.round(raw * 100) / 100;
      const tax = Math.round(taxable * rate / 100 * 100) / 100;
      gstByRate.push({ rate, taxable, gst: tax });
      gst += tax;
    }
    gst = round2(gst);
  }
  gstByRate.sort((a, b) => a.rate - b.rate);
  const total = round2(subtotal + gst);
  const received = (doc.payments || []).reduce((t, p) => t + num(p.amount), 0);
  const tds = (doc.payments || []).reduce((t, p) => t + num(p.tds), 0);
  const settled = received + tds;
  const balance = round2(total - settled);
  const status = total > 0 && balance <= 0.5 ? "paid" : settled > 0 ? "partial" : "unpaid";
  return { subtotal, gst, gstByRate, total, received, tds, balance: Math.max(0, balance), overpaid: Math.max(0, -balance), status };
}

/** What's still owed on a simple income or expense entry. Only credit entries can owe anything. */
export function txBalance(tx) {
  if (tx.mode !== "credit") return 0;
  const paid = (tx.payments || []).reduce((t, p) => t + num(p.amount) + num(p.tds), 0);
  return Math.max(0, round2(num(tx.amount) - paid));
}

/** The two-digit GST state code at the start of a GSTIN. */
export const stateFromGstin = (gstin) => {
  const code = String(gstin || "").trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : "";
};

/** IGST when the two states are known and differ, otherwise CGST and SGST split evenly. */
export function gstSplit(gst, bizState, partyState) {
  const amount = round2(gst);
  if (bizState && partyState && bizState !== partyState) return { cgst: 0, sgst: 0, igst: amount };
  const cgst = round2(amount / 2);
  return { cgst, sgst: round2(amount - cgst), igst: 0 };
}

const paidBy = (payments, asOf) => (payments || [])
  .filter((p) => !asOf || String(p.date) <= asOf)
  .reduce((t, p) => t + num(p.amount) + num(p.tds), 0);

/**
 * Everything still open on one side of the books, oldest due date first.
 * side: "receivable" (owed to the business) or "payable" (owed by the business).
 */
export function openDocs(state, side, { partyId, asOf } = {}) {
  const docs = [];
  const receivable = side === "receivable";
  for (const doc of receivable ? state.invoices : state.purchases) {
    const party = receivable ? doc.clientId : doc.supplierId;
    if (partyId && party !== partyId) continue;
    if (asOf && String(doc.date) > asOf) continue;
    const { total } = docTotals(doc);
    const balance = Math.max(0, round2(total - paidBy(doc.payments, asOf)));
    if (balance > 0) {
      docs.push({
        docType: receivable ? "invoice" : "purchase", id: doc.id, no: (receivable ? doc.no : doc.billNo) || "",
        date: doc.date, due: doc.due || "", total, balance, partyType: receivable ? "client" : "supplier", partyId: party, note: "",
      });
    }
  }
  for (const tx of state.transactions) {
    if (tx.mode !== "credit" || tx.type !== (receivable ? "income" : "expense")) continue;
    if (partyId && tx.partyId !== partyId) continue;
    if (asOf && String(tx.date) > asOf) continue;
    const balance = Math.max(0, round2(num(tx.amount) - paidBy(tx.payments, asOf)));
    if (balance > 0) {
      docs.push({
        docType: "transaction", id: tx.id, no: tx.opening ? "Opening balance" : tx.category || "", date: tx.date, due: tx.due || "",
        total: num(tx.amount), balance, partyType: tx.partyType, partyId: tx.partyId, note: tx.note || "",
      });
    }
  }
  return docs.sort((a, b) => (a.due || a.date || "").localeCompare(b.due || b.date || "") || (a.date || "").localeCompare(b.date || ""));
}

/** Total outstanding on one side of the books, optionally for one party. */
export const outstanding = (state, side, partyId) => round2(openDocs(state, side, { partyId }).reduce((t, d) => t + d.balance, 0));

/** Applies a payment to open documents, oldest first, never above any document's balance. */
export function allocatePayment(docs, amount) {
  let left = round2(amount);
  const allocations = [];
  for (const d of docs) {
    if (left <= 0) break;
    const take = round2(Math.min(left, d.balance));
    if (take > 0) { allocations.push({ docType: d.docType, id: d.id, amount: take }); left = round2(left - take); }
  }
  return { allocations, unallocated: left };
}

const COLLECTION = { invoice: "invoices", purchase: "purchases", transaction: "transactions" };

export const findDoc = (state, docType, id) => state[COLLECTION[docType]]?.find((d) => d.id === id);

/** Records one payment against one document. Changes state in place and returns the payment. */
export function addPayment(state, docType, id, payment) {
  const doc = findDoc(state, docType, id);
  if (!doc) throw new Error(`No ${docType} with id ${id}`);
  doc.payments ??= [];
  const record = { id: uid(), tds: 0, note: "", settlementId: null, untracked: false, ...payment, amount: round2(payment.amount) };
  doc.payments.push(record);
  return record;
}

/**
 * Records one real-world payment across several documents, linked by a settlementId so it can be undone as one.
 * Changes state in place. Throws rather than recording more than is owed.
 */
export function settle(state, { side, partyId, date, mode, accountId, note = "", allocations }) {
  const open = openDocs(state, side, { partyId });
  const settlementId = uid();
  for (const a of allocations) {
    const doc = open.find((d) => d.docType === a.docType && d.id === a.id);
    if (!doc) throw new Error("That document has nothing outstanding");
    if (round2(a.amount) > doc.balance) throw new Error(`Payment is more than the ${doc.balance} still owed`);
  }
  for (const a of allocations) {
    if (round2(a.amount) > 0) addPayment(state, a.docType, a.id, { date, amount: a.amount, mode, accountId, note, settlementId });
  }
  return settlementId;
}
