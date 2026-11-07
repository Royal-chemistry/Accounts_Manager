// Makes the screenshots and demo GIF in docs/images, using the sample business.
// Needs ffmpeg on the PATH for the GIF. Run with: node tests/tools/make-readme-media.mjs
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { sample } from "../../js/core/sample.js";

const OUT = "docs/images";
const BASE = "http://localhost:4173";
const TODAY = "2026-11-07";
const browserOptions = process.env.CI ? {} : { channel: "chrome" };

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ["tests/e2e/server.mjs"], { stdio: "ignore" });
await new Promise((resolve) => { setTimeout(resolve, 800); });

function data() {
  const s = sample(TODAY);
  s.settings.lastBackupAt = `${TODAY}T04:00:00.000Z`; // keeps the reminder out of the pictures
  return s;
}

async function open(browser, { width, height, scale = 1.5, theme = "light", phone = false, video = null }) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: scale, serviceWorkers: "block", timezoneId: "Asia/Kolkata", locale: "en-IN",
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
    ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}),
  });
  await context.clock.setFixedTime(new Date(`${TODAY}T10:30:00+05:30`));
  await context.addInitScript(([state, chosen]) => {
    window.print = () => {};
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    localStorage.setItem("accounts-manager:data", state);
    localStorage.setItem("accounts-manager:theme", chosen);
  }, [JSON.stringify(data()), theme]);
  const page = await context.newPage();
  return { context, page };
}

const goTo = async (page, route) => {
  await page.goto(`${BASE}/index.html#/${route}`);
  await page.locator("#page-title").waitFor();
  await page.evaluate(() => document.fonts.ready);
};

async function screenshots(browser) {
  for (const theme of ["light", "dark"]) {
    const { context, page } = await open(browser, { width: 1440, height: 1000, theme });
    await goTo(page, "dashboard");
    await page.locator(".chart").waitFor();
    await page.screenshot({ path: `${OUT}/dashboard-${theme}.png` });
    await context.close();
  }

  const { context, page } = await open(browser, { width: 1280, height: 800 });
  await goTo(page, "reports/profit");
  await page.getByLabel("Period").selectOption("this-fy");
  await page.locator(".chart").waitFor();
  await page.screenshot({ path: `${OUT}/reports.png` });
  await page.getByLabel("Period").selectOption("last-month");

  await goTo(page, "salary");
  await page.screenshot({ path: `${OUT}/salary.png` });

  await goTo(page, "stock");
  await page.screenshot({ path: `${OUT}/stock.png` });

  await goTo(page, "invoices");
  await page.locator("tbody tr", { hasText: "ST-002" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.locator("dialog").waitFor();
  await page.screenshot({ path: `${OUT}/delete.png` });
  await page.locator("dialog").getByRole("button", { name: "Cancel" }).click();

  await page.locator("tbody tr", { hasText: "ST-004" }).getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Print" }).click();
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => { document.getElementById("print-root").style.padding = "32px"; });
  await page.setViewportSize({ width: 794, height: 660 });
  await page.screenshot({ path: `${OUT}/invoice.png` });
  await context.close();

  const phone = await open(browser, { width: 390, height: 800, scale: 2, phone: true });
  await goTo(phone.page, "dashboard");
  await phone.page.locator(".chart").waitFor();
  await phone.page.screenshot({ path: `${OUT}/phone.png` });
  await phone.context.close();
}

// Playwright's browser has no visible pointer, and the demo needs one to be followed.
const pointer = () => {
  window.addEventListener("DOMContentLoaded", () => {
    const dot = document.createElement("div");
    dot.popover = "manual";
    Object.assign(dot.style, { position: "fixed", inset: "auto", margin: "0", padding: "0", border: "2px solid #fff", width: "18px", height: "18px", borderRadius: "50%", background: "rgba(20, 24, 31, 0.75)", pointerEvents: "none", overflow: "visible", transition: "transform 90ms" });
    document.body.appendChild(dot);
    dot.showPopover();
    window.addEventListener("mousemove", (e) => {
      dot.style.left = `${e.clientX - 9}px`;
      dot.style.top = `${e.clientY - 9}px`;
      // Reopening it keeps it above any window that has opened since.
      dot.hidePopover();
      dot.showPopover();
    }, true);
    window.addEventListener("mousedown", () => { dot.style.transform = "scale(0.7)"; }, true);
    window.addEventListener("mouseup", () => { dot.style.transform = "none"; }, true);
  });
};

async function demo(browser) {
  const dir = join(tmpdir(), `am-demo-${Date.now()}`);
  const { context, page } = await open(browser, { width: 1180, height: 760, scale: 1, video: dir });
  await context.addInitScript(pointer);
  const wait = (ms) => page.waitForTimeout(ms);
  const click = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await wait(180);
    await page.mouse.down();
    await page.mouse.up();
  };
  const type = async (locator, text) => {
    await click(locator);
    await locator.selectText().catch(() => {});
    await locator.pressSequentially(text, { delay: 55 });
    await wait(150);
  };

  await goTo(page, "dashboard");
  await page.locator(".chart").waitFor();
  await page.mouse.move(600, 300);
  await wait(1500);

  await click(page.getByRole("link", { name: "Invoices" }).first());
  await page.locator("h1", { hasText: "Invoices" }).waitFor();
  await wait(800);
  await click(page.getByRole("button", { name: "New invoice" }).first());
  const d = page.locator("dialog");
  await d.waitFor();
  await wait(500);
  await d.getByLabel(/^Client/).selectOption({ label: "Coastal Chemicals Pvt Ltd" });
  await wait(400);
  await type(d.getByLabel("Description").first(), "Packing material");
  await type(d.getByLabel("Quantity").first(), "200");
  await type(d.getByLabel("Rate", { exact: true }).first(), "95");
  await wait(900);
  await click(d.getByRole("button", { name: "Create invoice" }));
  await page.getByText(/created/).waitFor();
  await wait(1200);

  const row = page.locator("tbody tr").first();
  await click(row.getByRole("button", { name: "Receive" }));
  await d.waitFor();
  await wait(500);
  await type(d.getByLabel(/^Amount received/), "10000");
  await click(d.locator(".seg label", { hasText: "Bank" }));
  await wait(700);
  await click(d.getByRole("button", { name: "Save payment" }));
  await page.getByText(/still to come/).waitFor();
  await wait(1400);

  await click(page.getByRole("link", { name: "Dashboard" }).first());
  await page.locator(".chart").waitFor();
  await wait(1800);

  const video = page.video();
  await context.close();
  const webm = await video.path();
  const filter = "fps=11,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-vf", filter, `${OUT}/demo.gif`]);
  rmSync(dir, { recursive: true, force: true });
}

const browser = await chromium.launch(browserOptions);
try {
  await screenshots(browser);
  await demo(browser);
} finally {
  await browser.close();
  server.kill();
}
console.log(`Made ${readdirSync(OUT).length} files in ${OUT}`);
