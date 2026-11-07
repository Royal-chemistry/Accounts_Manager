// The welcome screen for new users, and a one-time, skippable profile step for people upgrading.
import { GST_STATES, gstinError, phoneError } from "../core/validate.js";
import { CURRENCIES } from "../core/money.js";
import { MONTH_NAMES } from "../core/dates.js";
import { BUSINESS_TYPES, mergeCategories, presetFor } from "../core/presets.js";
import { stateFromGstin } from "../core/documents.js";
import { sample } from "../core/sample.js";
import { $, downloadFile, html, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { mountForm } from "../ui/form.js";
import { logoField } from "../ui/logo-field.js";

export const typeOptions = () => [["", "Choose a type"], ...BUSINESS_TYPES.map((t) => [t.id, t.label])];
export const monthOptions = () => MONTH_NAMES.map((m, i) => [i + 1, m]);
export const currencyOptions = () => CURRENCIES.map((c) => [c.code, `${c.code}: ${c.name}`]);
export const stateOptions = () => [["", "Not set"], ...GST_STATES.map(([code, name]) => [code, `${code}: ${name}`])];

/** The business profile fields, shared with Settings. */
export const profileFields = ({ typeRequired = true } = {}) => [
  { k: "name", label: "Business name", required: true, full: true, placeholder: "e.g. Sunrise Bakery", autocomplete: "organization" },
  { k: "type", label: "Type of business", type: "select", required: typeRequired, options: typeOptions(), hint: typeRequired ? "This sets up your starting categories and stock units." : "Changing this adds that type's categories. Nothing is removed." },
  { k: "typeOther", label: "Describe your business", when: (v) => v.type === "other", placeholder: "e.g. Photo studio" },
  { k: "address", label: "Address", type: "textarea", rows: 2, full: true, hint: "Printed on invoices and payslips." },
  { k: "gstin", label: "GSTIN", placeholder: "e.g. 27AAPFU0939F1ZV", warn: (v) => gstinError(v), maxlength: 15 },
  { k: "phone", label: "Phone", type: "tel", validate: (v) => phoneError(v), autocomplete: "tel" },
  logoField(),
  { k: "fyStartMonth", label: "Financial year starts in", type: "select", options: monthOptions(), default: 4 },
  { k: "currency", label: "Currency", type: "select", options: currencyOptions(), default: "INR" },
];

/** Applies a saved profile form to the state, including the chosen type's categories. */
export function applyProfile(s, v, { seedModules }) {
  const gstin = String(v.gstin || "").trim().toUpperCase();
  const typeChanged = v.type !== s.profile.type;
  s.profile = {
    ...s.profile, name: v.name.trim(), type: v.type, typeOther: v.type === "other" ? (v.typeOther || "").trim() : "",
    address: v.address || "", gstin, stateCode: stateFromGstin(gstin) || s.profile.stateCode, phone: v.phone || "", logo: v.logo || "",
    fyStartMonth: Number(v.fyStartMonth) || 4, currency: v.currency || "INR", onboarded: true,
  };
  if (typeChanged || seedModules) {
    const preset = presetFor(v.type);
    s.categories = mergeCategories(s.categories, preset);
    if (seedModules) s.settings.modules.stock = preset.stock;
  }
}

export function renderOnboarding(root, ctx, { upgraded, oldDataText, onDone }) {
  const state = ctx.state();
  setHTML(root, html`
    <main class="screen">
      <div class="screen-card welcome">
        <div class="screen-brand">
          <img src="assets/favicon.svg" alt="">
          <div>
            <h1 id="page-title" tabindex="-1">${upgraded ? "Your accounts have been upgraded" : "Welcome to Accounts Manager"}</h1>
            <p class="muted">${upgraded ? "Everything you saved is here." : "Free accounts for your business. No sign-up, and your data stays in this browser."}</p>
          </div>
        </div>
        ${upgraded ? html`
          <div class="stack welcome-notice">
            <div class="banner banner-success">${icon("check-circle")}<p>We moved your records to the new version and compared every balance, invoice and pay figure. They all match, and your old data is still kept in this browser.</p></div>
            <div class="banner">${icon("info")}<div>
              <p><b>Your profit figure may look different.</b> It used to count GST as income and whole loan EMIs as expenses, and it left out unpaid invoices. It now counts sales when invoiced and costs when incurred. Reports can also show it on a cash basis. Your balances haven't changed.</p>
            </div></div>
            ${oldDataText ? html`<div><button type="button" class="btn" data-download-old>${icon("download")}Download a copy of your old data</button></div>` : ""}
            <hr>
            <h2>Complete your business profile</h2>
          </div>` : html`
          <div class="stack welcome-notice">
            <h2>Tell us about your business</h2>
          </div>`}
        <div data-profile-form></div>
      </div>
    </main>`);

  mountForm($("[data-profile-form]", root), {
    ctx,
    fields: profileFields(),
    values: { ...state.profile, fyStartMonth: state.profile.fyStartMonth, currency: state.profile.currency },
    submitLabel: upgraded ? "Save and continue" : "Get started",
    actions: upgraded
      ? html`<button type="button" class="btn btn-ghost" data-skip>Skip for now</button>`
      : html`<button type="button" class="btn" data-explore>Explore with sample data</button>`,
    onSubmit(v) {
      ctx.store.update((s) => { applyProfile(s, v, { seedModules: !upgraded }); }, "quiet");
      ctx.store.clearUpgradeNotice();
      onDone();
    },
  });

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-skip]")) {
      ctx.store.update((s) => { s.profile.onboarded = true; }, "quiet");
      ctx.store.clearUpgradeNotice();
      onDone();
    } else if (e.target.closest("[data-explore]")) {
      ctx.store.enterSample(sample(ctx.today()));
      onDone();
    } else if (e.target.closest("[data-download-old]")) {
      downloadFile("accounts-manager-old-data.json", oldDataText, "application/json");
    }
  });
  $("#page-title", root).focus({ preventScroll: true });
}
