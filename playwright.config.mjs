import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;
// Locally, reuse the Chrome already on the machine instead of downloading a browser.
const browser = CI ? {} : { channel: "chrome" };

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? "github" : "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
  },
  projects: [
    // User flows run on a desktop and a phone.
    { name: "desktop", testIgnore: /pages\.spec/, use: { ...browser, viewport: { width: 1440, height: 900 } } },
    { name: "phone", testIgnore: /pages\.spec/, use: { ...browser, viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
    // The page matrix sets its own sizes and themes.
    { name: "pages", testMatch: /pages\.spec/, use: { ...browser } },
  ],
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "http://localhost:4173/index.html",
    reuseExistingServer: !CI,
  },
});
