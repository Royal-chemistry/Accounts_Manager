// The ledger is worked out from the saved records every time, so it can never disagree with them.
import { num, round2 } from "./money.js";
import { inRange, monthLabel } from "./dates.js";

const nameOf = (list, id, fallback = "(removed)") => list.find((x) => x.id === id)?.name || fallback;

export function partyName(state, type, id, doc) {
  const list = type === "supplier" ? state.suppliers : state.clients;
  return list.find((x) => x.id === id)?.name || doc?.partyNameSnapshot || (id ? "(removed)" : "");
}

/** Which account a payment moves money in, or null when it isn't tracked. */
function accountFor(state, p) {
  if (p.untracked || p.mode === "credit") return null;
  return p.accountId || (p.mode === "cash" ? state.settings.defaults?.cashAccountId || null : null);
}

/** Every real movement of money, as { id, date, accountId, amount, kind, sourceType, sourceId, label, untracked }. */
export function postings(state) {
  const out = [];
  const push = (id, date, p, amount, kind, sourceType, sourceId, label) => {
    const accountId = accountFor(state, p);
    out.push({ id, date, accountId, amount, kind, sourceType, sourceId, label, mode: p.mode, untracked: !accountId });
  };
  for (const t of state.transactions) {
    const signed = t.type === "income" ? 1 : -1;
    const party = t.partyId ? partyName(state, t.partyType, t.partyId, t) : "";
    const label = [t.category, party, t.note].filter(Boolean).join(" · ");
    if (t.mode === "credit") {
      for (const p of t.payments || []) {
        push(p.id, p.date, p, signed * num(p.amount), t.type === "income" ? "creditReceipt" : "creditPayment", "transaction", t.id, label);
      }
    } else {
      push(t.id, t.date, t, signed * num(t.amount), t.type === "income" ? "income" : "expense", "transaction", t.id, label);
    }
  }
  for (const i of state.invoices) {
    for (const p of i.payments || []) {
      push(p.id, p.date, p, num(p.amount), "invoiceReceipt", "invoice", i.id, `Invoice ${i.no} · ${partyName(state, "client", i.clientId, i)}`);
    }
  }
  for (const b of state.purchases) {
    for (const p of b.payments || []) {
      push(p.id, p.date, p, -num(p.amount), "purchasePayment", "purchase", b.id, `Purchase ${b.billNo || ""} · ${partyName(state, "supplier", b.supplierId, b)}`.replace("  ", " "));
    }
  }
  for (const s of state.salaryPayments) {
    push(s.id, s.date, s, -num(s.amount), "salary", "salaryPayment", s.id, `Salary ${monthLabel(s.month)} · ${nameOf(state.staff, s.staffId)}`);
  }
  for (const a of state.advances) {
    push(a.id, a.date, a, -num(a.amount), "advance", "advance", a.id, `Advance · ${nameOf(state.staff, a.staffId)}`);
  }
  for (const l of state.loans) {
    for (const p of l.payments || []) push(p.id, p.date, p, -num(p.amount), "loan", "loan", l.id, `EMI · ${l.name}`);
  }
  for (const t of state.transfers) {
    const known = (id) => state.accounts.some((a) => a.id === id);
    const leg = (suffix, accountId, amount, label) => out.push({ id: `${t.id}:${suffix}`, date: t.date, accountId, amount, kind: "transfer", sourceType: "transfer", sourceId: t.id, label, mode: "bank", untracked: !known(accountId) });
    leg("out", t.from, -num(t.amount), `Transfer to ${nameOf(state.accounts, t.to, "another account")}`);
    leg("in", t.to, num(t.amount), `Transfer from ${nameOf(state.accounts, t.from, "another account")}`);
  }
  return out;
}

/** Current balance of every account, optionally as of a date. */
export function accountBalances(state, asOf) {
  const m = Object.fromEntries(state.accounts.map((a) => [a.id, num(a.opening)]));
  for (const p of postings(state)) {
    if (p.untracked || !(p.accountId in m)) continue;
    if (asOf && !(p.date <= asOf)) continue;
    m[p.accountId] += p.amount;
  }
  for (const k in m) m[k] = round2(m[k]);
  return m;
}

/** One account's statement for a period, oldest first, with a running balance. */
export function statement(state, accountId, { from, to } = {}) {
  const account = state.accounts.find((a) => a.id === accountId);
  const rows = postings(state)
    .filter((p) => p.accountId === accountId && !p.untracked)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let balance = num(account?.opening);
  const shown = [];
  let opening = balance;
  for (const p of rows) {
    if (from && String(p.date) < from) { balance += p.amount; opening = balance; continue; }
    if (to && String(p.date) > to) continue;
    balance += p.amount;
    shown.push({ ...p, balance: round2(balance) });
  }
  return { opening: round2(opening), rows: shown, closing: round2(balance) };
}

/** Whether an account has any movement that depends on it. */
export const accountInUse = (state, accountId) => postings(state).some((p) => p.accountId === accountId);

/** Interest on a loan payment, or nothing if it wasn't recorded. */
const principalOf = (p) => Math.max(0, num(p.amount) - num(p.interest));

export const loanPaid = (loan) => (loan.payments || []).reduce((t, p) => t + num(p.amount), 0);

/** What's left to repay. Only the principal part of each payment since the balance was last set counts. */
export function loanOutstanding(loan) {
  const repaid = (loan.payments || []).filter((p) => !loan.since || p.date >= loan.since).reduce((t, p) => t + principalOf(p), 0);
  return Math.max(0, num(loan.outstanding) - repaid);
}

/** A suggested interest figure from the loan's rate and balance, for pre-filling the payment form. */
export function suggestedInterest(loan) {
  const rate = num(loan.rate);
  return rate > 0 ? round2(loanOutstanding(loan) * rate / 100 / 12) : 0;
}

export const inPeriod = (p, from, to) => inRange(p.date, from, to);
