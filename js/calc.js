// DutyPay — pure calculation functions (no DOM). Shared by the app and the tests.

/** Number of days in a "YYYY-MM" month. */
export function daysInMonth(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) throw new Error(`Bad month: ${ym}`);
  return new Date(y, m, 0).getDate();
}

/**
 * Divisor used to turn a monthly salary into a per-duty rate.
 * basis: "calendar" (days in that month), or a fixed number such as 30 or 26.
 */
export function divisorFor(basis, ym) {
  if (basis === "calendar") return daysInMonth(ym);
  const n = Number(basis);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Bad pay basis: ${basis}`);
  return n;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Work out one guard's pay for the month.
 * guard:  { salary }
 * entry:  { duties, specialDuties, specialRate, bonus, advance, messDays, messRate, uniform, other }
 * settings: { month: "YYYY-MM", basis, capAtFull, pf, esi }
 */
export function computePay(guard, entry, settings) {
  const salary = num(guard.salary);
  const divisor = divisorFor(settings.basis, settings.month);
  let duties = num(entry.duties);
  const rate = salary / divisor;
  let base = Math.round(rate * duties);
  // Optional: never pay more than the monthly salary for normal duties.
  if (settings.capAtFull && base > salary) base = salary;

  const special = Math.round(num(entry.specialDuties) * num(entry.specialRate));
  const bonus = Math.round(num(entry.bonus));
  const gross = base + special + bonus;

  // Statutory deductions (employee share), both optional.
  // PF: 12% of basic wages, wage ceiling ₹15,000.  ESI: 0.75% of gross when gross ≤ ₹21,000.
  const pf = settings.pf ? Math.round(Math.min(base, 15000) * 0.12) : 0;
  const esi = settings.esi && gross > 0 && gross <= 21000 ? Math.ceil(gross * 0.0075) : 0;

  const advance = Math.round(num(entry.advance));
  const mess = Math.round(num(entry.messDays) * num(entry.messRate));
  const uniform = Math.round(num(entry.uniform));
  const other = Math.round(num(entry.other));
  const deductions = advance + mess + uniform + other + pf + esi;
  const net = gross - deductions;

  return {
    divisor,
    rate: Math.round(rate * 100) / 100,
    duties,
    base,
    special,
    bonus,
    gross,
    advance,
    mess,
    uniform,
    other,
    pf,
    esi,
    deductions,
    net,
    owesAgency: net < 0,
  };
}

/** Add up a list of computePay results. */
export function totals(results) {
  const keys = ["duties", "base", "special", "bonus", "gross", "advance", "mess", "uniform", "other", "pf", "esi", "deductions", "net"];
  const t = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of results) for (const k of keys) t[k] += r[k];
  return t;
}

/** Indian-style money formatting: 1,23,456 */
export function inr(n) {
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (neg ? "-" : "") + "₹" + (rest ? rest + "," : "") + last3;
}

/** Amount in words (Indian system), e.g. 13548 -> "Thirteen Thousand Five Hundred Forty Eight". */
export function inWords(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return "Zero";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
    "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? " " + a[x % 10] : ""));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(two(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (n) parts.push(three(n));
  return parts.join(" ");
}

/** Minimal CSV parser (quotes, commas, newlines in quotes). Returns array of objects keyed by header. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** Build CSV text from rows (array of arrays). */
export function toCSV(rows) {
  return rows
    .map((r) => r.map((v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\r\n");
}
