// A small keyboard-friendly popup menu.
import { html, on, raw, toElement } from "./dom.js";
import { icon } from "./icons.js";

let closeCurrent = null;

export const closeMenu = () => closeCurrent?.();

/**
 * Opens a menu beside a button.
 * items: [{ label, icon, onSelect, danger, checked, separator, href }]
 */
export function openMenu(anchor, items, { label = "Menu", align = "right" } = {}) {
  closeMenu();
  const menu = toElement(html`
    <div class="menu" role="menu" aria-label="${label}">
      ${items.map((it, i) => it.separator ? html`<div class="menu-sep" role="separator"></div>` : it.href
        ? html`<a class="menu-item ${it.danger ? "menu-item-danger" : ""}" role="menuitem" href="${it.href}" tabindex="-1" data-index="${i}">${it.icon ? icon(it.icon) : ""}${it.label}</a>`
        : html`<button type="button" class="menu-item ${it.danger ? "menu-item-danger" : ""}" role="${it.checked === undefined ? "menuitem" : "menuitemradio"}" ${it.checked === undefined ? "" : raw(`aria-checked="${!!it.checked}"`)} tabindex="-1" data-index="${i}">${it.icon ? icon(it.icon) : ""}${it.label}${it.checked ? icon("check", { cls: "icon-sm" }) : ""}</button>`)}
    </div>`);
  // Inside a dialog the menu has to sit in the same top layer to be visible.
  (anchor.closest("dialog") || document.body).appendChild(menu);

  const box = anchor.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const left = align === "left" ? box.left : box.right - size.width;
  const fitsBelow = box.bottom + size.height + 8 < window.innerHeight;
  menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - size.width - 8))}px`;
  menu.style.top = `${fitsBelow ? box.bottom + 4 : Math.max(8, box.top - size.height - 4)}px`;

  const buttons = () => [...menu.querySelectorAll(".menu-item")];
  const stopClick = on(menu, "click", ".menu-item", (e, btn) => {
    const item = items[Number(btn.dataset.index)];
    close();
    item.onSelect?.(e);
  });
  const onKey = (e) => {
    const list = buttons();
    const at = list.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list.at(-1)?.focus(); }
    else if (e.key === "Tab") { close(); }
  };
  const onOutside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(false); };
  menu.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("resize", closeOnResize);
  anchor.setAttribute("aria-expanded", "true");

  function closeOnResize() { close(false); }
  function close(returnFocus = true) {
    stopClick();
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", closeOnResize);
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    closeCurrent = null;
    if (returnFocus && anchor.isConnected) anchor.focus();
  }
  closeCurrent = close;
  buttons()[0]?.focus();
  return close;
}
