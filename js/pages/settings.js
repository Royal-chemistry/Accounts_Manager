// Settings: business profile, payroll, invoices, categories, modules and data safety.
import { monthLabel, formatDate, localToday } from "../core/dates.js";
import { divisorFor } from "../core/payroll.js";
import { BUSINESS_TYPES } from "../core/presets.js";
import { sample } from "../core/sample.js";
import { emailError } from "../core/validate.js";
import { summarize } from "../state/store.js";
import { $, downloadFile, html, on, pickFile, raw, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { mountForm } from "../ui/form.js";
import { askConfirm, askTyped } from "../ui/modal.js";
import { glassStrength, setGlassStrength, setTheme, themePreference, THEME_OPTIONS } from "../ui/theme.js";
import { toast } from "../ui/toast.js";
import { pageHead } from "./_common.js";
import { applyProfile, profileFields, stateOptions } from "./onboarding.js";

const TABS = [["profile", "Business"], ["payroll", "Payroll"], ["invoices", "Invoices & GST"], ["categories", "Categories"], ["modules", "Modules"], ["appearance", "Appearance"], ["data", "Your data"]];

function profileTab(host, ctx) {
  const s = ctx.state();
  mountForm(host, {
    ctx,
    fields: [
      ...profileFields({ typeRequired: false }),
      { k: "email", label: "Email", type: "email", validate: (v) => emailError(v) },
      { k: "stateCode", label: "GST state", type: "select", options: stateOptions(), hint: "Filled in from your GSTIN. Used to choose between IGST and CGST + SGST." },
    ],
    values: { ...s.profile },
    onSubmit(v) {
      const before = ctx.state().profile.type;
      ctx.store.update((state) => {
        applyProfile(state, v, { seedModules: false });
        state.profile.stateCode = v.stateCode || state.profile.stateCode;
        state.profile.email = v.email || "";
      });
      toast("Business details saved");
      if (before && v.type !== before) toast(`Added the ${BUSINESS_TYPES.find((t) => t.id === v.type)?.label} categories. Nothing was removed.`, { kind: "info" });
    },
  });
}

function payrollTab(host, ctx) {
  const pay = ctx.state().settings.pay;
  const month = ctx.state().settings.month;
  const example = (basis) => {
    const div = divisorFor(basis, month);
    return `In ${monthLabel(month)}, someone on ₹15,000 earns ₹${(15000 / div).toFixed(2)} a day.`;
  };
  const api = mountForm(host, {
    ctx,
    fields: [
      { k: "basis", label: "Pay basis", type: "select", options: [["calendar", "Salary ÷ days in that month"], ["30", "Salary ÷ 30"], ["26", "Salary ÷ 26 (6-day week)"]], full: true, hint: example(pay.basis) },
      { k: "extraRate", label: "Default extra shift rate", type: "money", allowZero: true },
      { k: "foodRate", label: "Default food rate per day", type: "money", allowZero: true },
      { k: "capAtFull", label: "Never pay more than the monthly salary for normal days", type: "checkbox", full: true },
      { k: "paidLeave", label: "Count leave marked on the attendance grid as paid", type: "checkbox", full: true },
      { k: "pf", label: "Deduct PF (12% of basic, on wages up to ₹15,000)", type: "checkbox", full: true },
      { k: "esi", label: "Deduct ESI (0.75% when gross is ₹21,000 or less)", type: "checkbox", full: true },
      { type: "note", k: "statutory", body: "Check these rates against your own registration and the current rules before relying on them." },
    ],
    values: { ...pay },
    onSubmit(v) { ctx.store.update((s) => { Object.assign(s.settings.pay, v); }); toast("Payroll settings saved"); },
  });
  host.addEventListener("change", (e) => {
    if (e.target.name === "basis") $("[data-field='basis'] .field-hint", host).textContent = example(api.values().basis);
  });
}

function invoicesTab(host, ctx) {
  const s = ctx.state();
  const banks = s.accounts.filter((a) => a.active !== false && a.kind !== "cash").map((a) => [a.id, a.name]);
  const cash = s.accounts.filter((a) => a.active !== false && a.kind === "cash").map((a) => [a.id, a.name]);
  mountForm(host, {
    ctx,
    fields: [
      { k: "prefix", label: "Invoice number prefix", placeholder: "INV-" },
      { k: "nextNo", label: "Next invoice number", type: "number", allowZero: false, required: true },
      { k: "gstRate", label: "Default GST rate (%)", type: "number", allowZero: true, max: 100 },
      { k: "dueDays", label: "Payment due after (days)", type: "number", allowZero: true },
      { k: "bankLine", label: "Bank details on invoices", full: true, placeholder: "A/c 0000, IFSC XXXX0000, UPI biz@upi" },
      { k: "terms", label: "Terms printed on invoices", type: "textarea", rows: 2, full: true },
      { type: "section", label: "Payment defaults" },
      { k: "cashAccountId", label: "Default cash account", type: "select", options: cash.length ? cash : [["", "No cash account"]] },
      { k: "upiAccountId", label: "UPI money goes to", type: "select", options: [["", "Choose each time"], ...banks], hint: "UPI payments land in a bank account, so this keeps its balance correct." },
    ],
    values: { ...s.settings.invoice, ...s.settings.defaults },
    onSubmit(v) {
      ctx.store.update((state) => {
        const { cashAccountId, upiAccountId, ...invoice } = v;
        Object.assign(state.settings.invoice, { prefix: invoice.prefix, nextNo: Number(invoice.nextNo) || 1, gstRate: Number(invoice.gstRate) || 0, dueDays: Number(invoice.dueDays) || 0, bankLine: invoice.bankLine, terms: invoice.terms });
        state.settings.defaults = { cashAccountId: cashAccountId || state.settings.defaults.cashAccountId, upiAccountId: upiAccountId || null };
      });
      toast("Invoice settings saved");
    },
  });
}

const CATEGORY_GROUPS = [
  ["expense", "Expense categories", "New Expense"],
  ["income", "Income categories", "New Income"],
  ["units", "Stock units", "e.g. box"],
  ["stock", "Stock categories", "e.g. Packaging"],
];

function categoriesTab(host, ctx) {
  const paint = () => {
    const c = ctx.state().categories;
    setHTML(host, html`
      <div class="stack">
        <p class="muted">These appear as suggestions when you add entries. Removing one doesn't change anything you've already recorded.</p>
        ${CATEGORY_GROUPS.map(([key, label]) => html`
          <section class="stack-sm">
            <h2>${label}</h2>
            <ul class="tags" aria-label="${label}">
              ${(c[key] || []).map((name) => html`<li class="tag"><span>${name}</span><button type="button" class="tag-x" data-remove="${key}" data-name="${name}" aria-label="Remove ${name}">${icon("x", { cls: "icon-sm" })}</button></li>`)}
            </ul>
            <div class="row">
              <label class="sr-only" for="add-${key}">Add to ${label}</label>
              <input class="input add-input" id="add-${key}" data-add-input="${key}" placeholder="Add a new one" autocomplete="off">
              <button type="button" class="btn" data-add-cat="${key}">Add</button>
            </div>
          </section>`)}
      </div>`);
  };
  const add = (key) => {
    const input = $(`[data-add-input="${key}"]`, host);
    const name = input.value.trim();
    if (!name) return;
    if ((ctx.state().categories[key] || []).some((x) => x.toLowerCase() === name.toLowerCase())) { toast(`${name} is already there`, { kind: "info" }); return; }
    ctx.store.update((s) => { s.categories[key] = [...(s.categories[key] || []), name]; }, "quiet");
    paint();
    $(`[data-add-input="${key}"]`, host).focus();
  };
  on(host, "click", "[data-add-cat]", (e, b) => add(b.dataset.addCat));
  on(host, "keydown", "[data-add-input]", (e, el) => { if (e.key === "Enter") { e.preventDefault(); add(el.dataset.addInput); } });
  on(host, "click", "[data-remove]", (e, b) => {
    ctx.store.update((s) => { s.categories[b.dataset.remove] = s.categories[b.dataset.remove].filter((x) => x !== b.dataset.name); }, "quiet");
    paint();
    $(`[data-add-input="${b.dataset.remove}"]`, host).focus();
  });
  paint();
}

function modulesTab(host, ctx) {
  const m = ctx.state().settings.modules;
  setHTML(host, html`
    <section class="stack-sm">
      <h2>Modules</h2>
      <p class="muted">Turn off what you don't need. Anything already recorded is kept and comes back if you turn it on again.</p>
      <label class="check"><input type="checkbox" data-module="stock" ${m.stock ? raw("checked") : ""}><span class="check-label">Stock and inventory</span></label>
      <label class="check"><input type="checkbox" data-module="payroll" ${m.payroll !== false ? raw("checked") : ""}><span class="check-label">Staff and payroll</span></label>
      <label class="check"><input type="checkbox" data-module="gst" ${m.gst !== false ? raw("checked") : ""}><span class="check-label">GST on invoices and reports</span></label>
    </section>`);
  on(host, "change", "[data-module]", (e, el) => {
    ctx.store.update((s) => { s.settings.modules[el.dataset.module] = el.checked; }, "quiet");
    toast(`${el.closest("label").textContent.trim()} is now ${el.checked ? "on" : "off"}`);
  });
}

function appearanceTab(host) {
  const pref = themePreference();
  const forcedSolid = window.matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more)").matches;
  setHTML(host, html`
    <div class="stack">
      <section class="stack-sm">
        <h2>Theme</h2>
        <div class="seg" role="radiogroup" aria-label="Colour theme">
          ${THEME_OPTIONS.map((o) => html`<label><input type="radio" name="theme" value="${o.id}" ${o.id === pref ? raw("checked") : ""}><span>${icon(o.icon, { cls: "icon-sm" })}${o.label}</span></label>`)}
        </div>
      </section>
      <hr>
      <section class="stack-sm glass-setting">
        <h2><label for="glass-strength">Glass</label></h2>
        <p class="muted">How see-through the menus and floating controls are. Your figures always stay on solid backgrounds.</p>
        <input type="range" class="range" id="glass-strength" data-glass min="0" max="1" step="0.05" value="${glassStrength()}" aria-describedby="glass-ends" ${forcedSolid ? raw("disabled") : ""}>
        <div class="range-ends small muted" id="glass-ends"><span>Most transparent</span><span>Most tinted</span></div>
        ${forcedSolid ? html`<p class="small muted">Your device is set to reduce transparency, so the glass stays solid.</p>` : ""}
      </section>
    </div>`);
  on(host, "change", 'input[name="theme"]', (e, el) => setTheme(el.value));
  on(host, "input", "[data-glass]", (e, el) => setGlassStrength(el.value));
}

function summaryLines(summary) {
  const c = summary.counts;
  const parts = [[c.staff, "staff"], [c.clients, "clients"], [c.suppliers, "suppliers"], [c.invoices, "invoices"], [c.purchases, "purchases"], [c.transactions, "cash book entries"], [c.accounts, "accounts"], [c.items, "stock items"]];
  return parts.filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(", ") || "no records";
}

function dataTab(host, ctx, rerender) {
  const usage = ctx.store.usage();
  const safety = ctx.store.safetyCopy();
  const last = ctx.state().settings.lastBackupAt;
  setHTML(host, html`
    <div class="stack">
      <div class="banner">${icon("shield")}<p>Everything is saved in this browser on this device, and nothing is sent anywhere. Clearing your browser's data removes it, so keep a backup somewhere safe.</p></div>
      <section class="stack-sm">
        <h2>Backup</h2>
        <p class="muted">${last ? `Last backup: ${formatDate(localToday(new Date(last)))}.` : "You haven't made a backup yet."} A backup file can move your data to another device too.</p>
        <div class="row">
          <button type="button" class="btn btn-primary" data-backup>${icon("download")}Download backup</button>
          <button type="button" class="btn" data-restore>${icon("upload")}Restore from a backup</button>
        </div>
      </section>
      ${safety ? html`
        <section class="stack-sm">
          <h2>Bring back replaced data</h2>
          <p class="muted">A copy of your data was kept on ${formatDate(localToday(new Date(safety.savedAt)))}, just before "${safety.reason}".</p>
          <div><button type="button" class="btn" data-bring-back>${icon("undo")}Bring it back</button></div>
        </section>` : ""}
      <section class="stack-sm">
        <h2>Storage</h2>
        <label class="small muted" for="storage-meter">${usage.percent}% of about ${Math.round(usage.limit / 1024 / 1024)} MB used in this browser</label>
        <progress id="storage-meter" class="meter" max="100" value="${usage.percent}"></progress>
      </section>
      <section class="stack-sm">
        <h2>Sample data</h2>
        <p class="muted">Explore the app with a made-up business. Your real records aren't touched, and you can leave at any time.</p>
        <div>${ctx.store.isSample
          ? html`<button type="button" class="btn" data-exit-sample>Exit sample data</button>`
          : html`<button type="button" class="btn" data-sample>Explore sample data</button>`}</div>
      </section>
      <hr>
      <section class="stack-sm">
        <h2>Clear everything</h2>
        <p class="muted">Removes all your records from this browser.</p>
        <div><button type="button" class="btn btn-danger" data-clear>${icon("trash")}Clear all data</button></div>
      </section>
    </div>`);

  on(host, "click", "[data-backup]", () => {
    downloadFile(`accounts-manager-backup-${ctx.today()}.json`, ctx.store.exportBackup(), "application/json");
    ctx.store.markBackedUp();
    toast("Backup downloaded. Keep it somewhere safe");
  });
  on(host, "click", "[data-restore]", async () => {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    let preview;
    try { preview = ctx.store.previewBackup(await file.text()); }
    catch (err) { toast(err.message, { kind: "error", duration: 8000 }); return; }
    const ok = await askTyped({
      title: "Replace your data with this backup?",
      body: html`
        <div class="stack-sm">
          <p><b>This backup${preview.summary.name ? `, ${preview.summary.name}` : ""}:</b> ${summaryLines(preview.summary)}.${preview.summary.exportedAt ? ` Saved ${formatDate(localToday(new Date(preview.summary.exportedAt)))}.` : ""}</p>
          <p><b>Your current data:</b> ${summaryLines(summarize(ctx.state()))}. It will be replaced, and a safety copy is kept in this browser.</p>
        </div>`,
      word: "RESTORE", confirmLabel: "Restore backup",
    });
    if (!ok) return;
    ctx.store.replaceWith(preview.state, "Restore from a backup");
    toast("Backup restored", { action: { label: "Undo", onClick: () => { ctx.store.restoreSafetyCopy(); toast("Previous data brought back"); } }, duration: 8000 });
    rerender();
  });
  on(host, "click", "[data-bring-back]", async () => {
    const ok = await askConfirm({ title: "Bring back the saved copy?", body: html`<p>This replaces your current data with the copy saved before "${safety.reason}".</p>`, confirmLabel: "Bring it back" });
    if (ok) { ctx.store.restoreSafetyCopy(); toast("Previous data brought back"); rerender(); }
  });
  on(host, "click", "[data-sample]", () => { ctx.store.enterSample(sample(ctx.today())); ctx.navigate("dashboard"); toast("Sample data loaded. Your real records aren't touched"); });
  on(host, "click", "[data-exit-sample]", () => ctx.exitSample());
  on(host, "click", "[data-clear]", async () => {
    const ok = await askTyped({
      title: "Clear all data?",
      body: html`<p>This removes every record from this browser, including the Recycle Bin. A safety copy is kept here until you replace your data again. Download a backup first if you might need it.</p>`,
      word: "DELETE", confirmLabel: "Clear all data",
    });
    if (!ok) return;
    ctx.store.clearAll();
    location.hash = "#/dashboard";
    location.reload();
  });
}

export default {
  id: "settings",
  title: "Settings",
  render(root, ctx, params) {
    const tab = TABS.some(([id]) => id === params[0]) ? params[0] : "profile";
    setHTML(root, html`
      <div class="page">
        ${pageHead({ title: "Settings", sub: "Your business details and how the app works." })}
        <nav class="tabs" aria-label="Settings sections">
          ${TABS.map(([id, label]) => html`<a class="tab" href="#/settings/${id}" ${id === tab ? raw('aria-current="page"') : ""}>${label}</a>`)}
        </nav>
        <section class="card" data-tab-body></section>
      </div>`);
    const host = $("[data-tab-body]", root);
    const render = { profile: profileTab, payroll: payrollTab, invoices: invoicesTab, categories: categoriesTab, modules: modulesTab, appearance: appearanceTab, data: dataTab }[tab];
    render(host, ctx, () => this.render(root, ctx, params));
  },
};
