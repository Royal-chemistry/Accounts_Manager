// Recurring payments: when they fall due and whether they've been paid.
import { addMonths, dayInMonth, daysBetween, monthOf } from "./dates.js";
import { num } from "./money.js";

export const FREQUENCIES = {
  monthly: { months: 1, label: "Every month" },
  bimonthly: { months: 2, label: "Every 2 months" },
  quarterly: { months: 3, label: "Every 3 months" },
  yearly: { months: 12, label: "Every year" },
};

/** Next due date (YYYY-MM-DD) on or after `from` for a monthly due day. */
export function nextDue(dueDay, from) {
  const here = monthOf(from);
  const due = dayInMonth(here, dueDay);
  return due >= from ? due : dayInMonth(addMonths(here, 1), dueDay);
}

export const monthlyEquivalent = (amount, frequency = "monthly") => num(amount) / (FREQUENCIES[frequency]?.months || 1);

/** The months in which a recurring payment falls due, between two months inclusive. */
export function dueMonths(r, fromMonth, toMonth) {
  const step = FREQUENCIES[r.frequency]?.months || 1;
  const start = r.startMonth || fromMonth;
  const out = [];
  for (let m = start; m <= toMonth; m = addMonths(m, step)) if (m >= fromMonth) out.push(m);
  return out;
}

const SOON_DAYS = 7;
const LOOK_BACK_CYCLES = 3;

/**
 * Where a recurring payment stands today: the oldest recent unpaid cycle if one is overdue, otherwise the next one.
 * Returns { month, due, days, overdue, soon, paid }. days is negative when overdue.
 */
export function cycleStatus(r, today) {
  const step = FREQUENCIES[r.frequency]?.months || 1;
  const now = monthOf(today);
  const start = r.startMonth || now;
  const earliest = addMonths(now, -step * LOOK_BACK_CYCLES);
  // Walk forward through recent cycles to the first one that hasn't been paid.
  for (let m = start; ; m = addMonths(m, step)) {
    if (m < earliest || r.paid?.[m]) continue;
    const due = dayInMonth(m, r.dueDay);
    const days = daysBetween(today, due);
    return { month: m, due, days, overdue: days < 0, soon: days >= 0 && days <= SOON_DAYS, paid: false };
  }
}

/** Every active recurring payment and where it stands, soonest first. */
export function upcoming(state, today) {
  return state.recurring
    .filter((r) => r.active !== false)
    .map((r) => ({ r, ...cycleStatus(r, today) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}
