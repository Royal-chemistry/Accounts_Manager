// Lets the app open without a connection. It always tries the network first, so anyone
// online gets the latest code, and it only uses the saved copy when the network fails.
// tests/unit/static.test.mjs checks this list against the files on disk.
const CACHE = "accounts-manager-v2";
const FILES = [
  "./",
  "index.html",
  "assets/favicon.svg",
  "assets/fonts/inter-currency.woff2",
  "assets/fonts/inter-latin.woff2",
  "css/base.css",
  "css/components.css",
  "css/layout.css",
  "css/pages.css",
  "css/print.css",
  "css/tokens.css",
  "js/core/bin.js",
  "js/core/csv.js",
  "js/core/dates.js",
  "js/core/documents.js",
  "js/core/ids.js",
  "js/core/ledger.js",
  "js/core/migrate.js",
  "js/core/money.js",
  "js/core/payroll.js",
  "js/core/presets.js",
  "js/core/recurring.js",
  "js/core/reports.js",
  "js/core/sample.js",
  "js/core/schema.js",
  "js/core/stock.js",
  "js/core/validate.js",
  "js/main.js",
  "js/pages/_common.js",
  "js/pages/_lines.js",
  "js/pages/_money.js",
  "js/pages/advances.js",
  "js/pages/attendance.js",
  "js/pages/banks.js",
  "js/pages/cashbook.js",
  "js/pages/dashboard.js",
  "js/pages/invoices.js",
  "js/pages/onboarding.js",
  "js/pages/parties.js",
  "js/pages/purchases.js",
  "js/pages/recurring.js",
  "js/pages/recycle-bin.js",
  "js/pages/reports.js",
  "js/pages/salary.js",
  "js/pages/settings.js",
  "js/pages/staff.js",
  "js/pages/stock.js",
  "js/pages/styleguide.js",
  "js/state/store.js",
  "js/theme-init.js",
  "js/ui/chart.js",
  "js/ui/confirm-delete.js",
  "js/ui/dom.js",
  "js/ui/form.js",
  "js/ui/icons.js",
  "js/ui/logo-field.js",
  "js/ui/menu.js",
  "js/ui/modal.js",
  "js/ui/month-picker.js",
  "js/ui/payment-field.js",
  "js/ui/print.js",
  "js/ui/router.js",
  "js/ui/screens.js",
  "js/ui/shell.js",
  "js/ui/table.js",
  "js/ui/theme.js",
  "js/ui/toast.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Other sites can share this address (all of a GitHub user's project pages do), so only our own old copies go.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("accounts-manager-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(request);
        if (saved) return saved;
        if (request.mode === "navigate") return cache.match("index.html");
        return Response.error();
      }),
  );
});
