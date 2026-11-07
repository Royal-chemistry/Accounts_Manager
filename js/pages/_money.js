// Helpers for working with payment details on forms and records.
import { html } from "../ui/dom.js";
import { paymentLabel } from "../ui/payment-field.js";

/** Copies a payment control's value onto a record. */
export function applyPayment(doc, value) {
  doc.mode = value.mode;
  doc.accountId = value.mode === "credit" ? null : value.accountId || null;
  doc.untracked = false;
  return doc;
}

/** A small badge showing how a record was paid. */
export const paymentCell = (state, p) => html`<span class="small">${paymentLabel(state, p)}</span>`;

export const paymentField = (formId, { allowCredit = false, label, creditNeedsParty, defaultMode } = {}) => ({
  k: "payment", type: "payment", formId, allowCredit, label, creditNeedsParty, defaultMode,
});
