// Start-up: load the data, then show the app.
import { formatMoney } from "./core/money.js";
import { openDocs } from "./core/documents.js";
import { upcoming } from "./core/recurring.js";
import { createStore } from "./state/store.js";
import { $ } from "./ui/dom.js";
import { closeMenu } from "./ui/menu.js";
import { navigate, onRouteChange, parseHash } from "./ui/router.js";
import { renderRescue, showCrash } from "./ui/screens.js";
import { createShell, showShortcuts } from "./ui/shell.js";
import { watchSystemTheme } from "./ui/theme.js";
import { toast } from "./ui/toast.js";

import dashboard from "./pages/dashboard.js";
import recycleBin from "./pages/recycle-bin.js";
import styleguide from "./pages/styleguide.js";
import { placeholder } from "./pages/placeholder.js";

const PAGES = Object.fromEntries([
  dashboard, recycleBin, styleguide,
  placeholder("clients", "Clients", "building"), placeholder("invoices", "Invoices", "receipt"),
  placeholder("suppliers", "Suppliers", "truck"), placeholder("purchases", "Purchases", "cart"),
  placeholder("cashbook", "Cash book", "book"), placeholder("recurring", "Recurring", "repeat"), placeholder("banks", "Banks & loans", "bank"),
  placeholder("staff", "Staff", "users"), placeholder("attendance", "Attendance", "attendance"), placeholder("salary", "Salary sheet", "sheet"), placeholder("advances", "Advances", "wallet"),
  placeholder("stock", "Stock", "box"), placeholder("reports", "Reports", "chart"), placeholder("settings", "Settings", "settings"),
].map((p) => [p.id, p]));

const root = document.getElementById("app");
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const memory = new Map();
const store = createStore({
  storage: storage || { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) },
});

window.addEventListener("error", (e) => { if (e.error) showCrash(() => store.state && store.exportBackup()); });
window.addEventListener("unhandledrejection", () => showCrash(() => store.state && store.exportBackup()));

const ctx = {
  store,
  state: () => store.state,
  today: () => store.today(),
  money: (n, opts) => formatMoney(n, store.state.profile.currency, opts),
  navigate,
  actions: {},
  exitSample: () => { store.exitSample(); location.hash = "#/dashboard"; location.reload(); },
};

/** Counts shown beside menu items. */
function badges() {
  const s = store.state;
  const today = store.today();
  const overdue = openDocs(s, "receivable").filter((d) => d.docType === "invoice" && d.due && d.due < today).length;
  const due = upcoming(s, today).filter((u) => u.overdue || u.days <= 3).length;
  const out = {};
  if (overdue) out.invoices = { count: overdue, tone: "warning", title: "overdue invoices" };
  if (due) out.recurring = { count: due, tone: "warning", title: "payments due soon" };
  if (s.bin.length) out["recycle-bin"] = { count: s.bin.length, title: "items in the bin" };
  return out;
}

function quickAdd() {
  const add = ctx.actions;
  return [
    { label: "Sale or income", icon: "arrow-in", onSelect: () => add.income?.() ?? toast("Coming in a later milestone", { kind: "info" }) },
    { label: "Expense", icon: "arrow-out", onSelect: () => add.expense?.() ?? toast("Coming in a later milestone", { kind: "info" }) },
    { label: "Invoice", icon: "receipt", onSelect: () => add.invoice?.() ?? toast("Coming in a later milestone", { kind: "info" }) },
    { label: "Purchase", icon: "cart", onSelect: () => add.purchase?.() ?? toast("Coming in a later milestone", { kind: "info" }) },
  ];
}

function startApp() {
  const shell = createShell(root, ctx, { quickAdd, badges });

  function renderPage({ page, params }, { focus = true } = {}) {
    const def = PAGES[page] || PAGES.dashboard;
    shell.setCurrent(def.id);
    document.title = `${def.title} · Accounts Manager`;
    def.render(shell.main, ctx, params);
    if (focus) {
      window.scrollTo(0, 0);
      $("#page-title", shell.main)?.focus({ preventScroll: true });
    }
  }

  onRouteChange((route) => { closeMenu(); renderPage(route); });

  store.subscribe((_state, reason) => {
    if (reason === "quiet") { shell.paint(); return; }
    renderPage(parseHash(), { focus: false });
    if (store.lastSaveFailed) {
      toast("Couldn't save: this browser's storage may be full. Download a backup from Settings.", { kind: "error", duration: 10000 });
    }
  });

  window.addEventListener("storage", (e) => {
    if (e.key && store.syncFromOtherTab(e.key, e.newValue)) toast("Updated from another tab", { kind: "info" });
  });

  renderPage(parseHash());
}

// Keyboard shortcuts, ignored while typing.
let goPending = false;
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey || t.closest?.("input, select, textarea, dialog, [contenteditable]")) return;
  if (goPending) {
    goPending = false;
    if (e.key.toLowerCase() === "d") navigate("dashboard");
    return;
  }
  if (e.key === "?") { e.preventDefault(); showShortcuts(); }
  else if (e.key === "/") {
    const search = $("[data-table-search]");
    if (search) { e.preventDefault(); search.focus(); }
  } else if (e.key.toLowerCase() === "n") {
    const add = $("[data-add]");
    if (add) { e.preventDefault(); add.click(); }
  } else if (e.key.toLowerCase() === "g") goPending = true;
});

watchSystemTheme();

const result = store.boot();
if (result.status === "rescue") {
  renderRescue(root, result);
} else {
  startApp();
  if (storage && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
}
