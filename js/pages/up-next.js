// Up Next: a queue of what needs doing with money, played like a music queue. A small player floats above the
// content, and opens into a full sheet. Paying or receiving moves on to the next item by itself.
import { artTone } from "../core/artwork.js";
import { formatDate } from "../core/dates.js";
import { upNext } from "../core/reports.js";
import { artwork } from "../ui/artwork.js";
import { $, html, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { openModal } from "../ui/modal.js";
import { receiveForm } from "./invoices.js";
import { settleForm } from "./parties.js";
import { payBillForm } from "./purchases.js";
import { payForm } from "./recurring.js";

const skipped = new Set();
let sheet = null;

/** The queue, starting from the first item that hasn't been skipped this visit. */
function queue(ctx) {
  const items = upNext(ctx.state(), ctx.today());
  if (items.length && items.every((i) => skipped.has(i.key))) skipped.clear();
  const first = items.findIndex((i) => !skipped.has(i.key));
  return first > 0 ? [...items.slice(first), ...items.slice(0, first)] : items;
}

export const whenText = (item) => {
  if (item.days < 0) return `${-item.days} ${item.days === -1 ? "day" : "days"} late`;
  if (item.days === 0) return "Due today";
  if (item.days === 1) return "Due tomorrow";
  return `Due ${formatDate(item.due)}`;
};
const amountText = (ctx, item) => (item.variable ? "Amount varies" : ctx.money(item.amount, { decimals: 0 }));
export const actionLabel = (item) => (item.direction === "in" ? "Receive" : "Pay");

/** Opens the right form for an item in the queue. */
export function actOn(ctx, item) {
  const s = ctx.state();
  if (item.kind === "invoice") receiveForm(ctx, s.invoices.find((d) => d.id === item.id));
  else if (item.kind === "purchase") payBillForm(ctx, s.purchases.find((d) => d.id === item.id));
  else if (item.kind === "recurring") payForm(ctx, s.recurring.find((d) => d.id === item.id));
  else if (item.partyId) settleForm(ctx, item.partyType, item.partyId);
  else ctx.navigate("cashbook");
}

const skipButton = (attr) => html`<button type="button" class="icon-btn" ${attr} aria-label="Skip to the next one" title="Skip to the next one">${icon("skip")}</button>`;

/** The small player. It disappears when there's nothing to do. */
function paintPlayer(host, ctx) {
  const [item] = queue(ctx);
  if (!item) { setHTML(host, ""); return; }
  setHTML(host, html`
    <section class="up-next glass" aria-label="Up next">
      <button type="button" class="up-next-open" data-up-open aria-haspopup="dialog">
        ${artwork(item.name)}
        <span class="up-next-text"><span class="sr-only">Open Up Next: </span><span class="up-next-name">${item.name}</span> <span class="up-next-sub">${whenText(item)} · ${amountText(ctx, item)}</span></span>
      </button>
      <button type="button" class="btn btn-sm" data-up-act aria-label="${actionLabel(item)}: ${item.name}">${actionLabel(item)}</button>
      ${skipButton("data-up-skip")}
    </section>`);
}

const sheetBody = (ctx, items) => {
  const [item, ...rest] = items;
  if (!item) {
    return html`
      <div class="now now-clear">
        <span class="now-done">${icon("check-circle", { cls: "icon-lg" })}</span>
        <p class="now-name">You're all caught up</p>
        <p class="now-detail">Nothing is late or due in the next 7 days.</p>
        <button type="button" class="btn now-primary" data-modal-close>Done</button>
      </div>`;
  }
  return html`
    <div class="now">
      ${artwork(item.name, "xl")}
      <p class="now-name">${item.name}</p>
      <p class="now-detail">${item.detail}</p>
      <p class="now-amount">${amountText(ctx, item)}</p>
      <p class="now-when">${whenText(item)}</p>
      <div class="now-actions">
        <button type="button" class="btn now-primary" data-now-act>${actionLabel(item)}</button>
        ${skipButton("data-now-skip")}
      </div>
    </div>
    ${rest.length ? html`
      <h3 class="now-then">Then</h3>
      <ul class="now-queue">
        ${rest.map((i) => html`<li><button type="button" class="now-row" data-now-pick="${i.key}">
          ${artwork(i.name)}
          <span class="now-row-text"><span class="now-row-name">${i.name}</span><span class="now-row-sub">${whenText(i)}</span></span>
          <span class="now-row-amount">${amountText(ctx, i)}</span>
        </button></li>`)}
      </ul>` : ""}`;
};

function paintSheet(ctx) {
  const items = queue(ctx);
  const tone = artTone(items[0]?.name ?? "") ;
  // Colour moves on with the item, so each one feels like a new track.
  sheet.m.dialog.className = sheet.m.dialog.className.replace(/\bart-\d\b/g, "").trim();
  sheet.m.dialog.classList.add(items.length ? `art-${tone}` : "art-4");
  setHTML($(".modal-body", sheet.m.dialog), sheetBody(ctx, items));
  sheet.items = items;
}

/** Opens the full Up Next sheet. */
export function openUpNext(ctx) {
  if (sheet) return;
  const m = openModal({
    title: "Up next", cls: "modal-now", body: "",
    onClose: () => { sheet = null; },
  });
  sheet = { m, items: [] };
  paintSheet(ctx);
  $("[data-now-act], .now-primary", m.dialog)?.focus();
  m.dialog.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-now-act]")) { actOn(ctx, sheet.items[0]); return; }
    if (t.closest("[data-now-skip]")) {
      skipped.add(sheet.items[0].key);
      paintSheet(ctx);
      $("[data-now-skip]", m.dialog)?.focus();
      refreshPlayer();
      return;
    }
    const pick = t.closest("[data-now-pick]");
    if (pick) {
      // Choosing from the queue skips everything ahead of it, and brings the rest back round afterwards.
      for (const i of sheet.items) {
        if (i.key === pick.dataset.nowPick) break;
        skipped.add(i.key);
      }
      skipped.delete(pick.dataset.nowPick);
      paintSheet(ctx);
      $("[data-now-act]", m.dialog)?.focus();
      refreshPlayer();
    }
  });
}

let player = null;
const refreshPlayer = () => { if (player) paintPlayer(player.host, player.ctx); };

/** Puts the small player in the frame. paint() refreshes it, and the open sheet, after any change to the records. */
export function mountUpNext(host, ctx) {
  player = { host, ctx };
  host.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-up-open]")) { openUpNext(ctx); return; }
    const [item] = queue(ctx);
    if (!item) return;
    if (t.closest("[data-up-act]")) actOn(ctx, item);
    else if (t.closest("[data-up-skip]")) {
      skipped.add(item.key);
      refreshPlayer();
      $("[data-up-skip]", host)?.focus();
    }
  });
  return {
    paint() {
      refreshPlayer();
      if (sheet) paintSheet(ctx);
    },
  };
}
