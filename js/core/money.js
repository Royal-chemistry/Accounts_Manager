// Money helpers. Amounts are stored in rupees (or the chosen currency's main unit) as plain numbers
// and rounded to two decimals after adding, which removes any floating-point noise.

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (n) => Math.round(num(n) * 100) / 100;

/** Adds a list of amounts and rounds the result. */
export const sumMoney = (values) => round2(values.reduce((t, v) => t + num(v), 0));

export const CURRENCIES = [
  { code: "INR", symbol: "₹", name: "Indian Rupee", unit: "Rupees", sub: "Paise" },
  { code: "USD", symbol: "$", name: "US Dollar", unit: "US Dollars", sub: "Cents" },
  { code: "EUR", symbol: "€", name: "Euro", unit: "Euros", sub: "Cents" },
  { code: "GBP", symbol: "£", name: "British Pound", unit: "Pounds", sub: "Pence" },
  { code: "AED", symbol: "AED", name: "UAE Dirham", unit: "Dirhams", sub: "Fils" },
  { code: "SAR", symbol: "SAR", name: "Saudi Riyal", unit: "Riyals", sub: "Halalas" },
  { code: "QAR", symbol: "QAR", name: "Qatari Riyal", unit: "Riyals", sub: "Dirhams" },
  { code: "OMR", symbol: "OMR", name: "Omani Rial", unit: "Rials", sub: "Baisa" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", unit: "Singapore Dollars", sub: "Cents" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", unit: "Australian Dollars", sub: "Cents" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", unit: "Canadian Dollars", sub: "Cents" },
  { code: "LKR", symbol: "LKR", name: "Sri Lankan Rupee", unit: "Rupees", sub: "Cents" },
  { code: "NPR", symbol: "NPR", name: "Nepalese Rupee", unit: "Rupees", sub: "Paisa" },
  { code: "BDT", symbol: "BDT", name: "Bangladeshi Taka", unit: "Taka", sub: "Poisha" },
];

const groupIndian = (whole) => {
  const s = String(whole);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (rest ? rest + "," : "") + last3;
};

/** Indian-style whole rupees: ₹1,23,456 */
export function inr(n) {
  const neg = n < 0;
  return (neg ? "-" : "") + "₹" + groupIndian(Math.round(Math.abs(n)));
}

/**
 * Formats an amount in the business's currency.
 * decimals: "auto" shows paise only when there are some, 2 always shows them, 0 rounds to whole units.
 */
export function formatMoney(n, currency = "INR", { decimals = "auto" } = {}) {
  const value = decimals === 0 ? Math.round(num(n)) : round2(n);
  const cents = Math.round(Math.abs(value) * 100);
  const showCents = decimals === 2 || (decimals === "auto" && cents % 100 !== 0);
  if (currency === "INR") {
    const fraction = showCents ? "." + String(cents % 100).padStart(2, "0") : "";
    return (value < 0 ? "-" : "") + "₹" + groupIndian(Math.floor(cents / 100)) + fraction;
  }
  const digits = showCents ? 2 : 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (x) => (x < 20 ? ONES[x] : TENS[Math.floor(x / 10)] + (x % 10 ? " " + ONES[x % 10] : ""));
const three = (x) => (x >= 100 ? ONES[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x));

/** Amount in words using the Indian system, e.g. 382287 -> "Three Lakh Eighty Two Thousand Two Hundred Eighty Seven". */
export function inWords(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push((crore >= 100 ? inWords(crore) : two(crore)) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (n) parts.push(three(n));
  return parts.join(" ");
}

/** Amount in words using thousands, millions and billions. */
function inWordsWestern(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return "Zero";
  const parts = [];
  for (const [size, label] of [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]]) {
    const chunk = Math.floor(n / size);
    if (chunk) { parts.push(inWordsWestern(chunk) + " " + label); n %= size; }
  }
  if (n) parts.push(three(n));
  return parts.join(" ");
}

/** The line printed on invoices and payslips, e.g. "Rupees One Thousand and Fifty Paise only". */
export function amountInWords(n, currency = "INR") {
  const c = CURRENCIES.find((x) => x.code === currency) || CURRENCIES[0];
  const cents = Math.round(Math.abs(num(n)) * 100);
  const whole = Math.floor(cents / 100), sub = cents % 100;
  const words = c.code === "INR" ? inWords : inWordsWestern;
  return `${n < 0 ? "Minus " : ""}${c.unit} ${words(whole)}${sub ? ` and ${two(sub)} ${c.sub}` : ""} only`;
}
