// The Recycle Bin: search, filter by type, restore, and delete for good.
import { BIN_TYPES, emptyBin, purgeFromBin } from "../core/bin.js";
import { html, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { askConfirm, askTyped } from "../ui/modal.js";
import { createTable } from "../ui/table.js";
import { restoreEntry } from "../ui/confirm-delete.js";
import { toast } from "../ui/toast.js";
import { pageHead } from "./_common.js";

const deletedLabel = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default {
  id: "recycle-bin",
  title: "Recycle Bin",
  render(root, ctx) {
    const bin = () => ctx.state().bin;
    setHTML(root, html`
      <div class="page">
        ${pageHead({
          title: "Recycle Bin",
          sub: "Deleted records stay here until you restore them or delete them for good.",
          actions: bin().length ? html`<button type="button" class="btn" data-empty-bin>${icon("trash")}Empty bin</button>` : "",
        })}
        <section class="card card-flush" data-table></section>
      </div>`);

    const types = [...new Set(bin().map((e) => e.type))].map((t) => [t, BIN_TYPES[t] || t]);
    createTable(root.querySelector("[data-table]"), {
      id: "bin", label: "Deleted records",
      rows: bin,
      defaultSort: { key: "deletedAt", dir: "desc" },
      search: { placeholder: "Search deleted records", text: (e) => `${e.label} ${BIN_TYPES[e.type] || ""}` },
      filters: types.length > 1 ? [{ key: "type", label: "All types", options: types, test: (e, v) => e.type === v }] : [],
      columns: [
        { key: "label", label: "Record", sortable: true, mobile: "title", render: (e) => html`<span class="cell-title wrap-anywhere">${e.label}</span>` },
        { key: "type", label: "Type", sortable: true, mobile: "meta", value: (e) => BIN_TYPES[e.type] || e.type, render: (e) => html`<span class="badge">${BIN_TYPES[e.type] || e.type}</span>` },
        { key: "amount", label: "Amount", align: "num", sortable: true, mobile: "amount", render: (e) => (e.amount ? ctx.money(e.amount) : "") },
        { key: "deletedAt", label: "Deleted", sortable: true, mobile: "meta", render: (e) => deletedLabel(e.deletedAt) },
      ],
      actions: (e) => [
        { label: "Restore", icon: "undo", primary: true, onClick: () => restoreEntry(ctx, e.id) },
        {
          label: "Delete permanently", icon: "trash", danger: true,
          onClick: async () => {
            const ok = await askConfirm({
              title: "Delete permanently?",
              body: html`<p><b>${e.label}</b> and everything deleted with it will be gone for good. This can't be undone.</p>`,
              confirmLabel: "Delete permanently", danger: true,
            });
            if (ok) { ctx.store.update((s) => purgeFromBin(s, e.id)); toast("Permanently deleted"); }
          },
        },
      ],
      empty: { icon: "trash", title: "The Recycle Bin is empty", hint: "Anything you delete comes here first, so a mistake is easy to put right." },
    });

    root.querySelector("[data-empty-bin]")?.addEventListener("click", async () => {
      const n = bin().length;
      const ok = await askTyped({
        title: "Empty the Recycle Bin?",
        body: html`<p>This permanently deletes ${n} ${n === 1 ? "item" : "items"}. This can't be undone, so make a backup first if you're unsure.</p>`,
        word: "EMPTY", confirmLabel: "Empty the bin",
      });
      if (ok) { ctx.store.update((s) => emptyBin(s)); toast("Recycle Bin emptied"); }
    });
  },
};
