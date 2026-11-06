// Moves saved data to the current schema. Each step is pure, and the v1 step is checked figure by figure
// before anything is allowed to switch over.
import { addMonths, isMonth, monthOf } from "./dates.js";
import { num, round2 } from "./money.js";
import { docTotals, stateFromGstin } from "./documents.js";
import { accountBalances } from "./ledger.js";
import { computePay, payFor } from "./payroll.js";
import { COMMON_EXPENSE, COMMON_INCOME, presetFor } from "./presets.js";
import { isSafeId } from "./ids.js";
import { normalize, SCHEMA_VERSION } from "./schema.js";

export class MigrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MigrationError";
    this.code = code; // "newer" | "unrecognised" | "verify"
  }
}

const str = (v) => (v == null ? "" : String(v));
const cell = (v) => (v === "" || v == null ? "" : num(v));
const GSTIN_IN_TEXT = /[\s·,|;-]*(?:GSTIN\s*[:\-]?\s*)?\b(\d{2}[A-Za-z]{5}\d{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z])\b/;

/** Replaces any unsafe record ID with a safe one, consistently everywhere it's used. */
function idCleaner() {
  const map = new Map();
  let n = 0;
  return (id) => {
    if (id == null || id === "") return "";
    const key = String(id);
    if (isSafeId(key)) return key;
    if (!map.has(key)) map.set(key, `migrated-${++n}`);
    return map.get(key);
  };
}

/** v1 defaults, the same ones the v1 app applied when loading. */
function withV1Defaults(raw, today) {
  const settings = { agency: "", address: "", month: addMonths(monthOf(today), -1), basis: "calendar", capAtFull: false, pf: false, esi: false, specialRate: 800, messRate: 140, gstRate: 18, prefix: "INV-", nextInv: 1, bankLine: "", ...raw.settings };
  return { guards: [], entries: {}, cash: [], advances: [], salaryPaid: {}, clients: [], invoices: [], banks: [], transfers: [], loans: [], recurring: [], ...raw, settings };
}

function v1to2(raw, today) {
  const v1 = withV1Defaults(raw, today);
  const clean = idCleaner();
  const made = { n: 0 };
  const newId = (prefix, id) => clean(id) || `${prefix}-${++made.n}`;

  const accounts = v1.banks.map((b) => ({
    id: newId("account", b.id), name: str(b.name), kind: /cash/i.test(str(b.name)) ? "cash" : "bank", accountNo: str(b.accountNo), opening: num(b.opening), active: true,
  }));
  const kindOf = new Map(accounts.map((a) => [a.id, a.kind]));
  const toPayment = (bankId) => {
    const id = clean(bankId);
    return kindOf.has(id) ? { mode: kindOf.get(id), accountId: id, untracked: false } : { mode: "cash", accountId: null, untracked: true };
  };
  let cashId = accounts.find((a) => a.kind === "cash")?.id;
  if (!cashId) {
    cashId = accounts.some((a) => a.id === "cash") ? "cash-in-hand" : "cash";
    accounts.push({ id: cashId, name: "Cash in hand", kind: "cash", accountNo: "", opening: 0, active: true });
  }

  const address = str(v1.settings.address);
  const found = address.match(GSTIN_IN_TEXT);
  const gstin = found ? found[1].toUpperCase() : "";

  const invoices = v1.invoices.map((inv) => ({
    id: newId("invoice", inv.id), no: str(inv.no), clientId: clean(inv.clientId), date: str(inv.date), due: str(inv.due),
    placeOfSupply: "", taxInclusive: false, reducesStock: false,
    lines: (inv.items || []).map((it) => ({ desc: str(it.desc), hsn: "", qty: num(it.qty), rate: num(it.rate), gstRate: inv.gst ? num(inv.gstRate) : 0, itemId: null })),
    payments: (inv.payments || []).map((p) => ({ id: newId("payment", p.id), date: str(p.date), amount: num(p.amount), tds: num(p.tds), note: str(p.note), settlementId: null, ...toPayment(p.bankId) })),
  }));

  const transactions = v1.cash.map((c) => ({
    id: newId("entry", c.id), type: c.type === "income" ? "income" : "expense", date: str(c.date), category: str(c.category), note: str(c.note), amount: num(c.amount),
    gstAmount: 0, scope: "business", partyType: null, partyId: null, due: "", recurringId: c.recurringId ? clean(c.recurringId) : null, stockLine: null, payments: [], ...toPayment(c.bankId),
  }));

  const salaryPayments = [];
  for (const [month, rows] of Object.entries(v1.salaryPaid || {})) {
    for (const [staffId, p] of Object.entries(rows || {})) {
      salaryPayments.push({ id: `salary-${++made.n}`, staffId: clean(staffId), month, date: str(p.date), amount: num(p.amount), ...toPayment(p.bankId) });
    }
  }

  const entries = {};
  for (const [month, rows] of Object.entries(v1.entries || {})) {
    entries[month] = {};
    for (const [staffId, e] of Object.entries(rows || {})) {
      entries[month][clean(staffId)] = {
        daysWorked: cell(e.duties), extraShifts: cell(e.specialDuties), extraRate: cell(e.specialRate), bonus: cell(e.bonus), advance: cell(e.advance),
        foodDays: cell(e.messDays), foodRate: cell(e.messRate), kit: cell(e.uniform), other: cell(e.other), hold: false,
      };
    }
  }

  const recurring = v1.recurring.map((r) => {
    const paid = {};
    for (const [month, id] of Object.entries(r.paid || {})) paid[month] = clean(id);
    const months = Object.keys(paid).filter(isMonth).sort();
    const pref = toPayment(r.bankId);
    return {
      id: newId("recurring", r.id), name: str(r.name), category: str(r.category), amount: num(r.amount), frequency: "monthly", dueDay: Math.min(31, Math.max(1, Math.round(num(r.dueDay)) || 1)),
      startMonth: months[0] || (isMonth(v1.settings.month) ? v1.settings.month : monthOf(today)), variable: false, active: true, note: str(r.note), paid,
      mode: pref.mode, accountId: pref.accountId,
    };
  });

  const preset = presetFor("other");
  const usedExpense = [...transactions.filter((t) => t.type === "expense").map((t) => t.category), ...recurring.map((r) => r.category)];
  const usedIncome = transactions.filter((t) => t.type === "income").map((t) => t.category);
  const unique = (list) => [...new Set(list.map((s) => str(s).trim()).filter(Boolean))];

  return {
    schemaVersion: 2,
    profile: {
      onboarded: false, name: str(v1.settings.agency), type: "", typeOther: "", gstin, stateCode: stateFromGstin(gstin), phone: "", email: "", logo: "", fyStartMonth: 4, currency: "INR",
      address: found ? address.replace(GSTIN_IN_TEXT, "").replace(/[\s·,|;-]+$/, "").trim() : address,
    },
    settings: {
      month: isMonth(v1.settings.month) ? v1.settings.month : addMonths(monthOf(today), -1),
      lastBackupAt: null,
      modules: { stock: false, payroll: true, gst: true },
      pay: { basis: str(v1.settings.basis) || "calendar", capAtFull: !!v1.settings.capAtFull, pf: !!v1.settings.pf, esi: !!v1.settings.esi, extraRate: num(v1.settings.specialRate), foodRate: num(v1.settings.messRate), paidLeave: false },
      invoice: { prefix: str(v1.settings.prefix), nextNo: num(v1.settings.nextInv) || 1, gstRate: num(v1.settings.gstRate), dueDays: 15, bankLine: str(v1.settings.bankLine), terms: "" },
      defaults: { cashAccountId: cashId, upiAccountId: accounts.find((a) => a.kind === "bank")?.id || null },
    },
    categories: { expense: unique([...usedExpense, ...COMMON_EXPENSE]), income: unique([...usedIncome, ...COMMON_INCOME]), units: preset.units, stock: [] },
    staff: v1.guards.map((g) => ({
      id: newId("staff", g.id), name: str(g.name), code: "", team: str(g.site), position: "", joinedOn: "", active: true, salary: num(g.salary),
      bank: str(g.bank), account: str(g.account), ifsc: str(g.ifsc), upi: str(g.upi), phone: str(g.phone),
    })),
    entries,
    attendance: {},
    advances: v1.advances.map((a) => ({ id: newId("advance", a.id), staffId: clean(a.staffId), date: str(a.date), amount: num(a.amount), note: str(a.note), ...toPayment(a.bankId) })),
    salaryPayments,
    clients: v1.clients.map((c) => ({
      id: newId("client", c.id), name: str(c.name), contact: str(c.contact), phone: str(c.phone), email: str(c.email), gstin: str(c.gstin), stateCode: stateFromGstin(c.gstin), address: str(c.address),
      rate: num(c.rate), gst: c.gst !== false, active: true,
    })),
    suppliers: [],
    invoices,
    purchases: [],
    transactions,
    accounts,
    transfers: v1.transfers.map((t) => ({ id: newId("transfer", t.id), date: str(t.date), from: clean(t.from), to: clean(t.to), amount: num(t.amount), note: str(t.note) })),
    loans: v1.loans.map((l) => ({
      id: newId("loan", l.id), name: str(l.name), lender: str(l.lender), principal: "", rate: "", emi: num(l.emi), dueDay: l.dueDay ? num(l.dueDay) : "", outstanding: num(l.outstanding), since: str(l.since), status: "active",
      payments: (l.payments || []).map((p) => ({ id: newId("loan-payment", p.id), date: str(p.date), amount: num(p.amount), interest: null, ...toPayment(p.bankId) })),
    })),
    recurring,
    items: [],
    stockMoves: [],
    bin: [],
  };
}

const looksLikeV1 = (raw) => raw && typeof raw === "object" && raw.settings && Array.isArray(raw.guards);

/** Works out which version a saved document is. Returns 0 if it isn't one of ours. */
export function versionOf(raw) {
  if (!raw || typeof raw !== "object") return 0;
  if (Number.isInteger(raw.schemaVersion)) return raw.schemaVersion;
  return looksLikeV1(raw) ? 1 : 0;
}

/**
 * Brings saved data up to the current schema. Returns { state, fromVersion }.
 * Throws a MigrationError for a newer version or anything unrecognised, leaving the input untouched.
 */
export function migrate(raw, { today }) {
  const fromVersion = versionOf(raw);
  if (!fromVersion) throw new MigrationError("unrecognised", "This isn't Accounts Manager data");
  if (fromVersion > SCHEMA_VERSION) throw new MigrationError("newer", "This data was saved by a newer version of Accounts Manager. Reload the page to update, then try again.");
  let state = raw;
  if (fromVersion === 1) state = v1to2(raw, today);
  return { state: normalize(state, today), fromVersion };
}

/** v1's bank balance calculation, kept here so its result can be compared with the new ledger. */
function v1Balances(v1) {
  const m = Object.fromEntries(v1.banks.map((b) => [b.id, num(b.opening)]));
  const add = (id, v) => { if (id && id in m) m[id] += v; };
  for (const c of v1.cash) add(c.bankId, c.type === "income" ? num(c.amount) : -num(c.amount));
  for (const i of v1.invoices) for (const p of i.payments || []) add(p.bankId, num(p.amount));
  for (const month of Object.values(v1.salaryPaid || {})) for (const p of Object.values(month || {})) add(p.bankId, -num(p.amount));
  for (const a of v1.advances) add(a.bankId, -num(a.amount));
  for (const l of v1.loans) for (const p of l.payments || []) add(p.bankId, -num(p.amount));
  for (const t of v1.transfers) { add(t.from, -num(t.amount)); add(t.to, num(t.amount)); }
  for (const k in m) m[k] = round2(m[k]);
  return m;
}

/** v1's invoice totals, kept here for the same reason. */
function v1InvoiceTotals(inv) {
  const subtotal = Math.round((inv.items || []).reduce((s, it) => s + num(it.qty) * num(it.rate), 0) * 100) / 100;
  const gst = inv.gst ? Math.round(subtotal * num(inv.gstRate) / 100 * 100) / 100 : 0;
  const total = Math.round((subtotal + gst) * 100) / 100;
  const received = (inv.payments || []).reduce((s, p) => s + num(p.amount), 0);
  const tds = (inv.payments || []).reduce((s, p) => s + num(p.tds), 0);
  const balance = Math.round((total - received - tds) * 100) / 100;
  const status = total > 0 && balance <= 0.5 ? "paid" : received + tds > 0 ? "partial" : "unpaid";
  return { subtotal, gst, total, received, tds, balance: Math.max(0, balance), status };
}

/**
 * Compares a v1 document with its migrated version, figure by figure. IDs are compared by position
 * because unsafe IDs are replaced. Returns { ok, problems, checked }.
 */
export function verifyMigration(raw, state, { today }) {
  const v1 = withV1Defaults(raw, today);
  const problems = [];
  let checked = 0;
  const same = (label, a, b) => {
    checked++;
    if (Math.abs(num(a) - num(b)) > 0.005) problems.push(`${label}: was ${a}, now ${b}`);
  };
  const count = (label, a, b) => { checked++; if (a !== b) problems.push(`${label}: was ${a}, now ${b}`); };

  count("staff", v1.guards.length, state.staff.length);
  count("clients", v1.clients.length, state.clients.length);
  count("invoices", v1.invoices.length, state.invoices.length);
  count("cash book entries", v1.cash.length, state.transactions.length);
  count("advances", v1.advances.length, state.advances.length);
  count("transfers", v1.transfers.length, state.transfers.length);
  count("loans", v1.loans.length, state.loans.length);
  count("recurring payments", v1.recurring.length, state.recurring.length);
  count("salary payments", Object.values(v1.salaryPaid || {}).reduce((t, m) => t + Object.keys(m || {}).length, 0), state.salaryPayments.length);

  const oldBalances = v1Balances(v1);
  const newBalances = accountBalances(state);
  v1.banks.forEach((b, i) => same(`balance of ${b.name}`, oldBalances[b.id], newBalances[state.accounts[i]?.id]));

  v1.invoices.forEach((inv, i) => {
    const before = v1InvoiceTotals(inv), after = docTotals(state.invoices[i]);
    for (const k of ["subtotal", "gst", "total", "received", "tds", "balance"]) same(`invoice ${inv.no} ${k}`, before[k], after[k]);
    checked++;
    if (before.status !== after.status) problems.push(`invoice ${inv.no} status: was ${before.status}, now ${after.status}`);
  });

  const months = new Set([...Object.keys(v1.entries || {}), ...v1.advances.map((a) => monthOf(a.date))]);
  for (const month of months) {
    if (!isMonth(month)) continue;
    v1.guards.forEach((g, i) => {
      const e = v1.entries[month]?.[g.id] || {};
      const logged = v1.advances.filter((a) => a.staffId === g.id && monthOf(a.date) === month).reduce((t, a) => t + num(a.amount), 0);
      const before = computePay(g, {
        daysWorked: e.duties, extraShifts: e.specialDuties, extraRate: e.specialRate, bonus: e.bonus, advance: num(e.advance) + logged,
        foodDays: e.messDays, foodRate: e.messRate, kit: e.uniform, other: e.other,
      }, { month, basis: v1.settings.basis, capAtFull: v1.settings.capAtFull, pf: v1.settings.pf, esi: v1.settings.esi });
      const after = payFor(state, state.staff[i], month);
      for (const k of ["days", "gross", "deductions", "net"]) same(`${g.name} ${month} ${k}`, before[k], after[k]);
    });
  }
  return { ok: problems.length === 0, problems, checked };
}
