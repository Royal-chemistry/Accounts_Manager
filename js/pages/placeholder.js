// Stands in for pages that haven't been rebuilt yet on the v2 branch. Removed by M5.
import { html, setHTML } from "../ui/dom.js";
import { emptyState } from "../ui/table.js";
import { pageHead } from "./_common.js";

export const placeholder = (id, title, ic) => ({
  id, title,
  render(root) {
    setHTML(root, html`<div class="page">${pageHead({ title })}<section class="card">${emptyState({ icon: ic, title: "Being rebuilt", hint: "This page is coming in a later milestone." })}</section></div>`);
  },
});
