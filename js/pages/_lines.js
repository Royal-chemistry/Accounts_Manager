// The line-item editor shared by invoices and purchases.
import { docTotals, gstSplit } from "../core/documents.js";
import { num } from "../core/money.js";
import { $, $$, html, on, raw, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

/**
 * A form field (type "custom") for editing lines. getOptions(api) supplies the tax settings from the rest of the form:
 * { taxInclusive, bizState, partyState, defaultGst }. priceKey says which item price to pre-fill.
 */
export function linesField(ctx, { k = "lines", priceKey = "salePrice", getOptions }) {
  const state = () => ctx.state();
  const gstOn = () => state().settings.modules?.gst !== false;
  const stockOn = () => !!state().settings.modules?.stock;
  const money = (n) => ctx.money(n, { decimals: 2 });
  const parse = (v) => num(String(v ?? "").replace(/,/g, ""));

  const rowHtml = (line = {}) => html`
    <div class="line-row" data-line>
      ${stockOn() ? html`
        <div class="li-cell li-item">
          <span class="li-label" aria-hidden="true">Stock item</span>
          <select class="input" data-l="itemId" aria-label="Stock item">
            <option value="">Not a stock item</option>
            ${state().items.filter((i) => i.active !== false || i.id === line.itemId).map((i) => html`<option value="${i.id}" ${i.id === line.itemId ? raw("selected") : ""}>${i.name}</option>`)}
          </select>
        </div>` : ""}
      <div class="li-cell li-desc">
        <span class="li-label" aria-hidden="true">Description</span>
        <input class="input" data-l="desc" aria-label="Description" value="${line.desc ?? ""}">
      </div>
      ${gstOn() ? html`
        <div class="li-cell li-hsn">
          <span class="li-label" aria-hidden="true">HSN/SAC</span>
          <input class="input" data-l="hsn" aria-label="HSN or SAC code" value="${line.hsn ?? ""}" maxlength="8">
        </div>` : ""}
      <div class="li-cell li-qty">
        <span class="li-label" aria-hidden="true">Qty</span>
        <input class="input input-num" inputmode="decimal" data-l="qty" aria-label="Quantity" value="${line.qty ?? 1}">
      </div>
      <div class="li-cell li-rate">
        <span class="li-label" aria-hidden="true">Rate</span>
        <input class="input input-num" inputmode="decimal" data-l="rate" aria-label="Rate" value="${line.rate ?? ""}">
      </div>
      ${gstOn() ? html`
        <div class="li-cell li-gst">
          <span class="li-label" aria-hidden="true">GST %</span>
          <input class="input input-num" inputmode="decimal" data-l="gstRate" aria-label="GST percent" value="${line.gstRate ?? 0}">
        </div>` : ""}
      <div class="li-cell li-amount">
        <span class="li-label" aria-hidden="true">Amount</span>
        <span class="li-amount-value num" data-line-amount></span>
      </div>
      <button type="button" class="icon-btn icon-btn-danger li-remove" data-remove-line aria-label="Remove this line" title="Remove this line">${icon("x")}</button>
    </div>`;

  const readLines = (el) => $$("[data-line]", el).map((row) => {
    const get = (key) => $(`[data-l="${key}"]`, row)?.value ?? "";
    return {
      desc: get("desc").trim(), hsn: get("hsn").trim(), qty: parse(get("qty")), rate: parse(get("rate")),
      gstRate: gstOn() ? num(get("gstRate")) : 0, itemId: get("itemId") || null,
    };
  });
  const isBlank = (l) => !l.desc && !l.itemId && !(l.qty * l.rate);

  let paint = () => {};
  return {
    k, type: "custom", full: true, label: "Items",
    read: (el) => readLines(el).filter((l) => !isBlank(l)),
    validate: (lines) => {
      if (!lines?.length) return "Add at least one line";
      if (lines.some((l) => !l.desc)) return "Every line needs a description";
      if (lines.some((l) => l.qty <= 0)) return "Every line needs a quantity above zero";
      return "";
    },
    onAnyChange: () => paint(),
    mount(el, api) {
      const initial = api.initial[k];
      setHTML(el, html`
        <div class="lines-editor">
          <div data-rows>${(initial?.length ? initial : [{}]).map((l) => rowHtml(l))}</div>
          <button type="button" class="btn btn-sm" data-add-line>${icon("plus", { cls: "icon-sm" })}Add a line</button>
          <div class="lines-summary" data-summary aria-live="polite"></div>
        </div>`);

      paint = () => {
        const lines = readLines(el);
        const o = getOptions(api);
        for (const row of $$("[data-line]", el)) {
          $("[data-line-amount]", row).textContent = money(parse($('[data-l="qty"]', row).value) * parse($('[data-l="rate"]', row).value));
        }
        const t = docTotals({ lines, taxInclusive: !!o.taxInclusive });
        const parts = gstSplit(t.gst, o.bizState, o.partyState);
        setHTML($("[data-summary]", el), html`
          <div class="line"><span class="line-label">Taxable amount</span><span class="line-value">${money(t.subtotal)}</span></div>
          ${gstOn() && t.gst ? (parts.igst
            ? html`<div class="line"><span class="line-label">IGST</span><span class="line-value" data-igst>${money(parts.igst)}</span></div>`
            : html`<div class="line"><span class="line-label">CGST</span><span class="line-value">${money(parts.cgst)}</span></div><div class="line"><span class="line-label">SGST</span><span class="line-value">${money(parts.sgst)}</span></div>`) : ""}
          <div class="line line-total"><span class="line-label">Total</span><span class="line-value" data-total>${money(t.total)}</span></div>`);
      };

      on(el, "click", "[data-add-line]", () => {
        const holder = document.createElement("div");
        setHTML(holder, rowHtml({ gstRate: gstOn() ? (getOptions(api).defaultGst ?? 0) : 0 }));
        $("[data-rows]", el).appendChild(holder.firstElementChild);
        paint();
        $$("[data-line]", el).at(-1).querySelector('[data-l="desc"]').focus();
      });
      on(el, "click", "[data-remove-line]", (e, b) => {
        if ($$("[data-line]", el).length > 1) { b.closest("[data-line]").remove(); paint(); el.dispatchEvent(new Event("input", { bubbles: true })); }
      });
      on(el, "change", '[data-l="itemId"]', (e, select) => {
        const item = state().items.find((i) => i.id === select.value);
        if (!item) return;
        const row = select.closest("[data-line]");
        $('[data-l="desc"]', row).value = item.name;
        const hsn = $('[data-l="hsn"]', row);
        if (hsn) hsn.value = item.hsn || "";
        $('[data-l="rate"]', row).value = item[priceKey] || "";
        const gst = $('[data-l="gstRate"]', row);
        if (gst) gst.value = item.gstRate ?? 0;
        paint();
      });
      paint();
    },
  };
}
