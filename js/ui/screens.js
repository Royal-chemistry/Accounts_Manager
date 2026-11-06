// Full-page screens for when the app can't run normally. These never change the user's data.
import { downloadFile, html, setHTML, toElement } from "./dom.js";
import { icon } from "./icons.js";

const ISSUES = "https://github.com/Royal-chemistry/Accounts_Manager/issues";

/** Shown when saved data can't be opened or fails the upgrade check. The original stays exactly where it is. */
export function renderRescue(root, { reason, raw: rawText }) {
  setHTML(root, html`
    <main class="screen">
      <div class="screen-card">
        <div class="screen-brand"><img src="assets/favicon.svg" alt=""><h1>Your data is safe</h1></div>
        <div class="stack">
          <p>Accounts Manager couldn't open your saved data, so it hasn't changed anything.</p>
          <div class="banner banner-warning">${icon("alert")}<p>${reason}</p></div>
          <p>Please download a copy of your data now to keep it safe. You can then reload the page or report the problem, and nothing will be overwritten.</p>
        </div>
        <div class="screen-actions">
          <button type="button" class="btn btn-primary" data-download>${icon("download")}Download my data</button>
          <button type="button" class="btn" data-reload>Reload</button>
          <a class="btn" href="${ISSUES}" target="_blank" rel="noopener">Report a problem</a>
        </div>
      </div>
    </main>`);
  root.querySelector("[data-download]").addEventListener("click", () => downloadFile("accounts-manager-rescue.json", rawText, "application/json"));
  root.querySelector("[data-reload]").addEventListener("click", () => location.reload());
}

/** Shown if the app hits an unexpected error. Saved data isn't affected. */
export function showCrash(getBackup) {
  if (document.querySelector(".crash")) return;
  const el = toElement(html`
    <main class="screen crash">
      <div class="screen-card">
        <div class="screen-brand"><img src="assets/favicon.svg" alt=""><h1>Something went wrong</h1></div>
        <p>This page hit an unexpected problem. Everything saved before this moment is safe in your browser.</p>
        <div class="screen-actions">
          <button type="button" class="btn btn-primary" data-reload>Reload the app</button>
          <button type="button" class="btn" data-download>${icon("download")}Download a backup</button>
          <a class="btn" href="${ISSUES}" target="_blank" rel="noopener">Report a problem</a>
        </div>
      </div>
    </main>`);
  document.body.appendChild(el);
  el.querySelector("[data-reload]").addEventListener("click", () => location.reload());
  el.querySelector("[data-download]").addEventListener("click", () => {
    const text = getBackup?.();
    if (text) downloadFile("accounts-manager-backup.json", text, "application/json");
  });
  el.querySelector("[data-reload]").focus();
}
