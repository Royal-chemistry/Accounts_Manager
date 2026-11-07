// The shape of saved data.
import { addMonths, monthOf } from "./dates.js";
import { presetFor } from "./presets.js";

export const SCHEMA_VERSION = 2;

const COLLECTIONS = ["staff", "advances", "salaryPayments", "clients", "suppliers", "invoices", "purchases", "transactions", "accounts", "transfers", "loans", "recurring", "items", "stockMoves", "bin"];
const MAPS = ["entries", "attendance"];

/** A brand-new, empty business, including the Cash in hand account. */
export function blank(today) {
  const preset = presetFor("other");
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: { onboarded: false, name: "", type: "", typeOther: "", address: "", gstin: "", stateCode: "", phone: "", email: "", logo: "", fyStartMonth: 4, currency: "INR" },
    settings: {
      month: addMonths(monthOf(today), -1),
      lastBackupAt: null,
      modules: { stock: false, payroll: true, gst: true },
      pay: { basis: "calendar", capAtFull: false, pf: false, esi: false, extraRate: 800, foodRate: 140, paidLeave: false },
      invoice: { prefix: "INV-", nextNo: 1, gstRate: 18, dueDays: 15, bankLine: "", terms: "" },
      defaults: { cashAccountId: "cash", upiAccountId: null },
    },
    categories: { expense: preset.expense, income: preset.income, units: preset.units, stock: [] },
    staff: [], entries: {}, attendance: {}, advances: [], salaryPayments: [],
    clients: [], suppliers: [],
    invoices: [], purchases: [], transactions: [],
    accounts: [{ id: "cash", name: "Cash in hand", kind: "cash", accountNo: "", opening: 0, active: true }],
    transfers: [], loans: [], recurring: [],
    items: [], stockMoves: [],
    bin: [],
  };
}

/** Fills in anything missing from a v2 document without changing what's already there. */
export function normalize(state, today) {
  const b = blank(today);
  const out = { ...b, ...state, schemaVersion: SCHEMA_VERSION };
  out.profile = { ...b.profile, ...state.profile };
  out.settings = {
    ...b.settings, ...state.settings,
    modules: { ...b.settings.modules, ...state.settings?.modules },
    pay: { ...b.settings.pay, ...state.settings?.pay },
    invoice: { ...b.settings.invoice, ...state.settings?.invoice },
    defaults: { ...b.settings.defaults, ...state.settings?.defaults },
  };
  out.categories = { ...b.categories, ...state.categories };
  for (const k of COLLECTIONS) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of MAPS) if (!out[k] || typeof out[k] !== "object") out[k] = {};
  return out;
}

export const DATA_COLLECTIONS = COLLECTIONS;
