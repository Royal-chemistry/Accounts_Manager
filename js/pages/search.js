// Search across the whole business, as its own tab like the App Store's.
import { searchAll } from "../core/search.js";
import { artwork } from "../ui/artwork.js";
import { $, html, on, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { emptyState } from "../ui/table.js";
import { pageHead } from "./_common.js";

const SESSION_KEY = "accounts-manager:search";
const remembered = () => { try { return sessionStorage.getItem(SESSION_KEY) || ""; } catch { return ""; } };
const remember = (q) => { try { sessionStorage.setItem(SESSION_KEY, q); } catch { /* not important */ } };

function results(ctx, query) {
  if (!query.trim()) return emptyState({ icon: "search", title: "Search everything", hint: "Find a client, supplier, invoice, bill, staff member, stock item or cash book entry." });
  const groups = searchAll(ctx.state(), query);
  if (!groups.length) return emptyState({ icon: "search", title: "No results", hint: `Nothing matches "${query}". Check the spelling, or try fewer words.` });
  return html`${groups.map((g) => html`
    <section class="card search-group">
      <h2 class="card-title">${g.title}</h2>
      <ul class="app-rows">
        ${g.results.map((r) => html`<li class="app-row">
          ${artwork(r.name, "md")}
          <a class="app-row-text plain-link" href="#/${r.href}">
            <span class="app-row-name">${r.name}</span>
            ${r.detail ? html`<span class="app-row-sub">${r.detail}</span>` : ""}
          </a>
          ${r.amount !== undefined ? html`<span class="app-row-amount">${ctx.money(r.amount, { decimals: 0 })}</span>` : ""}
          ${icon("chevron-right", { cls: "icon-sm app-row-chevron" })}
        </li>`)}
      </ul>
      ${g.more ? html`<p class="small muted report-note">and ${g.more} more. Add another word to narrow it down.</p>` : ""}
    </section>`)}`;
}

export default {
  id: "search",
  title: "Search",
  render(root, ctx) {
    const query = remembered();
    setHTML(root, html`
      <div class="page">
        ${pageHead({ title: "Search" })}
        <div class="search-box" role="search">
          ${icon("search")}
          <label class="sr-only" for="global-search">Search everything</label>
          <input class="input" type="search" id="global-search" data-table-search placeholder="Clients, invoices, staff and more" value="${query}" autocomplete="off">
        </div>
        <div class="stack" data-results aria-live="polite">${results(ctx, query)}</div>
      </div>`);
    on(root, "input", "#global-search", (e, el) => {
      remember(el.value);
      setHTML($("[data-results]", root), results(ctx, el.value));
    });
    if (window.matchMedia("(min-width: 768px)").matches) $("#global-search", root).focus({ preventScroll: true });
  },
};
