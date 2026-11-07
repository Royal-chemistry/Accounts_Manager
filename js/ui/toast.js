// Short messages, including the Undo toast. Screen readers announce them, keyboard users can reach
// their buttons, and the timer waits while the pointer or focus is on one.
import { html, toElement } from "./dom.js";
import { icon } from "./icons.js";

const MAX_TOASTS = 3;
let region = null;

function ensureRegion() {
  if (region?.isConnected) return region;
  region = toElement(html`<div class="toasts" role="status" aria-live="polite" aria-relevant="additions"></div>`);
  document.body.appendChild(region);
  return region;
}

/**
 * Shows a message.
 * kind: "success" | "error" | "info". action: { label, onClick }. duration in milliseconds.
 */
export function toast(message, { kind = "success", action = null, duration = 4000 } = {}) {
  const host = ensureRegion();
  const iconName = kind === "error" ? "alert" : kind === "info" ? "info" : "check-circle";
  const el = toElement(html`
    <div class="toast ${kind === "error" ? "toast-error" : kind === "info" ? "toast-info" : ""}">
      ${icon(iconName)}
      <span class="toast-text">${message}</span>
      ${action ? html`<button type="button" class="btn btn-sm toast-action" data-toast-action>${action.label}</button>` : ""}
      <button type="button" class="icon-btn" data-toast-close aria-label="Dismiss">${icon("x", { cls: "icon-sm" })}</button>
    </div>`);

  let timer = null;
  let left = duration;
  let startedAt = 0;
  const start = () => { startedAt = performance.now(); timer = setTimeout(dismiss, left); };
  const pause = () => { clearTimeout(timer); left = Math.max(1000, left - (performance.now() - startedAt)); };
  function dismiss() { clearTimeout(timer); el.remove(); }

  el.addEventListener("pointerenter", pause);
  el.addEventListener("pointerleave", start);
  el.addEventListener("focusin", pause);
  el.addEventListener("focusout", start);
  el.querySelector("[data-toast-close]").addEventListener("click", dismiss);
  el.querySelector("[data-toast-action]")?.addEventListener("click", () => { dismiss(); action.onClick(); });

  host.appendChild(el);
  while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();
  start();
  return dismiss;
}

export const UNDO_MS = 8000;

export const undoToast = (message, onUndo) => toast(message, { action: { label: "Undo", onClick: onUndo }, duration: UNDO_MS });

/**
 * Presses the newest Undo on screen, if there is one. Tabbing to it across a whole page
 * can't be done in 8 seconds, so keyboard users get a shortcut.
 */
export function pressUndo() {
  const undo = [...(region?.querySelectorAll("[data-toast-action]") || [])].filter((b) => b.textContent.trim() === "Undo").at(-1);
  undo?.click();
  return !!undo;
}
