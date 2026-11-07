// Printing and Save as PDF. Documents are rendered into #print-root, which print.css shows alone on white paper.
import { amountInWords } from "../core/money.js";
import { html, setHTML } from "./dom.js";

/** Shows the browser's print dialog for a document. */
export function printDocument(content, { title } = {}) {
  const root = document.getElementById("print-root");
  setHTML(root, content);
  const before = document.title;
  if (title) document.title = title;
  const done = () => {
    document.title = before;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

/** The letterhead at the top of every printed document. */
export function docHead(state, { title, lines = [] }) {
  const p = state.profile;
  return html`
    <header class="doc-head">
      <div class="doc-biz">
        ${p.logo ? html`<img class="doc-logo" src="${p.logo}" alt="">` : ""}
        <div>
          <div class="doc-biz-name">${p.name || "Your business"}</div>
          ${p.address ? html`<div class="doc-small doc-pre">${p.address}</div>` : ""}
          ${p.phone ? html`<div class="doc-small">${p.phone}</div>` : ""}
          ${p.gstin ? html`<div class="doc-small">GSTIN: ${p.gstin}</div>` : ""}
        </div>
      </div>
      <div class="doc-title-block">
        <div class="doc-title">${title}</div>
        ${lines.map((l) => html`<div class="doc-small">${l}</div>`)}
      </div>
    </header>`;
}

export const wordsLine = (amount, currency) => amountInWords(amount, currency);

/** A signature line with a label. */
export const signature = (label) => html`<div class="doc-sign">${label}</div>`;
