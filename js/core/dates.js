// Date helpers. Dates are "YYYY-MM-DD" strings and months are "YYYY-MM" strings, so they sort and
// compare correctly as text and are free of time-zone surprises.

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Today's date on this device's clock. Not UTC, which would be yesterday just after midnight in India. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));
export const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

const toUTC = (d) => { const [y, m, day] = d.split("-").map(Number); return Date.UTC(y, m - 1, day); };
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);

/** Whole days from a to b. Positive when b is later. */
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export const addDays = (d, n) => fromUTC(toUTC(d) + n * 864e5);
export const monthOf = (d) => String(d || "").slice(0, 7);

export function daysInMonth(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) throw new Error(`Bad month: ${ym}`);
  return new Date(y, m, 0).getDate();
}

export function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12 + 12) % 12 + 1)}`;
}

export const monthStart = (ym) => `${ym}-01`;
export const monthEnd = (ym) => `${ym}-${pad(daysInMonth(ym))}`;

/** The given day in a month, moved back to the last day when the month is too short. */
export const dayInMonth = (ym, day) => `${ym}-${pad(Math.min(Math.max(1, Number(day) || 1), daysInMonth(ym)))}`;

/** Months from a to b inclusive, as "YYYY-MM". */
export function monthsBetween(from, to) {
  const out = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
  return out;
}

export const inRange = (d, from, to) => isDate(d) && (!from || d >= from) && (!to || d <= to);

/** "07 Nov 2026", or a dash when there's no date. */
export function formatDate(d) {
  if (!isDate(d)) return "—";
  const [y, m, day] = d.split("-");
  return `${day} ${MONTHS[Number(m) - 1].slice(0, 3)} ${y}`;
}

export function monthLabel(ym, { short = false } = {}) {
  if (!isMonth(ym)) return "—";
  const [y, m] = ym.split("-");
  return short ? `${MONTHS[Number(m) - 1].slice(0, 3)} ${y.slice(2)}` : `${MONTHS[Number(m) - 1]} ${y}`;
}

export const MONTH_NAMES = MONTHS;

/** The financial year containing a date. fyStartMonth is 1 to 12, with 4 meaning April. */
export function fyRange(date, fyStartMonth = 4) {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= fyStartMonth ? y : y - 1;
  const from = `${startYear}-${pad(fyStartMonth)}`;
  const to = addMonths(from, 11);
  const endYear = Number(to.slice(0, 4));
  return {
    from: monthStart(from),
    to: monthEnd(to),
    label: startYear === endYear ? `FY ${startYear}` : `FY ${startYear}-${String(endYear).slice(2)}`,
  };
}

/** Quick date ranges for reports. Quarters follow the financial year. */
export function periodPresets(today, fyStartMonth = 4) {
  const thisMonth = monthOf(today);
  const lastMonth = addMonths(thisMonth, -1);
  const fy = fyRange(today, fyStartMonth);
  const lastFy = fyRange(addDays(fy.from, -1), fyStartMonth);
  const fyFirst = monthOf(fy.from);
  const monthsIn = monthsBetween(fy.from, today).length - 1;
  const qStart = addMonths(fyFirst, Math.floor(monthsIn / 3) * 3);
  const lastQStart = addMonths(qStart, -3);
  const range = (id, label, from, to) => ({ id, label, from, to });
  return [
    range("this-month", "This month", monthStart(thisMonth), monthEnd(thisMonth)),
    range("last-month", "Last month", monthStart(lastMonth), monthEnd(lastMonth)),
    range("this-quarter", "This quarter", monthStart(qStart), monthEnd(addMonths(qStart, 2))),
    range("last-quarter", "Last quarter", monthStart(lastQStart), monthEnd(addMonths(lastQStart, 2))),
    range("this-fy", `This year (${fy.label})`, fy.from, fy.to),
    range("last-fy", `Last year (${lastFy.label})`, lastFy.from, lastFy.to),
  ];
}
