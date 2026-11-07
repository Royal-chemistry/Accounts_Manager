// Form validation. Each function returns an error message, or an empty string when the value is fine.
import { isDate } from "./dates.js";

export const required = (v, label = "This") => (String(v ?? "").trim() ? "" : `${label} is required`);

export function amountError(v, { label = "Amount", min = 0, allowZero = false, max } = {}) {
  if (v === "" || v == null) return `${label} is required`;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < min) return `${label} can't be negative`;
  if (!allowZero && n === 0) return `${label} must be more than zero`;
  if (max != null && n > max) return `${label} can't be more than ${max}`;
  return "";
}

export const dateError = (v, label = "Date") => (isDate(v) ? "" : `${label} needs a valid date`);

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The check character of a GSTIN, worked out from its first 14 characters. */
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** Format and checksum check. Used as a warning, never a block, since a typo shouldn't stop an invoice. */
export function gstinError(v) {
  const g = String(v || "").trim().toUpperCase();
  if (!g) return "";
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return "This doesn't look like a GSTIN. It should be 15 characters, such as 27AAPFU0939F1ZV";
  if (gstinCheckChar(g) !== g[14]) return "The last character of this GSTIN doesn't match. Please check it for a typo";
  return "";
}

export const ifscError = (v) => (!String(v || "").trim() || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(v).trim().toUpperCase()) ? "" : "An IFSC is 11 characters, such as SBIN0001234");

export const phoneError = (v) => {
  const digits = String(v || "").replace(/\D/g, "");
  return !digits || (digits.length >= 7 && digits.length <= 15) ? "" : "Enter a phone number of 7 to 15 digits";
};

export const emailError = (v) => (!String(v || "").trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? "" : "Enter a valid email address");

/** Checks a value isn't already used by another record. */
export function uniqueError(list, key, value, selfId, label = "This") {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "";
  return list.some((x) => x.id !== selfId && String(x[key] ?? "").trim().toLowerCase() === v) ? `${label} is already in use` : "";
}

/** GST state codes, for choosing the place of supply. */
export const GST_STATES = [
  ["01", "Jammu & Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"],
  ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"],
  ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"],
  ["24", "Gujarat"], ["26", "Dadra & Nagar Haveli and Daman & Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"],
  ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman & Nicobar Islands"],
  ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
];
