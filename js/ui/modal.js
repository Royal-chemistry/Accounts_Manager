// Modals, built on the native dialog element: focus stays inside, Esc closes, and focus returns to
// whatever opened it. If typing would be lost, closing asks first, inside the modal itself.
import { $, html, setHTML, toElement } from "./dom.js";
import { icon } from "./icons.js";

let titleCounter = 0;

/**
 * Opens a modal.
 * body: markup. foot: markup for the footer. size: "sm" | "lg" | "xl".
 * isDirty: when it returns true, closing asks before discarding. onClose runs after closing.
 */
export function openModal({ title, body, foot = null, size = "", cls = "", isDirty = null, onClose = null, form = false }) {
  const opener = document.activeElement;
  const titleId = `modal-title-${++titleCounter}`;
  const inner = html`
    <div class="modal-head">
      <h2 id="${titleId}">${title}</h2>
      <button type="button" class="icon-btn" data-modal-close aria-label="Close">${icon("x")}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${foot ? html`<div class="modal-foot">${foot}</div>` : ""}`;
  const dialog = toElement(html`
    <dialog class="modal ${size ? `modal-${size}` : ""} ${cls}" aria-labelledby="${titleId}">
      ${form ? html`<form novalidate>${inner}</form>` : inner}
    </dialog>`);
  document.body.appendChild(dialog);

  let closed = false;
  const foot$ = () => $(".modal-foot", dialog);
  let savedFoot = null; // the footer's own buttons, kept while "discard changes?" is showing

  function close() {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    // When nothing in particular opened it, as with a keyboard shortcut, the page heading is the next best place.
    if (opener?.isConnected && opener !== document.body) opener.focus();
    else $("#page-title")?.focus();
    onClose?.();
  }

  function askToDiscard() {
    const f = foot$();
    if (!f) return close();
    savedFoot = [...f.childNodes];
    setHTML(f, html`
      <span class="modal-foot-note" role="alert">You have unsaved changes.</span>
      <button type="button" class="btn" data-keep-editing>Keep editing</button>
      <button type="button" class="btn btn-danger" data-discard>Discard changes</button>`);
    $("[data-keep-editing]", f).focus();
  }

  function requestClose() {
    if (savedFoot !== null) return;
    if (isDirty?.()) askToDiscard();
    else close();
  }

  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-modal-close]")) { requestClose(); return; }
    if (e.target.closest("[data-keep-editing]")) {
      foot$().replaceChildren(...savedFoot);
      savedFoot = null;
      dialog.querySelector(".modal-body input, .modal-body select, .modal-body textarea")?.focus();
      return;
    }
    if (e.target.closest("[data-discard]")) { close(); return; }
    if (e.target === dialog) requestClose(); // a click on the backdrop
  });
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); requestClose(); });

  dialog.showModal();
  const first = dialog.querySelector("[autofocus], .modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea, .modal-body button, .modal-foot button");
  first?.focus();
  return { dialog, close, requestClose };
}

/** A simple question with buttons. Resolves true if confirmed. */
export function askConfirm({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, size = "sm" }) {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal({
      title, body, size,
      foot: html`
        <button type="button" class="btn" data-modal-close>${cancelLabel}</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${confirmLabel}</button>`,
      onClose: () => resolve(answer),
    });
    $("[data-confirm]", m.dialog).addEventListener("click", () => { answer = true; m.close(); });
  });
}

/**
 * For actions the Recycle Bin can't protect: the user types a word to confirm.
 * Resolves true if confirmed.
 */
export function askTyped({ title, body, word, confirmLabel }) {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal({
      title, size: "sm",
      body: html`
        <div class="stack">
          <div>${body}</div>
          <div class="field">
            <label class="field-label" for="typed-confirm">Type <b>${word}</b> to confirm</label>
            <input class="input" id="typed-confirm" autocomplete="off" spellcheck="false">
          </div>
        </div>`,
      foot: html`
        <button type="button" class="btn" data-modal-close>Cancel</button>
        <button type="button" class="btn btn-danger" data-confirm disabled>${confirmLabel}</button>`,
      onClose: () => resolve(answer),
    });
    const input = $("#typed-confirm", m.dialog);
    const go = $("[data-confirm]", m.dialog);
    input.addEventListener("input", () => { go.disabled = input.value.trim().toUpperCase() !== word.toUpperCase(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !go.disabled) go.click(); });
    go.addEventListener("click", () => { answer = true; m.close(); });
    input.focus();
  });
}
