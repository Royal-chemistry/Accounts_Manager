// The app frame: sidebar, top bar, phone bottom bar, and the "More" sheet.
import { $, html, raw, setHTML } from "./dom.js";
import { icon } from "./icons.js";
import { openMenu } from "./menu.js";
import { openModal } from "./modal.js";
import { monthPicker, mountMonthPicker } from "./month-picker.js";
import { setTheme, themePreference, THEME_OPTIONS } from "./theme.js";

export const NAV = [
  { group: "Overview", items: [{ id: "dashboard", label: "Today", icon: "dashboard" }, { id: "search", label: "Search", icon: "search" }, { id: "reports", label: "Reports", icon: "chart" }] },
  { group: "Sales", items: [{ id: "clients", label: "Clients", icon: "building" }, { id: "invoices", label: "Invoices", icon: "receipt" }] },
  { group: "Purchases", items: [{ id: "suppliers", label: "Suppliers", icon: "truck" }, { id: "purchases", label: "Purchases", icon: "cart" }, { id: "stock", label: "Stock", icon: "box", module: "stock" }] },
  { group: "Money", items: [{ id: "cashbook", label: "Cash book", icon: "book" }, { id: "recurring", label: "Recurring", icon: "repeat" }, { id: "banks", label: "Banks & loans", icon: "bank" }] },
  { group: "People", module: "payroll", items: [{ id: "staff", label: "Staff", icon: "users" }, { id: "attendance", label: "Attendance", icon: "attendance" }, { id: "salary", label: "Salary sheet", icon: "sheet" }, { id: "advances", label: "Advances", icon: "wallet" }] },
  { group: "System", items: [{ id: "recycle-bin", label: "Recycle Bin", icon: "trash" }, { id: "settings", label: "Settings", icon: "settings" }] },
];

const moduleOn = (state, module) => !module || state.settings.modules?.[module] !== false;
const visibleGroups = (state) => NAV.filter((g) => moduleOn(state, g.module)).map((g) => ({ ...g, items: g.items.filter((i) => moduleOn(state, i.module)) }));
const SIDE_KEY = "accounts-manager:side";

function brandMark(state) {
  return state.profile.logo
    ? html`<img class="brand-mark" src="${state.profile.logo}" alt="">`
    : html`<img class="brand-mark" src="assets/favicon.svg" alt="">`;
}

/** Numbers shown beside menu items, such as how many invoices are overdue. */
function navBadge(item, badges) {
  const b = badges[item.id];
  if (!b) return "";
  return html`<span class="nav-badge badge ${b.tone ? `badge-${b.tone}` : ""}" title="${b.title || ""}">${b.count}<span class="sr-only"> ${b.title || ""}</span></span>`;
}

function navLinks(state, current, badges) {
  return visibleGroups(state).map((g) => html`
    <div class="nav-group">
      <div class="nav-group-label" aria-hidden="true">${g.group}</div>
      <ul aria-label="${g.group}">
        ${g.items.map((item) => html`<li>
          <a class="nav-item" href="#/${item.id}" title="${item.label}" ${item.id === current ? raw('aria-current="page"') : ""}>
            ${icon(item.icon)}<span class="nav-label">${item.label}</span>${navBadge(item, badges)}
          </a></li>`)}
      </ul>
    </div>`);
}

export function createShell(root, ctx, { quickAdd, badges, mountUpNext }) {
  let current = "dashboard";
  let collapsed = false;
  let upNext = null;
  let paintedBrand = null;
  try { collapsed = localStorage.getItem(SIDE_KEY) === "collapsed"; } catch { /* not important */ }

  setHTML(root, html`
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="app" data-app ${collapsed ? raw('data-side="collapsed"') : ""}>
      <aside class="side glass-side" aria-label="Main">
        <a class="brand" href="#/dashboard" data-brand></a>
        <nav class="nav" aria-label="Pages">
          <div class="nav-items"><span class="lozenge" data-side-lozenge aria-hidden="true" hidden></span><div data-nav></div></div>
        </nav>
        <div class="side-foot" data-side-foot></div>
      </aside>
      <div class="main-col">
        <header class="topbar" data-topbar>
          <a class="topbar-brand" href="#/dashboard" data-top-brand></a>
          <div class="top-group glass side-collapse hide-phone"><button type="button" class="icon-btn" data-toggle-side aria-label="Collapse or expand the sidebar" title="Collapse or expand the sidebar">${icon("sidebar")}</button></div>
          <div class="top-group glass top-title" aria-hidden="true" data-top-title></div>
          <div class="topbar-spacer"></div>
          <div class="up-next-host" data-up-next-host></div>
          <div class="topbar-spacer"></div>
          <div class="top-group glass" data-month-host></div>
          <button type="button" class="btn btn-primary" data-quick-add aria-haspopup="menu" aria-expanded="false" aria-label="Quick add">${icon("plus")}<span class="quick-add-label">Add</span></button>
          <div class="top-group glass">
            <button type="button" class="icon-btn" data-theme-btn aria-haspopup="menu" aria-expanded="false" aria-label="Colour theme" title="Colour theme"></button>
            <button type="button" class="icon-btn hide-phone" data-shortcuts aria-label="Keyboard shortcuts" title="Keyboard shortcuts">${icon("keyboard")}</button>
          </div>
        </header>
        <div data-banner></div>
        <main class="main" id="main" tabindex="-1"></main>
      </div>
      <nav class="bottom-bar" aria-label="Quick links">
        <div class="tab-capsule glass">
          <div class="tab-track"><span class="lozenge" data-tab-lozenge aria-hidden="true" hidden></span><div class="tab-items" data-bottom></div></div>
        </div>
        <a class="tab-search glass" href="#/search" data-tab-search aria-label="Search">${icon("search")}</a>
      </nav>
    </div>`);

  const main = $("#main", root);

  /** Slides the highlight onto the selected item. It's hidden when that part of the frame isn't on screen. */
  function moveLozenge(lozenge, selected) {
    const shown = selected && selected.offsetWidth > 0;
    lozenge.hidden = !shown;
    if (!shown) return;
    const box = lozenge.parentElement.getBoundingClientRect();
    const rect = selected.getBoundingClientRect();
    lozenge.style.width = `${rect.width}px`;
    lozenge.style.height = `${rect.height}px`;
    lozenge.style.transform = `translate(${rect.left - box.left}px, ${rect.top - box.top}px)`;
  }
  function placeLozenges() {
    moveLozenge($("[data-side-lozenge]", root), $('[data-nav] [aria-current="page"]', root));
    moveLozenge($("[data-tab-lozenge]", root), $('[data-bottom] [aria-current="page"]', root));
  }
  window.addEventListener("resize", placeLozenges, { passive: true });

  // Once the large page title has scrolled away, a small copy appears in the floating controls.
  const topbar = $("[data-topbar]", root);
  // On a phone, scrolling down shrinks the tab bar and moves Up Next beside it, as in Music. Scrolling up brings it back.
  const app = $("[data-app]", root);
  const canShrink = window.matchMedia("(max-width: 767px) and (prefers-reduced-motion: no-preference)");
  let lastY = 0;
  const setDock = (min) => {
    if (min === app.hasAttribute("data-dock-min")) return;
    app.toggleAttribute("data-dock-min", min);
    placeLozenges();
  };
  const onScroll = () => {
    const y = window.scrollY;
    topbar.toggleAttribute("data-scrolled", y > 72);
    if (!canShrink.matches || y < 80) setDock(false);
    else if (y > lastY + 8) setDock(true);
    else if (y < lastY - 8) setDock(false);
    if (Math.abs(y - lastY) > 8 || y < 80) lastY = y;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  $(".bottom-bar", root).addEventListener("focusin", () => setDock(false));
  $(".tab-capsule", root).addEventListener("click", (e) => {
    if (app.hasAttribute("data-dock-min")) { e.preventDefault(); e.stopPropagation(); setDock(false); }
  }, true);

  // The address bar holds the current page, so a normal jump to #main would count as changing page.
  $(".skip-link", root).addEventListener("click", (e) => {
    e.preventDefault();
    main.focus();
  });

  function paintThemeButton() {
    const pref = themePreference();
    const opt = THEME_OPTIONS.find((o) => o.id === pref);
    setHTML($("[data-theme-btn]", root), icon(opt.icon));
  }

  function paint() {
    const state = ctx.state();
    const b = badges();
    // Rebuilding the logo makes it flicker, so this only happens when the name or logo changes.
    const brand = `${state.profile.name}|${state.profile.logo}`;
    if (brand !== paintedBrand) {
      paintedBrand = brand;
      setHTML($("[data-brand]", root), html`${brandMark(state)}<span class="brand-text"><span class="brand-name">${state.profile.name || "Accounts Manager"}</span><span class="brand-sub">${state.profile.name ? "Accounts Manager" : "Your business"}</span></span>`);
      setHTML($("[data-top-brand]", root), html`${brandMark(state)}<span class="sr-only">${state.profile.name || "Accounts Manager"}, go to dashboard</span>`);
    }
    const nav = $(".nav", root);
    const scroll = nav.scrollTop;
    setHTML($("[data-nav]", root), navLinks(state, current, b));
    nav.scrollTop = scroll;
    setHTML($("[data-side-foot]", root), html`
      <a class="nav-item" href="https://github.com/Royal-chemistry/Accounts_Manager" target="_blank" rel="noopener" title="Open source on GitHub">${icon("github")}<span class="nav-label">Open source · MIT</span></a>`);
    const payroll = state.settings.modules?.payroll !== false;
    const bottom = [
      { id: "dashboard", label: "Today", icon: "dashboard" },
      { id: "cashbook", label: "Cash", icon: "book" },
      { id: "invoices", label: "Invoices", icon: "receipt" },
      payroll ? { id: "staff", label: "Staff", icon: "users" } : { id: "reports", label: "Reports", icon: "chart" },
    ];
    const onBottom = bottom.some((i) => i.id === current);
    setHTML($("[data-bottom]", root), html`
      ${bottom.map((i) => html`<a class="bottom-item" href="#/${i.id}" ${i.id === current ? raw('aria-current="page"') : ""}>${icon(i.icon)}${i.label}</a>`)}
      <button type="button" class="bottom-item" data-more ${!onBottom ? raw('aria-current="page"') : ""}>${icon("menu")}More</button>`);
    placeLozenges();
    $("[data-tab-search]", root).toggleAttribute("aria-current", current === "search");
    upNext ??= mountUpNext($("[data-up-next-host]", root), ctx);
    upNext.paint();
    setHTML($("[data-month-host]", root), monthPicker(state.settings.month, ctx.today()));
    setHTML($("[data-banner]", root), ctx.store.isSample ? html`
      <div class="sample-banner">
        <span>You're exploring sample data. Your real records aren't affected.</span>
        <button type="button" class="btn btn-sm" data-exit-sample>Exit sample data</button>
      </div>` : "");
    paintThemeButton();
  }

  mountMonthPicker($("[data-month-host]", root), () => ctx.state().settings.month, (month) => {
    ctx.store.update((s) => { s.settings.month = month; });
    $("[data-month-select]", root)?.focus();
  });

  root.addEventListener("click", (e) => {
    const t = e.target;
    const quick = t.closest("[data-quick-add]");
    if (quick) { openMenu(quick, quickAdd(), { label: "Quick add" }); return; }
    const theme = t.closest("[data-theme-btn]");
    if (theme) {
      const pref = themePreference();
      openMenu(theme, THEME_OPTIONS.map((o) => ({ label: o.label, icon: o.icon, checked: o.id === pref, onSelect: () => { setTheme(o.id); paintThemeButton(); } })), { label: "Colour theme" });
      return;
    }
    if (t.closest("[data-toggle-side]")) {
      const app = $("[data-app]", root);
      const next = app.dataset.side === "collapsed" ? "" : "collapsed";
      if (next) app.dataset.side = next; else delete app.dataset.side;
      try { localStorage.setItem(SIDE_KEY, next); } catch { /* not important */ }
      placeLozenges();
      return;
    }
    if (t.closest("[data-shortcuts]")) { showShortcuts(); return; }
    if (t.closest("[data-exit-sample]")) { ctx.exitSample(); return; }
    if (t.closest("[data-more]")) {
      const state = ctx.state();
      const m = openModal({
        title: "All pages",
        body: html`<nav aria-label="All pages" class="stack">${navLinks(state, current, badges())}</nav>`,
      });
      m.dialog.addEventListener("click", (ev) => { if (ev.target.closest(".nav-item")) m.close(); });
    }
  });

  paint();
  return {
    main,
    paint,
    setCurrent(page, title = "") {
      current = page;
      paint();
      $("[data-top-title]", root).textContent = title;
      onScroll();
      const selected = $('[data-nav] [aria-current="page"]', root);
      if (selected?.offsetWidth) selected.scrollIntoView({ block: "nearest" });
    },
  };
}

export function showShortcuts() {
  const rows = [
    ["/", "Search the current table"], ["N", "Add a new record on this page"], ["G then D", "Go to Today"],
    ["U", "Undo, while the Undo message is showing"], ["?", "Show this list"], ["Esc", "Close a window or menu"],
  ];
  openModal({
    title: "Keyboard shortcuts", size: "sm",
    body: html`<div class="lines">${rows.map(([k, d]) => html`<div class="line"><span class="line-label">${d}</span><kbd class="badge">${k}</kbd></div>`)}</div>`,
  });
}
