// Forms in a modal: visible labels, errors beside the field and tied to it for screen readers,
// and focus moved to the first problem when saving.
import { $, $$, html, raw } from "./dom.js";
import { openModal } from "./modal.js";
import { amountError, dateError, required } from "../core/validate.js";
import { CURRENCIES, num } from "../core/money.js";
import { renderPaymentField, readPaymentField, mountPaymentField, paymentFieldError } from "./payment-field.js";

let formCounter = 0;

const attrs = (obj) => raw(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => (v === true ? k : `${k}="${String(v).replace(/"/g, "&quot;")}"`)).join(" "));

/** Accepts "1,200.50" as well as 1200.5. */
export const parseAmount = (v) => {
  const clean = String(v ?? "").replace(/[,\s₹]/g, "");
  return clean === "" ? "" : Number(clean);
};

function fieldControl(f, value, id, ctx) {
  const common = {
    id, name: f.k, "aria-describedby": `${id}-msg ${f.hint ? `${id}-hint` : ""}`.trim(),
    required: !!f.required, disabled: !!f.disabled, placeholder: f.placeholder, autocomplete: f.autocomplete || "off",
  };
  switch (f.type) {
    case "textarea":
      return html`<textarea class="input" ${attrs({ ...common, rows: f.rows || 3 })}>${value ?? ""}</textarea>`;
    case "select":
      return html`<select class="input" ${attrs(common)}>
        ${(f.options || []).map(([v, l]) => html`<option value="${v}" ${String(v) === String(value ?? "") ? raw("selected") : ""}>${l}</option>`)}
      </select>`;
    case "money": {
      const symbol = CURRENCIES.find((c) => c.code === ctx?.currency)?.symbol || "₹";
      const shown = value === "" || value == null ? "" : value;
      return html`<div class="input-wrap">
        <span class="prefix" aria-hidden="true">${symbol}</span>
        <input class="input input-num ${symbol.length > 1 ? "input-has-long-prefix" : "input-has-prefix"}" inputmode="decimal" type="text" value="${shown}" ${attrs(common)}>
      </div>`;
    }
    case "number":
      return html`<input class="input input-num" inputmode="decimal" type="text" value="${value ?? ""}" ${attrs(common)}>`;
    case "date":
      return html`<input class="input" type="date" value="${value ?? ""}" ${attrs({ ...common, min: f.min, max: f.max })}>`;
    case "text-list": {
      const listId = `${id}-list`;
      return html`<input class="input" type="text" value="${value ?? ""}" list="${listId}" ${attrs(common)}>
        <datalist id="${listId}">${(f.list || []).map((o) => html`<option value="${o}"></option>`)}</datalist>`;
    }
    default:
      return html`<input class="input" type="${f.type || "text"}" value="${value ?? ""}" ${attrs({ ...common, inputmode: f.inputmode, maxlength: f.maxlength })}>`;
  }
}

function renderField(f, values, ctx) {
  const id = `f${formCounter}-${f.k || Math.random().toString(36).slice(2, 8)}`;
  const value = values[f.k] ?? f.default;
  const cls = `field ${f.full ? "field-full" : ""}`;
  const hint = f.hint ? html`<span class="field-hint" id="${id}-hint">${f.hint}</span>` : "";
  const msg = html`<span class="field-error" id="${id}-msg" data-error-for="${f.k}"></span><span class="field-warn" data-warn-for="${f.k}" role="status"></span>`;

  if (f.type === "section") return html`<div class="form-section" data-field="${f.k || ""}">${f.label}</div>`;
  if (f.type === "note") return html`<div class="field field-full small muted" data-field="${f.k || ""}">${f.body}</div>`;
  if (f.type === "custom") return html`<div class="${cls}" data-field="${f.k}">${f.label ? html`<span class="field-label">${f.label}</span>` : ""}<div data-custom="${f.k}"></div>${hint}${msg}</div>`;
  if (f.type === "payment") {
    return html`<div class="field field-full" data-field="${f.k}" role="group" aria-label="${f.label || "How it was paid"}">
      ${renderPaymentField(id, f, value, ctx)}${hint}${msg}
    </div>`;
  }
  if (f.type === "checkbox") {
    return html`<div class="${cls}" data-field="${f.k}">
      <label class="check">
        <input type="checkbox" id="${id}" name="${f.k}" ${value ? raw("checked") : ""} aria-describedby="${id}-msg ${f.hint ? `${id}-hint` : ""}">
        <span class="check-label">${f.label}</span>
      </label>${hint}${msg}
    </div>`;
  }
  if (f.type === "segmented") {
    return html`<fieldset class="${cls} fieldset" data-field="${f.k}">
      <legend class="field-label">${f.label}</legend>
      <div class="seg ${f.block ? "seg-full" : ""}">
        ${f.options.map(([v, l]) => html`<label><input type="radio" name="${f.k}" value="${v}" ${String(v) === String(value) ? raw("checked") : ""}><span>${l}</span></label>`)}
      </div>${hint}${msg}
    </fieldset>`;
  }
  return html`<div class="${cls}" data-field="${f.k}">
    <label class="field-label" for="${id}">${f.label}${f.required ? html` <span class="req" aria-hidden="true">*</span>` : ""}</label>
    ${fieldControl(f, value, id, ctx)}${hint}${msg}
  </div>`;
}

function readField(root, f) {
  const wrap = $(`[data-field="${f.k}"]`, root);
  if (f.type === "custom") return f.read?.($(`[data-custom="${f.k}"]`, root));
  if (f.type === "payment") return readPaymentField(wrap);
  if (f.type === "checkbox") return $(`input[name="${f.k}"]`, root).checked;
  if (f.type === "segmented") return $(`input[name="${f.k}"]:checked`, root)?.value ?? "";
  const el = $(`[name="${f.k}"]`, root);
  if (!el) return undefined;
  if (f.type === "money" || f.type === "number") return parseAmount(el.value);
  return el.value.trim();
}

const VALUELESS = new Set(["section", "note"]);

/** Runs a field's built-in and custom checks. Returns an error message or an empty string. */
function checkField(f, value, values) {
  if (f.type === "payment") {
    const e = paymentFieldError(value, f, values);
    if (e) return e;
  }
  if (f.required && f.type !== "money" && f.type !== "number" && f.type !== "payment" && f.type !== "custom") {
    const e = required(value, f.label);
    if (e) return e;
  }
  if (f.type === "money" || f.type === "number") {
    if (f.required || value !== "") {
      const e = amountError(value, { label: f.label, allowZero: f.allowZero ?? !f.required, min: f.allowNegative ? -Infinity : 0, max: f.max });
      if (e) return e;
    }
  }
  if (f.type === "date" && (f.required || value)) {
    const e = dateError(value, f.label);
    if (e) return e;
  }
  return f.validate?.(value, values) || "";
}

/**
 * Opens a form.
 * fields: [{ k, label, type, required, full, hint, options, when, validate, warn, onChange, default }]
 * type: text, email, tel, money, number, date, select, text-list, textarea, checkbox, segmented, payment, custom, section, note
 * onSubmit(values, api): return false to keep the form open. api.setError(key, message) shows a message on a field.
 */
export function openForm({ title, intro, fields, values = {}, submitLabel = "Save", size = "", ctx, onSubmit, cancelLabel = "Cancel", footNote = null }) {
  formCounter++;
  const body = html`
    ${intro ? html`<div class="field-hint form-intro" data-intro>${intro}</div>` : ""}
    <div class="form-grid">${fields.map((f) => renderField(f, values, ctx))}</div>`;
  let initial = "";
  const collect = (root) => {
    const out = { ...values };
    for (const f of fields) {
      if (VALUELESS.has(f.type) || !f.k) continue;
      const v = readField(root, f);
      if (v !== undefined) out[f.k] = v;
    }
    return out;
  };
  const m = openModal({
    title, body, size, form: true,
    foot: html`
      ${footNote ? html`<span class="modal-foot-note" data-foot-note>${footNote}</span>` : ""}
      <button type="button" class="btn" data-modal-close>${cancelLabel}</button>
      <button type="submit" class="btn btn-primary">${submitLabel}</button>`,
    isDirty: () => JSON.stringify(collect(m.dialog)) !== initial,
  });
  const root = m.dialog;

  const setError = (k, message) => {
    const el = $(`[data-error-for="${k}"]`, root);
    if (el) el.textContent = message || "";
    $$(`[data-field="${k}"] .input`, root).forEach((input) => {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
  };
  const setWarning = (k, message) => { const el = $(`[data-warn-for="${k}"]`, root); if (el) el.textContent = message || ""; };

  const api = {
    root, setError, setWarning, close: () => m.close(),
    values: () => collect(root),
    setValue(k, v) {
      const el = $(`[name="${k}"]`, root);
      if (el) { el.value = v ?? ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
    },
    setFootNote(text) { const n = $("[data-foot-note]", root); if (n) n.textContent = text; },
  };

  const applyVisibility = () => {
    const current = collect(root);
    for (const f of fields) {
      if (!f.when) continue;
      const wrap = $(`[data-field="${f.k}"]`, root);
      if (wrap) wrap.hidden = !f.when(current);
    }
    for (const f of fields) if (f.warn) setWarning(f.k, f.warn(current[f.k], current) || "");
    return current;
  };

  for (const f of fields) {
    if (f.type === "custom") f.mount?.($(`[data-custom="${f.k}"]`, root), api);
    if (f.type === "payment") mountPaymentField($(`[data-field="${f.k}"]`, root), f, ctx);
  }

  root.addEventListener("input", onChange);
  root.addEventListener("change", onChange);
  function onChange(e) {
    const name = e.target.name || e.target.closest("[data-field]")?.dataset.field;
    const f = fields.find((x) => x.k === name);
    const current = applyVisibility();
    if (f && e.type === "change") f.onChange?.(current[f.k], current, api);
    for (const other of fields) other.onAnyChange?.(current, api);
    if (f && $(`[data-error-for="${f.k}"]`, root)?.textContent) setError(f.k, checkField(f, current[f.k], current));
  }
  root.addEventListener("focusout", (e) => {
    const name = e.target.name;
    const f = fields.find((x) => x.k === name);
    if (f && e.target.value !== "") setError(f.k, checkField(f, readField(root, f), collect(root)));
  });

  const current = applyVisibility();
  initial = JSON.stringify(current);
  for (const other of fields) other.onAnyChange?.(current, api);
  initial = JSON.stringify(collect(root));

  $("form", root).addEventListener("submit", async (e) => {
    e.preventDefault();
    const now = collect(root);
    let firstBad = null;
    for (const f of fields) {
      if (VALUELESS.has(f.type) || !f.k) continue;
      const wrap = $(`[data-field="${f.k}"]`, root);
      if (wrap?.hidden) { setError(f.k, ""); continue; }
      const err = checkField(f, now[f.k], now);
      setError(f.k, err);
      if (err && !firstBad) firstBad = f.k;
    }
    if (firstBad) {
      $(`[data-field="${firstBad}"] input, [data-field="${firstBad}"] select, [data-field="${firstBad}"] textarea, [data-field="${firstBad}"] button`, root)?.focus();
      return;
    }
    // Hidden fields don't count.
    for (const f of fields) if (f.when && !f.when(now) && f.k) delete now[f.k];
    const result = await onSubmit(now, api);
    if (result !== false) m.close();
  });
  return api;
}

export { num };
