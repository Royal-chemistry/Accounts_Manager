// The one payment control used on every money form: Cash, Bank, UPI or Credit.
import { $, html, raw } from "./dom.js";
import { icon } from "./icons.js";

const MODES = [["cash", "Cash", "cash"], ["bank", "Bank", "bank"], ["upi", "UPI", "upi"], ["credit", "Credit", "card"]];

export const MODE_LABELS = { cash: "Cash", bank: "Bank", upi: "UPI", credit: "Credit" };
const UNLINKED = "__not-linked";

const accountsFor = (state, mode) => state.accounts.filter((a) => a.active !== false && (mode === "cash" ? a.kind === "cash" : a.kind !== "cash"));

function defaultAccount(state, mode, current) {
  const list = accountsFor(state, mode);
  if (current && list.some((a) => a.id === current)) return current;
  if (mode === "upi") return state.settings.defaults?.upiAccountId && list.some((a) => a.id === state.settings.defaults.upiAccountId) ? state.settings.defaults.upiAccountId : list[0]?.id || "";
  if (mode === "cash") return state.settings.defaults?.cashAccountId || list[0]?.id || "";
  return list[0]?.id || "";
}

/** The last mode used on each kind of form. */
const LAST_KEY = "accounts-manager:last-mode:";
export function lastMode(formId, fallback = "cash") {
  try { return sessionStorage.getItem(LAST_KEY + formId) || fallback; } catch { return fallback; }
}
function rememberMode(formId, mode) {
  try { sessionStorage.setItem(LAST_KEY + formId, mode); } catch { /* not important */ }
}

export function renderPaymentField(id, f, value, ctx) {
  const state = ctx.state();
  const modes = f.allowCredit === false ? MODES.filter((m) => m[0] !== "credit") : MODES;
  const mode = value?.mode || lastMode(f.formId || "default", f.defaultMode || "cash");
  const safeMode = modes.some((m) => m[0] === mode) ? mode : "cash";
  const accountId = defaultAccount(state, safeMode, value?.accountId);
  return html`
    <span class="field-label" id="${id}-label">${f.label || "How was it paid?"}</span>
    <div class="seg seg-full" role="radiogroup" aria-labelledby="${id}-label">
      ${modes.map(([v, label, ic]) => html`
        <label><input type="radio" name="${f.k}-mode" value="${v}" ${v === safeMode ? raw("checked") : ""}><span>${icon(ic, { cls: "icon-sm" })}${label}</span></label>`)}
    </div>
    <div class="field" data-pay-account>
      <label class="field-label" for="${id}-account">Account</label>
      <select class="input" id="${id}-account" name="${f.k}-account" data-selected="${value?.untracked ? UNLINKED : accountId}" ${value?.untracked ? raw("data-can-unlink") : ""}></select>
    </div>
    ${f.allowCredit === false || f.hideDue ? "" : html`
    <div class="field" data-pay-due>
      <label class="field-label" for="${id}-due">Due date <span class="muted">(optional)</span></label>
      <input class="input" type="date" id="${id}-due" name="${f.k}-due" value="${value?.due || ""}">
    </div>`}
    <span class="field-hint" data-pay-note></span>`;
}

export function mountPaymentField(wrap, f, ctx) {
  const refresh = () => {
    const mode = $(`input[name="${f.k}-mode"]:checked`, wrap)?.value || "cash";
    const accountWrap = $("[data-pay-account]", wrap);
    const dueWrap = $("[data-pay-due]", wrap);
    const select = $("select", accountWrap);
    const note = $("[data-pay-note]", wrap);
    const needsAccount = mode !== "credit";
    accountWrap.hidden = !needsAccount;
    if (dueWrap) dueWrap.hidden = mode !== "credit";
    if (needsAccount) {
      const state = ctx.state();
      const list = accountsFor(state, mode);
      // Older entries that were never linked stay that way unless someone picks an account, so editing a note can't move a balance.
      const canUnlink = mode === "cash" && "canUnlink" in select.dataset;
      const wanted = select.value || select.dataset.selected;
      const chosen = canUnlink && wanted === UNLINKED ? UNLINKED : defaultAccount(state, mode, wanted);
      select.innerHTML = "";
      if (canUnlink) select.add(new Option("Not linked to an account (older entry)", UNLINKED, false, chosen === UNLINKED));
      for (const a of list) select.add(new Option(a.name, a.id, false, a.id === chosen));
      if (!list.length && !canUnlink) select.add(new Option(mode === "cash" ? "No cash account" : "No bank account yet", ""));
      note.textContent = !list.length && mode !== "cash" ? "Add a bank account under Banks & loans first." : "";
    } else {
      note.textContent = f.creditNote || "Recorded as unpaid. You can settle it later.";
    }
  };
  wrap.addEventListener("change", (e) => {
    if (e.target.name === `${f.k}-mode`) { rememberMode(f.formId || "default", e.target.value); refresh(); }
  });
  refresh();
}

export function readPaymentField(wrap) {
  const mode = wrap.querySelector('input[type="radio"]:checked')?.value || "cash";
  const account = wrap.querySelector("select")?.value || null;
  const unlinked = mode === "cash" && account === UNLINKED;
  return {
    mode,
    accountId: mode === "credit" || unlinked ? null : account,
    untracked: unlinked,
    due: mode === "credit" ? wrap.querySelector('input[type="date"]')?.value || "" : "",
  };
}

export function paymentFieldError(value, f, values) {
  if (value?.mode === "credit") {
    if (f.creditNeedsParty && !values[f.creditNeedsParty]) return "Choose who this is on credit with";
    return "";
  }
  if (value?.untracked) return "";
  if (!value?.accountId) return value?.mode === "cash" ? "Add a cash account first" : "Choose an account. You can add one under Banks & loans";
  return "";
}

/** A short label such as "Bank · SBI current". */
export function paymentLabel(state, p) {
  if (p.mode === "credit") return "Credit";
  if (p.untracked) return "Cash, not linked";
  const account = state.accounts.find((a) => a.id === p.accountId);
  const name = account?.name || (p.accountId ? "Deleted account" : "");
  if (p.mode === "cash") return name && name !== "Cash in hand" ? `Cash · ${name}` : "Cash";
  return `${MODE_LABELS[p.mode] || "Bank"}${name ? ` · ${name}` : ""}`;
}
