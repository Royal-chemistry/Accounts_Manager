// A month picker that works in every browser. <input type="month"> doesn't on desktop Firefox and Safari.
import { addMonths, monthLabel, monthOf } from "../core/dates.js";
import { html, raw } from "./dom.js";
import { icon } from "./icons.js";

const PAST_MONTHS = 36;
const FUTURE_MONTHS = 3;

export function monthOptions(selected, today) {
  const now = monthOf(today);
  const months = [];
  for (let i = FUTURE_MONTHS; i >= -PAST_MONTHS; i--) months.push(addMonths(now, i));
  if (selected && !months.includes(selected)) months.push(selected);
  return months.sort().reverse();
}

export function monthPicker(selected, today, { id = "month-picker", label = "Month shown" } = {}) {
  return html`
    <div class="month-picker" role="group" aria-label="${label}">
      <button type="button" class="icon-btn" data-month-step="-1" aria-label="Previous month">${icon("chevron-left")}</button>
      <label class="sr-only" for="${id}">${label}</label>
      <select class="input" id="${id}" data-month-select>
        ${monthOptions(selected, today).map((m) => html`<option value="${m}" ${m === selected ? raw("selected") : ""}>${monthLabel(m, { short: true })}</option>`)}
      </select>
      <button type="button" class="icon-btn" data-month-step="1" aria-label="Next month">${icon("chevron-right")}</button>
    </div>`;
}

/** Wires up a month picker. onChange receives the new month. */
export function mountMonthPicker(root, current, onChange) {
  root.addEventListener("change", (e) => { if (e.target.matches("[data-month-select]")) onChange(e.target.value); });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-month-step]");
    if (b) onChange(addMonths(current(), Number(b.dataset.monthStep)));
  });
}
