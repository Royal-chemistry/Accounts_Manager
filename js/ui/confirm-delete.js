// Every delete in the app goes through here: a clear warning, then the Recycle Bin, then an Undo toast.
import { impactOf, moveToBin, restoreFromBin } from "../core/bin.js";
import { $, html } from "./dom.js";
import { icon } from "./icons.js";
import { openModal } from "./modal.js";
import { toast, undoToast } from "./toast.js";

const COLLECTIONS = { client: "clients", supplier: "suppliers", staff: "staff", item: "items", account: "accounts" };

function impactBody(impact) {
  return html`
    <div class="stack">
      ${impact.blockers.length ? html`
        <div class="banner banner-danger" role="alert">${icon("alert")}<div>${impact.blockers.map((b) => html`<p>${b}</p>`)}</div></div>` : html`
        <div>
          <p class="impact-title">This will remove:</p>
          <ul class="impact-list">${impact.removes.map((r) => html`<li>${r}</li>`)}</ul>
          ${impact.affects.length ? html`
            <p class="impact-title">It also changes:</p>
            <ul class="impact-list">${impact.affects.map((r) => html`<li>${r}</li>`)}</ul>` : ""}
        </div>`}
      ${impact.warnings.length ? html`<div class="banner banner-warning">${icon("alert")}<div>${impact.warnings.map((w) => html`<p>${w}</p>`)}</div></div>` : ""}
      ${impact.alternative ? html`<div class="banner">${icon("info")}<p><b>${impact.alternative.label}.</b> ${impact.alternative.note}</p></div>` : ""}
      ${impact.blockers.length ? "" : html`<p class="small muted">Everything goes to the Recycle Bin, so you can restore it later.</p>`}
    </div>`;
}

/** Puts a bin entry back and reports the result. */
export function restoreEntry(ctx, binId, { quiet = false } = {}) {
  const result = restoreFromBin(ctx.state(), binId);
  if (!result.ok) {
    toast(result.reason, { kind: "error", duration: 8000 });
    return false;
  }
  ctx.store.update(() => result.state);
  if (result.warnings.length) toast(result.warnings[0], { kind: "info", duration: 8000 });
  else if (!quiet) toast("Restored");
  return true;
}

/**
 * Shows the warning and, if confirmed, moves the record to the bin with an Undo toast.
 * onDeleted runs after the delete, for pages that need to navigate away.
 */
export function confirmDelete(ctx, type, id, { onDeleted, verb = "Delete" } = {}) {
  const impact = impactOf(ctx.state(), type, id);
  const blocked = impact.blockers.length > 0;
  const m = openModal({
    title: impact.title,
    size: "sm",
    body: impactBody(impact),
    foot: html`
      <button type="button" class="btn" data-modal-close>Cancel</button>
      ${impact.alternative ? html`<button type="button" class="btn ${blocked ? "btn-primary" : ""}" data-alt>${impact.alternative.label}</button>` : ""}
      ${blocked ? "" : html`<button type="button" class="btn btn-danger" data-delete>${verb}${impact.alternative ? " everything" : ""}</button>`}`,
  });
  $("[data-alt]", m.dialog)?.addEventListener("click", () => {
    const collection = COLLECTIONS[type];
    ctx.store.update((s) => {
      const doc = s[collection].find((d) => d.id === id);
      if (doc) doc.active = false;
    });
    m.close();
    toast(`${impact.label} is now ${impact.alternative.action === "close" ? "closed" : "inactive"}`, {
      action: { label: "Undo", onClick: () => ctx.store.update((s) => { const doc = s[collection].find((d) => d.id === id); if (doc) doc.active = true; }) },
      duration: 8000,
    });
  });
  $("[data-delete]", m.dialog)?.addEventListener("click", () => {
    const { state, entry } = moveToBin(ctx.state(), type, id, { now: new Date() });
    m.close();
    ctx.store.update(() => state);
    undoToast(`Moved to the Recycle Bin: ${impact.label}`, () => restoreEntry(ctx, entry.id));
    onDeleted?.();
  });
}
