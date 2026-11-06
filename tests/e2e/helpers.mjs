// Shared browser-test helpers. Every page visit should be wrapped in watchPage so that
// console errors, crashes and failed requests fail the test instead of going unnoticed.
import { expect } from "@playwright/test";

// Antivirus products on developer machines inject their own scripts into local pages.
// These never run in CI and aren't part of the app, so they are the only hosts ignored by default.
const MACHINE_NOISE = ["kaspersky-labs.com"];

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
  page.on("requestfailed", (r) => { if (!allowed(r.url())) report(`request failed: ${r.url()}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !allowed(r.url())) report(`HTTP ${r.status()}: ${r.url()}`); });
  page.on("request", (r) => { if (!isLocal(r.url()) && !allowed(r.url())) report(`third-party request: ${r.url()}`); });
  return problems;
}

/** Fails if the page scrolls sideways, which the design never allows. */
export async function expectNoHorizontalScroll(page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${client}px window`).toBeLessThanOrEqual(client);
}
