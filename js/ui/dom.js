// DOM helpers. html`...` escapes everything it's given unless it's already safe, so a name
// containing markup can never turn into a script, whatever a backup file contains.

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Marks a string as already-safe markup. Only for markup written in this codebase. */
export const raw = (s) => new SafeHtml(String(s));

function stringify(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(stringify).join("");
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += stringify(v) + strings[i + 1]; });
  return new SafeHtml(out);
}

export function setHTML(el, content) {
  el.innerHTML = stringify(content);
  return el;
}

/** Builds an element from markup. */
export function toElement(content) {
  const t = document.createElement("template");
  t.innerHTML = stringify(content).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Listens on a parent for events from children matching a selector. Returns a function to stop listening. */
export function on(root, type, selector, handler) {
  const listener = (e) => {
    const target = e.target.closest?.(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/** Saves text as a file on the user's device. Spreadsheet CSVs get a marker so Excel reads the ₹ sign correctly. */
export function downloadFile(name, text, type = "text/csv") {
  const bom = type === "text/csv" ? "﻿" : "";
  const url = URL.createObjectURL(new Blob([bom + text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file) {
  return file.text();
}

/** Asks the user to pick a file. Resolves with the file, or null if they cancel. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
