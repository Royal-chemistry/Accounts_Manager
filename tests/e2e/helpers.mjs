// Shared browser-test helpers. Every page visit should be wrapped in watchPage so that
// console errors, crashes and failed requests fail the test instead of going unnoticed.
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { migrate } from "../../js/core/migrate.js";

// Antivirus products on developer machines inject their own scripts into local pages.
// These never run in CI and aren't part of the app, so they are the only hosts ignored by default.
const MACHINE_NOISE = ["kaspersky-labs.com"];

export const TODAY = "2026-11-07";

export const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
export const sampleV2 = () => {
  const s = migrate(fixture("v1-sample"), { today: TODAY }).state;
  s.profile.onboarded = true;
  return s;
};

/**
 * Records anything that went wrong on the page.
 * allowHosts permits named third-party hosts. ignore is a list of regexes for known, explained noise.
 */
export function watchPage(page, { allowHosts = [], ignore = [] } = {}) {
  const problems = [];
  const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };
  const isNoise = (text) => MACHINE_NOISE.some((h) => text.includes(h)) || ignore.some((r) => r.test(text));
  const isLocal = (url) => hostOf(url) === "localhost" || url.startsWith("data:") || url.startsWith("blob:");
  const allowed = (url) => allowHosts.some((h) => hostOf(url).endsWith(h));
  const report = (text) => { if (!isNoise(text)) problems.push(text); };
  page.on("console", (m) => { if (m.type() === "error") report(`console error: ${m.text()} (${m.location().url})`); });
  page.on("pageerror", (e) => report(`uncaught error: ${e.message}`));
  // A request cancelled because the page moved on isn't a failure.
  page.on("requestfailed", (r) => { if (!allowed(r.url()) && r.failure()?.errorText !== "net::ERR_ABORTED") report(`request failed: ${r.url()} (${r.failure()?.errorText})`); });
  page.on("response", (r) => { if (r.status() >= 400 && !allowed(r.url())) report(`HTTP ${r.status()}: ${r.url()}`); });
  page.on("request", (r) => { if (!isLocal(r.url()) && !allowed(r.url())) report(`third-party request: ${r.url()}`); });
  return problems;
}

/** Fails if the page scrolls sideways, which the design never allows. */
export async function expectNoHorizontalScroll(page, label = "") {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `${label} is ${scroll}px wide in a ${client}px window`).toBeLessThanOrEqual(client);
}

/** Fails on any WCAG AA problem axe can find. */
export async function expectAccessible(page, label = "") {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")} :: ${v.nodes[0].failureSummary?.split("\n")[1]?.trim() ?? ""}`);
  expect(summary, `${label} has accessibility problems`).toEqual([]);
}

/** Puts data in the browser before the app starts. Pass { v1 } or { data }. */
export async function seed(page, { v1, data, theme, raw = {} } = {}) {
  await page.addInitScript((payload) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    if (payload.v1) localStorage.setItem("accounts-manager:v1", payload.v1);
    if (payload.data) localStorage.setItem("accounts-manager:data", payload.data);
    if (payload.theme) localStorage.setItem("accounts-manager:theme", payload.theme);
    for (const [k, v] of Object.entries(payload.raw)) localStorage.setItem(k, v);
  }, { v1: v1 && JSON.stringify(v1), data: data && JSON.stringify(data), theme, raw });
}

/** Reads the app's saved data. */
export const savedData = (page, key = "accounts-manager:data") => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

export const ALL_PAGES = ["dashboard", "clients", "invoices", "suppliers", "purchases", "cashbook", "recurring", "banks", "staff", "attendance", "salary", "advances", "stock", "reports", "recycle-bin", "settings", "styleguide"];
