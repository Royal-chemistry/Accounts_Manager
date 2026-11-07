// Safe deletes. impactOf explains what a delete would do. moveToBin and restoreFromBin never lose anything:
// each bin entry keeps every record the delete removed, so restoring puts everything back as it was.
import { uid } from "./ids.js";
import { formatMoney, num, round2 } from "./money.js";
import { formatDate, monthLabel, monthOf } from "./dates.js";
import { docTotals, txBalance } from "./documents.js";
import { accountInUse, loanOutstanding, loanPaid, partyName, postings } from "./ledger.js";
import { stockLedger, MOVE_REASONS } from "./stock.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const BIN_TYPES = {
  invoice: "Invoice", purchase: "Purchase", transaction: "Cash book entry", payment: "Payment", client: "Client", supplier: "Supplier",
  staff: "Staff member", advance: "Advance", salaryPayment: "Salary payment", account: "Account", transfer: "Transfer",
  loan: "Loan", loanPayment: "Loan payment", recurring: "Recurring payment", item: "Stock item", stockMove: "Stock movement",
};

const TOP_LEVEL = {
  invoice: "invoices", purchase: "purchases", transaction: "transactions", client: "clients", supplier: "suppliers", staff: "staff", advance: "advances",
  salaryPayment: "salaryPayments", account: "accounts", transfer: "transfers", loan: "loans", recurring: "recurring", item: "items", stockMove: "stockMoves",
};

const PAYMENT_PARENTS = [["invoice", "invoices"], ["purchase", "purchases"], ["transaction", "transactions"]];

/** Finds an invoice, purchase or transaction payment, and the payments settled together with it. */
function findPaymentGroup(state, id) {
  for (const [docType, collection] of PAYMENT_PARENTS) {
    for (const doc of state[collection]) {
      const p = (doc.payments || []).find((x) => x.id === id);
      if (!p) continue;
      if (!p.settlementId) return [{ docType, collection, doc, payment: p }];
      const group = [];
      for (const [t, c] of PAYMENT_PARENTS) {
        for (const d of state[c]) for (const q of d.payments || []) if (q.settlementId === p.settlementId) group.push({ docType: t, collection: c, doc: d, payment: q });
      }
      return group;
    }
  }
  return [];
}

function collect(state, type, id) {
  const payload = { docs: [], nested: [], maps: [], links: [], names: {} };
  const addDocs = (collection, match) => state[collection].forEach((doc, index) => { if (match(doc)) payload.docs.push({ collection, index, doc }); });
  const addMap = (map, match) => {
    for (const [month, rows] of Object.entries(state[map])) for (const key of Object.keys(rows)) if (match(key)) payload.maps.push({ map, month, key, value: rows[key] });
  };
  if (type === "payment") {
    for (const { collection, doc, payment } of findPaymentGroup(state, id)) {
      payload.nested.push({ collection, parentId: doc.id, field: "payments", index: doc.payments.indexOf(payment), doc: payment });
    }
  } else if (type === "loanPayment") {
    for (const loan of state.loans) {
      const index = (loan.payments || []).findIndex((p) => p.id === id);
      if (index >= 0) payload.nested.push({ collection: "loans", parentId: loan.id, field: "payments", index, doc: loan.payments[index] });
    }
  } else {
    addDocs(TOP_LEVEL[type], (d) => d.id === id);
    if (type === "client") {
      addDocs("invoices", (d) => d.clientId === id);
      addDocs("transactions", (d) => d.partyType === "client" && d.partyId === id);
    } else if (type === "supplier") {
      addDocs("purchases", (d) => d.supplierId === id);
      addDocs("transactions", (d) => d.partyType === "supplier" && d.partyId === id);
    } else if (type === "staff") {
      addDocs("advances", (d) => d.staffId === id);
      addDocs("salaryPayments", (d) => d.staffId === id);
      addMap("entries", (k) => k === id);
      addMap("attendance", (k) => k === id);
    } else if (type === "item") {
      addDocs("stockMoves", (d) => d.itemId === id);
    }
  }
  // Keep names and recurring links so a restore can put them back.
  for (const { collection, doc } of payload.docs) {
    if (collection === "invoices") payload.names[doc.id] = partyName(state, "client", doc.clientId, doc);
    if (collection === "purchases") payload.names[doc.id] = partyName(state, "supplier", doc.supplierId, doc);
    if (collection === "transactions") {
      if (doc.partyId) payload.names[doc.id] = partyName(state, doc.partyType, doc.partyId, doc);
      const r = state.recurring.find((x) => x.id === doc.recurringId);
      for (const [month, txId] of Object.entries(r?.paid || {})) if (txId === doc.id) payload.links.push({ recurringId: r.id, month, txId });
    }
  }
  return payload;
}

/** Money effects on each account of removing these records, as readable sentences. */
function accountEffects(state, payload, money) {
  const ids = new Set();
  const sources = new Set();
  for (const n of payload.nested) ids.add(n.doc.id);
  for (const d of payload.docs) {
    ids.add(d.doc.id);
    sources.add(d.doc.id);
    for (const p of d.doc.payments || []) ids.add(p.id);
  }
  const byAccount = new Map();
  for (const p of postings(state)) {
    const hit = ids.has(p.id) || (p.kind === "transfer" && sources.has(p.sourceId));
    if (!hit || p.untracked) continue;
    byAccount.set(p.accountId, (byAccount.get(p.accountId) || 0) + p.amount);
  }
  const lines = [];
  for (const [accountId, change] of byAccount) {
    const delta = round2(change);
    if (!delta) continue;
    const name = state.accounts.find((a) => a.id === accountId)?.name || "An account";
    lines.push(`${name} balance goes ${delta > 0 ? "down" : "up"} by ${money(Math.abs(delta))}`);
  }
  return lines;
}

function stockEffects(state, payload) {
  const ledger = stockLedger(state);
  const changes = new Map();
  const note = (itemId, delta) => changes.set(itemId, (changes.get(itemId) || 0) + delta);
  for (const { collection, doc } of payload.docs) {
    if (collection === "invoices" && doc.reducesStock !== false) for (const l of doc.lines || []) if (l.itemId) note(l.itemId, num(l.qty));
    if (collection === "purchases") for (const l of doc.lines || []) if (l.itemId) note(l.itemId, -num(l.qty));
    if (collection === "transactions" && doc.stockLine?.itemId) note(doc.stockLine.itemId, doc.type === "income" ? num(doc.stockLine.qty) : -num(doc.stockLine.qty));
    if (collection === "stockMoves" && MOVE_REASONS[doc.reason]) note(doc.itemId, MOVE_REASONS[doc.reason].dir === "in" ? -num(doc.qty) : num(doc.qty));
  }
  const affects = [], warnings = [];
  for (const [itemId, delta] of changes) {
    const row = ledger.find((r) => r.item.id === itemId);
    if (!row || !delta) continue;
    const after = row.onHand + delta;
    affects.push(`Stock of ${row.item.name} goes ${delta > 0 ? "up" : "down"} by ${Math.abs(delta)} ${row.item.unit || ""}`.trim());
    if (after < 0) warnings.push(`${row.item.name} would drop to ${after} in stock, because some of it has already been sold or used`);
  }
  return { affects, warnings };
}

/** What a delete will remove and what else it changes, for the warning modal. */
export function impactOf(state, type, id) {
  const money = (n) => formatMoney(n, state.profile.currency);
  const payload = collect(state, type, id);
  const out = { type, id, title: "", label: "", amount: 0, removes: [], affects: [], warnings: [], blockers: [], alternative: null };
  const doc = payload.docs.find((d) => d.collection === TOP_LEVEL[type])?.doc;
  const countOf = (collection) => payload.docs.filter((d) => d.collection === collection).length;

  if (type === "invoice" || type === "purchase") {
    const t = docTotals(doc);
    const name = type === "invoice" ? `Invoice ${doc.no}` : `Purchase${doc.billNo ? " " + doc.billNo : ""}`;
    const party = type === "invoice" ? partyName(state, "client", doc.clientId, doc) : partyName(state, "supplier", doc.supplierId, doc);
    out.label = `${name} · ${party}`;
    out.amount = t.total;
    out.title = `Delete ${name}?`;
    out.removes.push(`${name} for ${money(t.total)}`);
    if (doc.payments?.length) out.removes.push(`${plural(doc.payments.length, "payment")} totalling ${money(t.received)}`);
    if (t.balance > 0) out.affects.push(`${party} will show ${money(t.balance)} less outstanding`);
  } else if (type === "transaction") {
    out.label = [doc.category, doc.note].filter(Boolean).join(" · ") || BIN_TYPES.transaction;
    out.amount = num(doc.amount);
    out.title = `Delete this ${doc.type === "income" ? "income" : "expense"} entry?`;
    out.removes.push(`${doc.type === "income" ? "Income" : "Expense"} of ${money(doc.amount)} on ${formatDate(doc.date)}`);
    if (doc.payments?.length) out.removes.push(`${plural(doc.payments.length, "payment")} made against it`);
    if (txBalance(doc) > 0) out.affects.push(`${partyName(state, doc.partyType, doc.partyId, doc)} will show ${money(txBalance(doc))} less outstanding`);
    for (const l of payload.links) {
      const r = state.recurring.find((x) => x.id === l.recurringId);
      out.affects.push(`${r.name} for ${monthLabel(l.month)} goes back to unpaid`);
    }
  } else if (type === "payment") {
    const n = payload.nested.length;
    const total = payload.nested.reduce((t, x) => t + num(x.doc.amount), 0);
    out.amount = round2(total);
    out.label = n > 1 ? `Settlement of ${money(total)}` : `Payment of ${money(total)}`;
    out.title = n > 1 ? `Undo this settlement of ${money(total)}?` : `Delete this payment of ${money(total)}?`;
    if (n > 1) out.removes.push(`${plural(n, "payment")} recorded together, totalling ${money(total)}`);
    else out.removes.push(`Payment of ${money(total)} on ${formatDate(payload.nested[0]?.doc.date)}`);
    for (const x of payload.nested) {
      const parent = state[x.collection].find((d) => d.id === x.parentId);
      const owed = parent.lines ? docTotals(parent).balance : txBalance(parent);
      const name = parent.lines ? (parent.no ? `Invoice ${parent.no}` : `Purchase ${parent.billNo || ""}`.trim()) : parent.category || "This entry";
      out.affects.push(`${name} will show ${money(owed + num(x.doc.amount) + num(x.doc.tds))} outstanding`);
    }
  } else if (type === "client" || type === "supplier") {
    const docsName = type === "client" ? "invoice" : "purchase";
    const n = countOf(type === "client" ? "invoices" : "purchases");
    const entries = countOf("transactions");
    out.label = doc.name;
    out.title = `Delete ${doc.name}?`;
    out.removes.push(`${type === "client" ? "Client" : "Supplier"} ${doc.name}`);
    if (n) out.removes.push(plural(n, docsName) + " and their payments");
    if (entries) out.removes.push(`${plural(entries, "cash book entry", "cash book entries")} linked to them`);
    if (n || entries) out.alternative = { action: "inactive", label: "Mark inactive instead", note: "Keeps their history and reports intact, and hides them from new entries." };
  } else if (type === "staff") {
    const months = payload.maps.filter((m) => m.map === "entries").length;
    const advances = countOf("advances"), paid = countOf("salaryPayments");
    out.label = doc.name || "Unnamed staff member";
    out.title = `Delete ${out.label}?`;
    out.removes.push(`Staff member ${out.label}`);
    if (months) out.removes.push(`${plural(months, "month")} of pay records`);
    if (advances) out.removes.push(plural(advances, "advance"));
    if (paid) out.removes.push(plural(paid, "salary payment"));
    if (months || advances || paid) out.alternative = { action: "inactive", label: "Mark inactive instead", note: "Keeps their pay history and reports intact, and takes them off future salary sheets." };
  } else if (type === "advance") {
    const staff = state.staff.find((s) => s.id === doc.staffId);
    out.label = `Advance · ${staff?.name || "(removed)"}`;
    out.amount = num(doc.amount);
    out.title = `Delete this advance of ${money(doc.amount)}?`;
    out.removes.push(`Advance of ${money(doc.amount)} on ${formatDate(doc.date)}`);
    if (staff) out.affects.push(`${staff.name}'s pay for ${monthLabel(monthOf(doc.date))} goes up by ${money(doc.amount)}`);
  } else if (type === "salaryPayment") {
    const staff = state.staff.find((s) => s.id === doc.staffId);
    out.label = `Salary ${monthLabel(doc.month)} · ${staff?.name || "(removed)"}`;
    out.amount = num(doc.amount);
    out.title = `Undo this salary payment of ${money(doc.amount)}?`;
    out.removes.push(`Salary payment of ${money(doc.amount)} on ${formatDate(doc.date)}`);
    if (staff) out.affects.push(`${staff.name}'s salary for ${monthLabel(doc.month)} goes back to unpaid`);
  } else if (type === "account") {
    out.label = doc.name;
    out.title = `Delete ${doc.name}?`;
    out.removes.push(`Account ${doc.name}`);
    if (accountInUse(state, id) || state.transfers.some((t) => t.from === id || t.to === id)) {
      out.blockers.push(`${doc.name} has transactions, and removing it would rewrite your history.`);
      out.alternative = { action: "close", label: "Close account instead", note: "Keeps its history, and hides it from new entries." };
    } else if (state.settings.defaults?.cashAccountId === id) {
      out.blockers.push(`${doc.name} is your default cash account, so cash entries depend on it.`);
    }
  } else if (type === "transfer") {
    out.label = "Transfer";
    out.amount = num(doc.amount);
    out.title = `Delete this transfer of ${money(doc.amount)}?`;
    out.removes.push(`Transfer of ${money(doc.amount)} on ${formatDate(doc.date)}`);
  } else if (type === "loan") {
    out.label = doc.name;
    out.amount = loanOutstanding(doc);
    out.title = `Delete ${doc.name}?`;
    out.removes.push(`Loan ${doc.name}`);
    if (doc.payments?.length) out.removes.push(`${plural(doc.payments.length, "payment")} totalling ${money(loanPaid(doc))}`);
  } else if (type === "loanPayment") {
    const n = payload.nested[0];
    const loan = state.loans.find((l) => l.id === n?.parentId);
    out.label = `EMI · ${loan?.name || ""}`;
    out.amount = num(n?.doc.amount);
    out.title = `Delete this loan payment of ${money(n?.doc.amount)}?`;
    out.removes.push(`Payment of ${money(n?.doc.amount)} on ${formatDate(n?.doc.date)}`);
    if (loan) out.affects.push(`${loan.name} will show more left to repay`);
  } else if (type === "recurring") {
    out.label = doc.name;
    out.amount = num(doc.amount);
    out.title = `Delete ${doc.name}?`;
    out.removes.push(`The ${doc.name} schedule`);
    out.affects.push("Past payments stay in the cash book");
  } else if (type === "item") {
    const moves = countOf("stockMoves");
    const lines = [...state.invoices, ...state.purchases].filter((d) => (d.lines || []).some((l) => l.itemId === id)).length;
    out.label = doc.name;
    out.title = `Delete ${doc.name}?`;
    out.removes.push(`Stock item ${doc.name}`);
    if (moves) out.removes.push(plural(moves, "stock movement"));
    if (lines) out.affects.push(`${plural(lines, "invoice or purchase", "invoices and purchases")} keep their text but lose the link to this item`);
    if (moves || lines) out.alternative = { action: "inactive", label: "Mark inactive instead", note: "Keeps its history, and hides it from new entries." };
  } else if (type === "stockMove") {
    const item = state.items.find((i) => i.id === doc.itemId);
    out.label = `${MOVE_REASONS[doc.reason]?.label || "Movement"} · ${item?.name || "(removed)"}`;
    out.title = "Delete this stock movement?";
    out.removes.push(`${MOVE_REASONS[doc.reason]?.label || "Movement"} of ${doc.qty} ${item?.unit || ""}`.trim());
  }
  out.affects.unshift(...accountEffects(state, payload, money));
  const stock = stockEffects(state, payload);
  out.affects.push(...stock.affects);
  out.warnings.push(...stock.warnings);
  return out;
}

function removePayload(state, payload) {
  for (const { collection, doc } of payload.docs) state[collection] = state[collection].filter((d) => d.id !== doc.id);
  for (const n of payload.nested) {
    const parent = state[n.collection].find((d) => d.id === n.parentId);
    if (parent) parent[n.field] = parent[n.field].filter((p) => p.id !== n.doc.id);
  }
  for (const m of payload.maps) delete state[m.map][m.month]?.[m.key];
  for (const l of payload.links) {
    const r = state.recurring.find((x) => x.id === l.recurringId);
    if (r?.paid) delete r.paid[l.month];
  }
}

/** Moves a record and everything linked to it into the bin. Returns the new state and the bin entry. */
export function moveToBin(state, type, id, { now = new Date() } = {}) {
  const impact = impactOf(state, type, id);
  if (impact.blockers.length) throw new Error(impact.blockers[0]);
  const next = structuredClone(state);
  const payload = collect(next, type, id);
  if (!payload.docs.length && !payload.nested.length) throw new Error("That record no longer exists");
  removePayload(next, payload);
  const entry = { id: uid(), type, label: impact.label, amount: impact.amount, deletedAt: now.toISOString(), payload };
  next.bin = [entry, ...(next.bin || [])];
  return { state: next, entry };
}

/**
 * Puts a bin entry back. Returns { ok, state, warnings }, or { ok: false, reason } if it can't be restored.
 * Restoring never changes a balance silently: anything that can't be linked back is reported.
 */
export function restoreFromBin(state, binId) {
  const entry = (state.bin || []).find((e) => e.id === binId);
  if (!entry) return { ok: false, reason: "That item is no longer in the Recycle Bin", state };
  const next = structuredClone(state);
  const { payload } = structuredClone(entry);
  for (const n of payload.nested) {
    if (!next[n.collection].some((d) => d.id === n.parentId)) {
      const inBin = (state.bin || []).some((e) => e.payload.docs.some((d) => d.collection === n.collection && d.doc.id === n.parentId));
      return {
        ok: false, state,
        reason: inBin ? "The record this payment belongs to is also in the Recycle Bin. Restore that first." : "The record this payment belongs to has been permanently deleted, so it can't be restored.",
      };
    }
  }
  const warnings = [];
  for (const { collection, index, doc } of payload.docs.slice().sort((a, b) => a.index - b.index)) {
    if (next[collection].some((d) => d.id === doc.id)) continue;
    next[collection].splice(Math.min(index, next[collection].length), 0, doc);
  }
  for (const n of payload.nested.slice().sort((a, b) => a.index - b.index)) {
    const parent = next[n.collection].find((d) => d.id === n.parentId);
    parent[n.field] ??= [];
    parent[n.field].splice(Math.min(n.index, parent[n.field].length), 0, n.doc);
  }
  for (const m of payload.maps) {
    next[m.map][m.month] ??= {};
    next[m.map][m.month][m.key] = m.value;
  }
  for (const l of payload.links) {
    const r = next.recurring.find((x) => x.id === l.recurringId);
    if (!r) continue;
    r.paid ??= {};
    if (r.paid[l.month]) warnings.push(`${r.name} was paid again for ${monthLabel(l.month)} after this was deleted, so check for a duplicate.`);
    else r.paid[l.month] = l.txId;
  }
  // Report anything that points at a record that's gone for good.
  const hasAccount = (id) => next.accounts.some((a) => a.id === id);
  const accountGone = (p) => p.accountId && !p.untracked && !hasAccount(p.accountId);
  for (const { collection, doc } of payload.docs) {
    const party = collection === "invoices" ? ["client", doc.clientId] : collection === "purchases" ? ["supplier", doc.supplierId] : collection === "transactions" && doc.partyId ? [doc.partyType, doc.partyId] : null;
    if (party) {
      const list = party[0] === "supplier" ? next.suppliers : next.clients;
      if (!list.some((x) => x.id === party[1])) {
        const live = next[collection].find((d) => d.id === doc.id);
        if (live) live.partyNameSnapshot = payload.names[doc.id];
        warnings.push(`${payload.names[doc.id] || "Its client or supplier"} no longer exists, so this keeps the saved name and needs re-linking.`);
      }
    }
    if ([doc, ...(doc.payments || [])].some(accountGone)) warnings.push("The account it used no longer exists, so it isn't counted in any balance until you pick another.");
  }
  if (payload.nested.some((n) => accountGone(n.doc))) warnings.push("The account it used no longer exists, so it isn't counted in any balance until you pick another.");
  next.bin = next.bin.filter((e) => e.id !== binId);
  return { ok: true, state: next, warnings: [...new Set(warnings)] };
}

export function purgeFromBin(state, binId) {
  return { ...state, bin: (state.bin || []).filter((e) => e.id !== binId) };
}

export const emptyBin = (state) => ({ ...state, bin: [] });
