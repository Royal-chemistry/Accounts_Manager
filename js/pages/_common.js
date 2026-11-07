// Small building blocks shared by the pages.
import { html } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

export function pageHead({ title, sub, actions, back }) {
  return html`
    ${back ? html`<a class="page-back" href="#/${back.page}">${icon("arrow-left", { cls: "icon-sm" })}${back.label}</a>` : ""}
    <header class="page-head">
      <div class="grow">
        <h1 id="page-title" tabindex="-1">${title}</h1>
        ${sub ? html`<p class="page-sub">${sub}</p>` : ""}
      </div>
      ${actions ? html`<div class="page-actions">${actions}</div>` : ""}
    </header>`;
}

export function kpi({ label, value, sub, tone, href, ic }) {
  const body = html`
    <span class="kpi-label">${ic ? icon(ic, { cls: "icon-sm" }) : ""}${label}</span>
    <span class="kpi-value">${value}</span>
    ${sub ? html`<span class="kpi-sub">${sub}</span>` : ""}`;
  return href
    ? html`<a class="kpi ${tone ? `kpi-${tone}` : ""}" href="#/${href}">${body}</a>`
    : html`<div class="kpi ${tone ? `kpi-${tone}` : ""}">${body}</div>`;
}

export const button = (label, { ic, primary, attrs = "" } = {}) =>
  html`<button type="button" class="btn ${primary ? "btn-primary" : ""}" ${attrs}>${ic ? icon(ic) : ""}${label}</button>`;
