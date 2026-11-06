// The one table used everywhere: sorting, search, filters, sticky header, totals, row actions and
// empty states. On phones each row becomes a small card.
import { $, html, on, raw, setHTML } from "./dom.js";
import { icon } from "./icons.js";
import { openMenu } from "./menu.js";

const PREFS = "accounts-manager:table:";
const load = (id) => { try { return JSON.parse(sessionStorage.getItem(PREFS + id)) || {}; } catch { return {}; } };
const persist = (id, v) => { try { sessionStorage.setItem(PREFS + id, JSON.stringify(v)); } catch { /* not important */ } };

function compare(a, b) {
  const blank = (v) => v === "" || v == null;
  if (blank(a) && blank(b)) return 0;
  if (blank(a)) return 1;
  if (blank(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** A plain empty state, also used outside tables. */
export function emptyState({ icon: ic = "info", title, hint, action }) {
  return html`
    <div class="empty">
      <span class="empty-icon">${icon(ic)}</span>
      <p class="empty-title">${title}</p>
      ${hint ? html`<p class="empty-hint">${hint}</p>` : ""}
      ${action || ""}
    </div>`;
}

/**
 * config: {
 *   id, label, rows: () => [],
 *   columns: [{ key, label, align: "num"|"right", sortable, value(row), render(row), mobile: "title"|"amount"|"status"|"meta"|"detail"|"hide" }],
 *   search: { placeholder, text(row) }, filters: [{ key, label, options: [[value, label]], test(row, value) }],
 *   defaultSort: { key, dir }, totals(rows) => ({ columnKey: content }),
 *   actions(row) => [{ label, icon, onClick, danger, primary }],
 *   rowClass(row), empty: { icon, title, hint, action }, pageSize, toolbar: markup,
 * }
 */
export function createTable(host, config) {
  const prefs = load(config.id);
  const state = {
    query: prefs.query || "",
    filters: prefs.filters || {},
    sort: prefs.sort || config.defaultSort || null,
    limit: config.pageSize || 100,
  };
  const columns = config.columns;
  const save = () => persist(config.id, { query: state.query, filters: state.filters, sort: state.sort });
  const rowId = (row) => (config.rowId ? config.rowId(row) : row.id);

  function visibleRows() {
    let rows = config.rows();
    const all = rows.length;
    const q = state.query.trim().toLowerCase();
    if (q && config.search) rows = rows.filter((r) => config.search.text(r).toLowerCase().includes(q));
    for (const f of config.filters || []) {
      const v = state.filters[f.key];
      if (v) rows = rows.filter((r) => f.test(r, v));
    }
    if (state.sort) {
      const col = columns.find((c) => c.key === state.sort.key);
      if (col) {
        const dir = state.sort.dir === "desc" ? -1 : 1;
        const value = col.value || ((r) => r[col.key]);
        rows = rows.map((r, i) => [r, i]).sort((a, b) => dir * compare(value(a[0]), value(b[0])) || a[1] - b[1]).map((p) => p[0]);
      }
    }
    return { rows, all };
  }

  const hasFilters = () => !!state.query.trim() || Object.values(state.filters).some(Boolean);
  const sortable = columns.filter((c) => c.sortable);

  function renderHead() {
    return html`<tr role="row">
      ${columns.map((c) => {
        const active = state.sort?.key === c.key;
        const aria = active ? (state.sort.dir === "desc" ? "descending" : "ascending") : "none";
        const cls = c.align === "num" ? "col-num" : c.align === "right" ? "col-right" : "";
        if (!c.sortable) return html`<th scope="col" role="columnheader" class="${cls}">${c.label}</th>`;
        return html`<th scope="col" role="columnheader" class="${cls}" aria-sort="${aria}">
          <button type="button" class="th-btn" data-sort="${c.key}">${c.label}${icon(active ? (state.sort.dir === "desc" ? "sort-desc" : "sort-asc") : "sort")}</button>
        </th>`;
      })}
      ${config.actions ? html`<th scope="col" role="columnheader" class="col-actions"><span class="sr-only">Actions</span></th>` : ""}
    </tr>`;
  }

  function renderActions(row) {
    const items = config.actions(row);
    if (!items.length) return "";
    const id = rowId(row);
    const inline = items.filter((a) => a.primary);
    const rest = items.filter((a) => !a.primary);
    return html`<span class="row-actions">
      ${inline.map((a) => html`<button type="button" class="btn btn-sm" data-row-action="${items.indexOf(a)}" data-row-id="${id}">${a.icon ? icon(a.icon, { cls: "icon-sm" }) : ""}${a.label}</button>`)}
      ${rest.length === 1 && !rest[0].menu
        ? html`<button type="button" class="icon-btn ${rest[0].danger ? "icon-btn-danger" : ""}" data-row-action="${items.indexOf(rest[0])}" data-row-id="${id}" aria-label="${rest[0].label}" title="${rest[0].label}">${icon(rest[0].icon || "more")}</button>`
        : rest.length ? html`<button type="button" class="icon-btn" data-row-menu="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions" title="More actions">${icon("more")}</button>` : ""}
    </span>`;
  }

  function renderBody(rows) {
    return rows.map((row) => html`<tr role="row" class="${config.rowClass?.(row) || ""}">
      ${columns.map((c) => {
        const cls = c.align === "num" ? "col-num" : c.align === "right" ? "col-right" : "";
        const content = c.render ? c.render(row) : row[c.key];
        return html`<td role="cell" class="${cls}" data-label="${c.label}" data-mobile="${c.mobile || "detail"}">${content ?? ""}</td>`;
      })}
      ${config.actions ? html`<td role="cell" class="col-actions">${renderActions(row)}</td>` : ""}
    </tr>`);
  }

  function renderFoot(rows) {
    if (!config.totals || !rows.length) return "";
    const t = config.totals(rows);
    return html`<tfoot role="rowgroup"><tr role="row">
      ${columns.map((c) => html`<td role="cell" class="${c.align === "num" ? "col-num" : ""}" data-label="${c.label}" data-mobile="${t[c.key] === undefined ? "hide" : c.mobile === "title" ? "title" : "detail"}">${t[c.key] ?? ""}</td>`)}
      ${config.actions ? html`<td role="cell" class="col-actions" data-mobile="hide"></td>` : ""}
    </tr></tfoot>`;
  }

  function refreshBody() {
    const { rows, all } = visibleRows();
    const area = $("[data-table-area]", host);
    if (!all) {
      setHTML(area, emptyState(config.empty || { title: "Nothing here yet" }));
    } else if (!rows.length) {
      setHTML(area, emptyState({
        icon: "search", title: "No matches",
        hint: "Try a different search or clear the filters.",
        action: html`<button type="button" class="btn" data-clear-filters>Clear filters</button>`,
      }));
    } else {
      const shown = rows.slice(0, state.limit);
      setHTML(area, html`
        <div class="table-wrap" role="region" aria-label="${config.label || "Table"}" tabindex="0">
          <table class="tbl" role="table">
            ${config.caption ? html`<caption class="sr-only">${config.caption}</caption>` : ""}
            <thead role="rowgroup">${renderHead()}</thead>
            <tbody role="rowgroup">${renderBody(shown)}</tbody>
            ${renderFoot(rows)}
          </table>
        </div>
        ${rows.length > state.limit ? html`<div class="table-more"><button type="button" class="btn" data-show-more>Show ${Math.min(rows.length - state.limit, config.pageSize || 100)} more of ${rows.length - state.limit} remaining</button></div>` : ""}`);
    }
    const count = $("[data-table-count]", host);
    if (count) count.textContent = hasFilters() ? `${rows.length} of ${all} shown` : "";
  }

  function renderToolbar() {
    const showBar = config.search || config.filters?.length || config.toolbar || sortable.length;
    if (!showBar) return "";
    return html`
      <div class="toolbar">
        ${config.search ? html`
          <div class="search input-wrap">
            <span class="prefix" aria-hidden="true">${icon("search", { cls: "icon-sm" })}</span>
            <label class="sr-only" for="${config.id}-search">Search</label>
            <input class="input input-has-prefix" id="${config.id}-search" type="search" data-table-search placeholder="${config.search.placeholder || "Search"}" value="${state.query}" autocomplete="off">
          </div>` : ""}
        ${(config.filters || []).map((f) => html`
          <label class="sr-only" for="${config.id}-filter-${f.key}">${f.label}</label>
          <select class="input" id="${config.id}-filter-${f.key}" data-table-filter="${f.key}">
            <option value="">${f.label}</option>
            ${f.options.map(([v, l]) => html`<option value="${v}" ${state.filters[f.key] === String(v) ? raw("selected") : ""}>${l}</option>`)}
          </select>`)}
        ${sortable.length ? html`
          <label class="sr-only" for="${config.id}-sort">Sort by</label>
          <select class="input sort-mobile" id="${config.id}-sort" data-table-sort-select>
            ${sortable.flatMap((c) => [
              html`<option value="${c.key}:asc" ${state.sort?.key === c.key && state.sort.dir !== "desc" ? raw("selected") : ""}>Sort: ${c.label} (low first)</option>`,
              html`<option value="${c.key}:desc" ${state.sort?.key === c.key && state.sort.dir === "desc" ? raw("selected") : ""}>Sort: ${c.label} (high first)</option>`,
            ])}
          </select>` : ""}
        <span class="small muted" data-table-count role="status"></span>
        ${config.toolbar || ""}
      </div>`;
  }

  setHTML(host, html`${renderToolbar()}<div data-table-area></div>`);

  let searchTimer = null;
  const stops = [
    on(host, "input", "[data-table-search]", (e) => {
      state.query = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.limit = config.pageSize || 100; save(); refreshBody(); }, 120);
    }),
    on(host, "change", "[data-table-filter]", (e, el) => {
      state.filters[el.dataset.tableFilter] = el.value;
      state.limit = config.pageSize || 100;
      save(); refreshBody();
    }),
    on(host, "change", "[data-table-sort-select]", (e, el) => {
      const [key, dir] = el.value.split(":");
      state.sort = { key, dir };
      save(); refreshBody();
    }),
    on(host, "click", "[data-sort]", (e, el) => {
      const key = el.dataset.sort;
      state.sort = state.sort?.key === key ? { key, dir: state.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
      save(); refreshBody();
      $(`[data-sort="${key}"]`, host)?.focus();
    }),
    on(host, "click", "[data-clear-filters]", () => {
      state.query = ""; state.filters = {};
      const s = $("[data-table-search]", host); if (s) s.value = "";
      for (const sel of host.querySelectorAll("[data-table-filter]")) sel.value = "";
      save(); refreshBody();
      (s || $("[data-table-area]", host)).focus?.();
    }),
    on(host, "click", "[data-show-more]", () => { state.limit += config.pageSize || 100; refreshBody(); }),
    on(host, "click", "[data-row-action]", (e, el) => {
      const row = config.rows().find((r) => String(rowId(r)) === el.dataset.rowId);
      if (row) config.actions(row)[Number(el.dataset.rowAction)]?.onClick(row, el);
    }),
    on(host, "click", "[data-row-menu]", (e, el) => {
      const row = config.rows().find((r) => String(rowId(r)) === el.dataset.rowMenu);
      if (!row) return;
      const items = config.actions(row).filter((a) => !a.primary);
      openMenu(el, items.map((a) => ({ label: a.label, icon: a.icon, danger: a.danger, onSelect: () => a.onClick(row, el) })), { label: "Row actions" });
    }),
  ];

  refreshBody();
  return {
    refresh: refreshBody,
    visibleRows: () => visibleRows().rows,
    destroy() { stops.forEach((s) => s()); clearTimeout(searchTimer); },
  };
}
