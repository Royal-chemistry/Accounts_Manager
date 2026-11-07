// Forms: visible labels, errors beside the field and tied to it for screen readers, and focus moved
// to the first problem when saving. openForm shows one in a modal, mountForm places one on a page.
import { $, $$, html, raw, setHTML } from "./dom.js";
import { openModal } from "./modal.js";
import { amountError, dateError, required } from "../core/validate.js";
import { CURRENCIES } from "../core/money.js";
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
      const currency = ctx?.state?.().profile.currency || "INR";
      const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol || "₹";
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
    return html`<div class="field field-full pay-field" data-field="${f.k}" role="group" aria-label="${f.label || "How it was paid"}">
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

const formBody = ({ intro, fields, values, ctx }) => html`
  ${intro ? html`<div class="field-hint form-intro" data-intro>${intro}</div>` : ""}
  <div class="form-grid">${fields.map((f) => renderField(f, values, ctx))}</div>`;

/** Connects a rendered form to its behaviour. Returns the form's api. */
function wireForm(root, formEl, { fields, values, ctx, onSubmit, afterSubmit, closeForm }) {
  const collect = () => {
    const out = { ...values };
    for (const f of fields) {
      if (VALUELESS.has(f.type) || !f.k) continue;
      const v = readField(root, f);
      if (v !== undefined) out[f.k] = v;
    }
    return out;
  };
  const setError = (k, message) => {
    const el = $(`[data-error-for="${k}"]`, root);
    if (el) el.textContent = message || "";
    // A custom field's message is about the whole group, like "Add at least one line", not each box inside it.
    if (fields.find((f) => f.k === k)?.type === "custom") return;
    $$(`[data-field="${k}"] .input`, root).forEach((input) => {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
  };
  const setWarning = (k, message) => { const el = $(`[data-warn-for="${k}"]`, root); if (el) el.textContent = message || ""; };
  const api = {
    root, setError, setWarning, close: closeForm,
    initial: values, // what the form opened with, for custom fields setting themselves up
    values: collect,
    snapshot: () => JSON.stringify(collect()),
    setValue(k, v) {
      const el = $(`[name="${k}"]`, root);
      if (el) { el.value = v ?? ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
    },
    setFootNote(text) { const n = $("[data-foot-note]", root); if (n) n.textContent = text; },
  };

  const applyVisibility = () => {
    const current = collect();
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

  function onChange(e) {
    const name = e.target.name || e.target.closest("[data-field]")?.dataset.field;
    const f = fields.find((x) => x.k === name);
    const current = applyVisibility();
    if (f && e.type === "change") f.onChange?.(current[f.k], current, api);
    for (const other of fields) other.onAnyChange?.(current, api);
    if (f && $(`[data-error-for="${f.k}"]`, root)?.textContent) setError(f.k, checkField(f, current[f.k], current));
  }
  root.addEventListener("input", onChange);
  root.addEventListener("change", onChange);
  root.addEventListener("focusout", (e) => {
    const f = fields.find((x) => x.k === e.target.name);
    if (f && e.target.value !== "") setError(f.k, checkField(f, readField(root, f), collect()));
  });

  const current = applyVisibility();
  for (const other of fields) other.onAnyChange?.(current, api);

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const now = collect();
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
    // Fields that are hidden don't count.
    for (const f of fields) if (f.when && !f.when(now) && f.k) delete now[f.k];
    api.again = !!e.submitter?.hasAttribute("data-again");
    const result = await onSubmit(now, api);
    if (result !== false) afterSubmit?.();
  });
  return api;
}

/**
 * Opens a form in a modal.
 * fields: [{ k, label, type, required, full, hint, options, when, validate, warn, onChange, default }]
 * type: text, email, tel, money, number, date, select, text-list, textarea, checkbox, segmented, payment, custom, section, note
 * onSubmit(values, api): return false to keep the form open. api.setError(key, message) shows a message on a field.
 */
export function openForm({ title, intro, fields, values = {}, submitLabel = "Save", size = "", ctx, onSubmit, cancelLabel = "Cancel", footNote = null, againLabel = null }) {
  formCounter++;
  let initial = "";
  let api = null;
  const m = openModal({
    title, size, form: true,
    body: formBody({ intro, fields, values, ctx }),
    foot: html`
      ${footNote !== null ? html`<span class="modal-foot-note" data-foot-note>${footNote}</span>` : ""}
      <button type="button" class="btn" data-modal-close>${cancelLabel}</button>
      ${againLabel ? html`<button type="submit" class="btn" data-again>${againLabel}</button>` : ""}
      <button type="submit" class="btn btn-primary">${submitLabel}</button>`,
    isDirty: () => api && api.snapshot() !== initial,
  });
  api = wireForm(m.dialog, $("form", m.dialog), { fields, values, ctx, onSubmit, afterSubmit: () => m.close(), closeForm: () => m.close() });
  initial = api.snapshot();
  return api;
}

/** Places a form on a page instead of in a modal. actions is markup that sits beside the submit button. */
export function mountForm(host, { intro, fields, values = {}, submitLabel = "Save", ctx, onSubmit, actions = "" }) {
  formCounter++;
  setHTML(host, html`
    <form novalidate class="page-form">
      ${formBody({ intro, fields, values, ctx })}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${submitLabel}</button>
        ${actions}
      </div>
    </form>`);
  return wireForm(host, $("form", host), { fields, values, ctx, onSubmit });
}
