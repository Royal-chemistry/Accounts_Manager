// Payroll calculations.
import { daysInMonth, monthOf } from "./dates.js";
import { num } from "./money.js";

/**
 * Divisor used to turn a monthly salary into a per-day rate.
 * basis: "calendar" (days in that month), or a fixed number such as 30 or 26.
 */
export function divisorFor(basis, ym) {
  if (basis === "calendar") return daysInMonth(ym);
  const n = Number(basis);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Bad pay basis: ${basis}`);
  return n;
}

/** The number of days that counts as a full month under the chosen basis. */
export const fullMonthDays = (basis, ym) => (basis === "calendar" ? daysInMonth(ym) : Number(basis));

/**
 * One person's pay for the month.
 * staff: { salary }
 * entry: { daysWorked, extraShifts, extraRate, bonus, advance, foodDays, foodRate, kit, other }
 * options: { month: "YYYY-MM", basis, capAtFull, pf, esi }
 */
export function computePay(staff, entry, options) {
  const salary = num(staff.salary);
  const divisor = divisorFor(options.basis, options.month);
  const days = num(entry.daysWorked);
  const rate = salary / divisor;
  let base = Math.round(rate * days);
  // Optional: never pay more than the monthly salary for normal days.
  if (options.capAtFull && base > salary) base = salary;

  const extra = Math.round(num(entry.extraShifts) * num(entry.extraRate));
  const bonus = Math.round(num(entry.bonus));
  const gross = base + extra + bonus;

  // Statutory deductions (employee share), both optional.
  // PF: 12% of basic wages, wage ceiling 15,000. ESI: 0.75% of gross when gross is 21,000 or less.
  const pf = options.pf ? Math.round(Math.min(base, 15000) * 0.12) : 0;
  const esi = options.esi && gross > 0 && gross <= 21000 ? Math.ceil(gross * 0.0075) : 0;

  const advance = Math.round(num(entry.advance));
  const food = Math.round(num(entry.foodDays) * num(entry.foodRate));
  const kit = Math.round(num(entry.kit));
  const other = Math.round(num(entry.other));
  const deductions = advance + food + kit + other + pf + esi;
  const net = gross - deductions;

  return { divisor, rate: Math.round(rate * 100) / 100, days, base, extra, bonus, gross, advance, food, kit, other, pf, esi, deductions, net, owesBusiness: net < 0 };
}

const TOTAL_KEYS = ["days", "base", "extra", "bonus", "gross", "advance", "food", "kit", "other", "pf", "esi", "deductions", "net"];

/** Adds up a list of computePay results. */
export function totals(results) {
  const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
  for (const r of results) for (const k of TOTAL_KEYS) t[k] += r[k];
  return t;
}

export const ATTENDANCE_MARKS = {
  P: { label: "Present", short: "P" },
  H: { label: "Half day", short: "H" },
  L: { label: "Leave", short: "L" },
  A: { label: "Absent", short: "A" },
};

/** Turns a month of attendance marks into counts and days worked. marks: { "07": "P", "08": "H" } */
export function attendanceSummary(marks = {}, { paidLeave = false } = {}) {
  const c = { P: 0, H: 0, L: 0, A: 0 };
  for (const v of Object.values(marks)) if (v in c) c[v]++;
  const marked = c.P + c.H + c.L + c.A;
  return { ...c, marked, days: c.P + c.H * 0.5 + (paidLeave ? c.L : 0) };
}

/** Days worked: a typed figure wins, otherwise the attendance grid, otherwise nothing. */
export function effectiveDays(entry = {}, marks, pay = {}) {
  if (entry.daysWorked !== "" && entry.daysWorked != null) return { days: num(entry.daysWorked), source: "manual" };
  const s = attendanceSummary(marks, pay);
  return s.marked ? { days: s.days, source: "attendance" } : { days: 0, source: "none" };
}

/** Advances logged on the Advances page for one person in one month. */
export const loggedAdvance = (state, staffId, month) =>
  state.advances.filter((a) => a.staffId === staffId && monthOf(a.date) === month).reduce((t, a) => t + num(a.amount), 0);

/** One person's full pay for a month, combining the pay sheet, attendance and logged advances. */
export function payFor(state, staff, month) {
  const entry = state.entries[month]?.[staff.id] || {};
  const pay = state.settings.pay;
  const { days, source } = effectiveDays(entry, state.attendance[month]?.[staff.id], pay);
  const result = computePay(staff, { ...entry, daysWorked: days, advance: num(entry.advance) + loggedAdvance(state, staff.id, month) }, { ...pay, month });
  return { ...result, daysSource: source };
}

/** What a person costs the business for a month: gross pay less what they paid back for food, kit and other items. */
export const staffCost = (pay) => pay.gross - pay.food - pay.kit - pay.other;

export const salaryPaymentFor = (state, staffId, month) => state.salaryPayments.find((p) => p.staffId === staffId && p.month === month);

/** The salary sheet for a month: active staff, plus anyone inactive who has figures that month. */
export function payrollRows(state, month) {
  return state.staff
    .filter((s) => s.active !== false || state.entries[month]?.[s.id] || salaryPaymentFor(state, s.id, month))
    .map((staff) => {
      const pay = payFor(state, staff, month);
      const paid = salaryPaymentFor(state, staff.id, month) || null;
      const hold = !!state.entries[month]?.[staff.id]?.hold;
      const status = pay.net <= 0 ? "none" : paid ? "paid" : hold ? "hold" : "unpaid";
      return { staff, entry: state.entries[month]?.[staff.id] || {}, pay, paid, hold, status };
    });
}
