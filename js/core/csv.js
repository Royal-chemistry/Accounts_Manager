// CSV reading and writing.

/** Minimal CSV parser (quotes, commas, newlines in quotes). Returns an array of objects keyed by header. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const src = String(text).replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
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

// Spreadsheets run any cell starting with these characters as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d,]*(\.\d+)?$/;

/** Builds CSV text from rows (an array of arrays). Text that a spreadsheet would run as a formula is neutralised. */
export function toCSV(rows) {
  return rows
    .map((r) => r.map((v) => {
      let s = String(v ?? "");
      if (typeof v === "string" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","))
    .join("\r\n");
}
