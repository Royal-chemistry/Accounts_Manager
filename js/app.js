import { computePay, totals, inr, inWords, parseCSV, toCSV, daysInMonth, divisorFor } from "./calc.js";

const KEY = "dutypay:v1";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function thisMonth() {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() - 1); // salary is usually for last month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const blank = () => ({
  settings: { agency: "", address: "", month: thisMonth(), basis: "calendar", capAtFull: false, pf: false, esi: false, specialRate: 800, messRate: 140 },
  guards: [],
  entries: {},
});

let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings && Array.isArray(s.guards)) return { ...blank(), ...s, settings: { ...blank().settings, ...s.settings } };
  } catch { /* private mode or bad data */ }
  return blank();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast("Couldn't save in this browser — use Backup."); }
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function entryFor(gid) {
  const m = state.settings.month;
  state.entries[m] ??= {};
  state.entries[m][gid] ??= { duties: "", specialDuties: "", specialRate: state.settings.specialRate, bonus: "", advance: "", messDays: "", messRate: state.settings.messRate, uniform: "", other: "" };
  return state.entries[m][gid];
}

function results() {
  return state.guards.map((g) => ({ g, e: entryFor(g.id), r: computePay(g, entryFor(g.id), state.settings) }));
}

/* ---------------- tabs ---------------- */
function showTab(name) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (name === "register") renderRegister();
  if (name === "sheet") renderSheet();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$$(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------------- settings ---------------- */
const S = {
  agency: "#s-agency", address: "#s-address", month: "#s-month", basis: "#s-basis",
  specialRate: "#s-special", messRate: "#s-mess", capAtFull: "#s-cap", pf: "#s-pf", esi: "#s-esi",
};
function renderSettings() {
  for (const [k, sel] of Object.entries(S)) {
    const el = $(sel);
    if (el.type === "checkbox") el.checked = !!state.settings[k];
    else el.value = state.settings[k] ?? "";
  }
  const st = state.settings;
  const div = divisorFor(st.basis, st.month);
  $("#basis-hint").textContent =
    `${monthLabel(st.month)} has ${daysInMonth(st.month)} days. A guard on ₹15,000 earns ₹${(15000 / div).toFixed(2)} per duty` +
    (st.basis === "calendar" ? ", so 30 duties pays " + inr(Math.round(15000 / div * 30)) + "." : ".");
}
for (const [k, sel] of Object.entries(S)) {
  $(sel).addEventListener("input", (ev) => {
    const el = ev.target;
    state.settings[k] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
    if (k === "month" && !el.value) return;
    save(); renderSettings(); updateHeader();
  });
}

/* ---------------- guards ---------------- */
const GUARD_FIELDS = [
  ["name", "text", "Full name"], ["site", "text", "Site / client"], ["salary", "number", "15000"],
  ["bank", "text", "Bank"], ["account", "text", "Account no."], ["ifsc", "text", "IFSC"], ["upi", "text", "name@upi"], ["phone", "tel", "Phone"],
];
function renderGuards() {
  const tb = $("#guards-table tbody");
  tb.innerHTML = state.guards.map((g) => `<tr data-id="${g.id}">${GUARD_FIELDS.map(([f, type, ph]) =>
    `<td><input type="${type}" data-f="${f}" value="${esc(g[f])}" placeholder="${ph}" aria-label="${f}"${type === "number" ? ' min="0" step="100"' : ""}></td>`).join("")}
    <td><button class="icon-btn" data-del="${g.id}" aria-label="Remove ${esc(g.name)}" title="Remove">✕</button></td></tr>`).join("");
  $("#guards-empty").style.display = state.guards.length ? "none" : "block";
  $("#guards-table").style.display = state.guards.length ? "" : "none";
  updateHeader();
}
$("#guards-table").addEventListener("input", (ev) => {
  const tr = ev.target.closest("tr"); if (!tr) return;
  const g = state.guards.find((x) => x.id === tr.dataset.id);
  const f = ev.target.dataset.f;
  g[f] = ev.target.type === "number" ? Number(ev.target.value) : ev.target.value;
  save(); updateHeader();
});
$("#guards-table").addEventListener("click", (ev) => {
  const id = ev.target.dataset?.del; if (!id) return;
  const g = state.guards.find((x) => x.id === id);
  if (!confirm(`Remove ${g.name || "this guard"}?`)) return;
  state.guards = state.guards.filter((x) => x.id !== id);
  save(); renderGuards();
});
$("#btn-add-guard").addEventListener("click", () => {
  state.guards.push({ id: uid(), name: "", site: state.guards.at(-1)?.site ?? "", salary: state.guards.at(-1)?.salary ?? 15000, bank: "", account: "", ifsc: "", upi: "", phone: "" });
  save(); renderGuards();
  $("#guards-table tbody tr:last-child input")?.focus();
});
$("#btn-guards-template").addEventListener("click", () => {
  download("guards-template.csv", toCSV([["Name", "Site", "Salary", "Bank", "Account", "IFSC", "UPI", "Phone"],
    ["Rajesh K", "Harbour View Hotel", 15500, "State Bank of India", "00000000000", "SBIN0000000", "", "9800000000"]]));
});
$("#file-guards").addEventListener("change", async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text());
  let added = 0;
  for (const r of rows) {
    const name = r.name || r.full_name || r.guard || r.employee;
    if (!name) continue;
    state.guards.push({
      id: uid(), name, site: r.site || r.client || "", salary: Number(String(r.salary || r.monthly_salary || r.basic || 0).replace(/[^0-9.]/g, "")) || 0,
      bank: r.bank || r.bank_name || "", account: r.account || r.account_no || r.account_number || "", ifsc: (r.ifsc || "").toUpperCase(),
      upi: r.upi || r.upi_id || "", phone: r.phone || r.mobile || "",
    });
    added++;
  }
  ev.target.value = "";
  save(); renderGuards();
  toast(added ? `Imported ${added} guard${added > 1 ? "s" : ""}` : "No rows found — check the CSV has a Name column");
});

/* ---------------- register ---------------- */
const E_FIELDS = ["duties", "specialDuties", "specialRate", "bonus", "advance", "messDays", "messRate", "uniform", "other"];
function sites() { return [...new Set(state.guards.map((g) => g.site).filter(Boolean))].sort(); }
function renderRegister() {
  $("#reg-month").textContent = monthLabel(state.settings.month);
  const sel = $("#reg-site"), cur = sel.value;
  sel.innerHTML = `<option value="">All sites</option>` + sites().map((s) => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");
  const list = state.guards.filter((g) => !sel.value || g.site === sel.value);
  $("#reg-table tbody").innerHTML = list.map((g) => {
    const e = entryFor(g.id); const r = computePay(g, e, state.settings);
    return `<tr data-id="${g.id}"><td class="name">${esc(g.name || "(no name)")}<small>${esc(g.site)} · ${inr(g.salary || 0)}</small></td>
      ${E_FIELDS.map((f) => `<td><input type="number" min="0" step="${f === "duties" ? "0.5" : "1"}" data-f="${f}" value="${esc(e[f])}" aria-label="${f} for ${esc(g.name)}"></td>`).join("")}
      <td class="net${r.net < 0 ? " neg" : ""}">${inr(r.net)}</td></tr>`;
  }).join("");
  $("#reg-empty").style.display = state.guards.length ? "none" : "block";
  $("#reg-table").style.display = state.guards.length ? "" : "none";
}
$("#reg-site").addEventListener("change", renderRegister);
$("#reg-table").addEventListener("input", (ev) => {
  const tr = ev.target.closest("tr"); if (!tr) return;
  const g = state.guards.find((x) => x.id === tr.dataset.id);
  const e = entryFor(g.id);
  e[ev.target.dataset.f] = ev.target.value === "" ? "" : Number(ev.target.value);
  save();
  const r = computePay(g, e, state.settings);
  const td = tr.querySelector("td.net");
  td.textContent = inr(r.net); td.classList.toggle("neg", r.net < 0);
});
$("#btn-fill-full").addEventListener("click", () => {
  const n = state.settings.basis === "calendar" ? daysInMonth(state.settings.month) : Number(state.settings.basis);
  const site = $("#reg-site").value;
  let c = 0;
  for (const g of state.guards) {
    if (site && g.site !== site) continue;
    const e = entryFor(g.id);
    if (e.duties === "" || e.duties == null) { e.duties = n; c++; }
  }
  save(); renderRegister();
  toast(c ? `Filled ${n} duties for ${c} guard${c > 1 ? "s" : ""} (empty rows only)` : "Every row already has duties");
});

/* ---------------- sheet ---------------- */
function renderSheet() {
  const st = state.settings;
  $("#sheet-month").textContent = monthLabel(st.month);
  const rs = results();
  const t = totals(rs.map((x) => x.r));
  const cols = (r) => [r.duties, inr(r.base), inr(r.special), inr(r.bonus), inr(r.gross), inr(r.advance), inr(r.mess), inr(r.uniform), inr(r.other), inr(r.pf), inr(r.esi)];
  $("#sheet-table tbody").innerHTML = rs.map(({ g, r }) => `<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.site)}</td>
    ${cols(r).map((v) => `<td class="n">${v}</td>`).join("")}<td class="net${r.net < 0 ? " neg" : ""}">${inr(r.net)}</td></tr>`).join("") ||
    `<tr><td colspan="14" class="empty">Add guards and fill the duty register first.</td></tr>`;
  $("#sheet-table tfoot").innerHTML = rs.length ? `<tr><td>Total</td><td>${rs.length} guards</td>${cols(t).map((v) => `<td class="n">${v}</td>`).join("")}<td class="net">${inr(t.net)}</td></tr>` : "";
  const owe = rs.filter((x) => x.r.net < 0);
  $("#sheet-note").textContent = owe.length
    ? `${owe.map((x) => x.g.name).join(", ")} ${owe.length > 1 ? "owe" : "owes"} the agency money this month (deductions are more than pay). They're left out of the payout list.`
    : `Pay basis: ${st.basis === "calendar" ? `salary ÷ ${daysInMonth(st.month)} days` : `salary ÷ ${st.basis}`} × duties.`;
  const payable = rs.filter((x) => x.r.net > 0).reduce((s, x) => s + x.r.net, 0);
  $("#stats").innerHTML = [
    ["Guards", rs.length], ["Total duties", t.duties], ["Gross pay", inr(t.gross)], ["Deductions", inr(t.deductions)], ["To pay out", inr(payable)],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
  const by = {};
  for (const { g, r } of rs) {
    const k = g.site || "No site";
    by[k] ??= { n: 0, duties: 0, net: 0, gross: 0 };
    by[k].n++; by[k].duties += r.duties; by[k].net += r.net; by[k].gross += r.gross;
  }
  $("#sites").innerHTML = Object.entries(by).sort((a, b) => b[1].net - a[1].net).map(([k, v]) =>
    `<div class="site"><h3>${esc(k)}</h3><p><b>${inr(v.net)}</b> net · ${v.n} guard${v.n > 1 ? "s" : ""} · ${v.duties} duties</p></div>`).join("") ||
    `<p class="empty">No data yet.</p>`;
}

function download(name, text, type = "text/csv") {
  const blob = new Blob(["﻿" + text], { type: `${type};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileMonth = () => state.settings.month;

$("#btn-csv").addEventListener("click", () => {
  const rs = results();
  const head = ["Guard", "Site", "Monthly salary", "Duties", "Earned", "Special", "Bonus", "Gross", "Advance", "Mess", "Uniform", "Other", "PF", "ESI", "Net pay"];
  const body = rs.map(({ g, r }) => [g.name, g.site, g.salary, r.duties, r.base, r.special, r.bonus, r.gross, r.advance, r.mess, r.uniform, r.other, r.pf, r.esi, r.net]);
  const t = totals(rs.map((x) => x.r));
  body.push(["TOTAL", "", "", t.duties, t.base, t.special, t.bonus, t.gross, t.advance, t.mess, t.uniform, t.other, t.pf, t.esi, t.net]);
  download(`salary-sheet-${fileMonth()}.csv`, toCSV([head, ...body]));
});
$("#btn-payout").addEventListener("click", () => {
  const rs = results().filter((x) => x.r.net > 0);
  const rows = rs.map(({ g, r }) => [g.name, g.site, r.net, g.account, g.ifsc, g.bank, g.upi, g.phone, `Salary ${monthLabel(fileMonth())}`]);
  const missing = rs.filter(({ g }) => !g.account && !g.upi).length;
  download(`payout-list-${fileMonth()}.csv`, toCSV([["Beneficiary name", "Site", "Amount", "Account no.", "IFSC", "Bank", "UPI ID", "Phone", "Remarks"], ...rows]));
  if (missing) toast(`${missing} guard${missing > 1 ? "s have" : " has"} no account or UPI — fill them in Guards`);
});
$("#btn-whatsapp").addEventListener("click", async () => {
  const st = state.settings; const rs = results();
  const t = totals(rs.map((x) => x.r));
  const lines = [`*${st.agency || "Salary"} — ${monthLabel(st.month)}*`, ""];
  for (const { g, r } of rs) lines.push(`${g.name} (${g.site}): ${r.duties} duties → *${inr(r.net)}*${r.advance ? ` (adv ${inr(r.advance)})` : ""}`);
  lines.push("", `Total net: *${inr(t.net)}* for ${rs.length} guards`);
  const text = lines.join("\n");
  try { await navigator.clipboard.writeText(text); toast("Summary copied — paste it in WhatsApp"); }
  catch { prompt("Copy this summary:", text); }
});
$("#btn-print").addEventListener("click", () => {
  const st = state.settings;
  const rs = results();
  if (!rs.length) return toast("Add guards first");
  $("#print-area").innerHTML = rs.map(({ g, r }) => `<section class="slip">
    <div class="meta"><div><h2>${esc(st.agency || "Payslip")}</h2><div>${esc(st.address)}</div></div>
      <div style="text-align:right"><b>PAYSLIP</b><br>${monthLabel(st.month)}</div></div>
    <table><tr><td><b>Name</b></td><td>${esc(g.name)}</td><td><b>Site</b></td><td>${esc(g.site)}</td></tr>
      <tr><td><b>Monthly salary</b></td><td>${inr(g.salary || 0)}</td><td><b>Duties</b></td><td>${r.duties} (₹${r.rate}/duty)</td></tr>
      <tr><td><b>Account</b></td><td>${esc(g.account || "—")} ${esc(g.ifsc)}</td><td><b>UPI</b></td><td>${esc(g.upi || "—")}</td></tr></table>
    <table><tr><th>Earnings</th><th>₹</th><th>Deductions</th><th>₹</th></tr>
      <tr><td>Duty pay</td><td>${inr(r.base)}</td><td>Advance</td><td>${inr(r.advance)}</td></tr>
      <tr><td>Special duty</td><td>${inr(r.special)}</td><td>Mess / food</td><td>${inr(r.mess)}</td></tr>
      <tr><td>Bonus</td><td>${inr(r.bonus)}</td><td>Uniform</td><td>${inr(r.uniform)}</td></tr>
      <tr><td></td><td></td><td>PF / ESI</td><td>${inr(r.pf + r.esi)}</td></tr>
      <tr><td></td><td></td><td>Other</td><td>${inr(r.other)}</td></tr>
      <tr class="total"><td>Gross</td><td>${inr(r.gross)}</td><td>Total deductions</td><td>${inr(r.deductions)}</td></tr>
      <tr class="total"><td colspan="3">NET PAY</td><td>${inr(r.net)}</td></tr></table>
    <p>Rupees ${r.net < 0 ? "minus " : ""}${inWords(r.net)} only.</p>
    <div class="sign"><span>Employee signature</span><span>For ${esc(st.agency || "the agency")}</span></div></section>`).join("");
  window.print();
});

/* ---------------- toolbar ---------------- */
$("#btn-backup").addEventListener("click", () => {
  download(`dutypay-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 1), "application/json");
});
$("#file-restore").addEventListener("change", async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const s = JSON.parse((await f.text()).replace(/^﻿/, ""));
    if (!s.settings || !Array.isArray(s.guards)) throw new Error();
    state = { ...blank(), ...s }; save(); renderAll(); toast("Backup restored");
  } catch { toast("That file isn't a DutyPay backup"); }
  ev.target.value = "";
});
$("#btn-clear").addEventListener("click", () => {
  if (!confirm("Delete all guards, entries and settings from this browser? Make a Backup first if you need it.")) return;
  state = blank(); save(); renderAll(); showTab("settings"); toast("Cleared");
});
$("#btn-sample").addEventListener("click", () => {
  if (state.guards.length && !confirm("Replace your current data with sample data?")) return;
  state = sample(); save(); renderAll(); showTab("sheet"); toast("Sample data loaded — explore the tabs");
});

function sample() {
  const s = blank();
  s.settings = { ...s.settings, agency: "Sample Security Services", address: "Kochi, Kerala", month: "2026-10" };
  const G = [
    ["Rajesh K", "Harbour View Hotel", 15500, 31, 2, 4000, 26], ["Suresh P", "Harbour View Hotel", 15500, 30, 0, 0, 30],
    ["Anitha M", "St. Mary's School", 14000, 26, 0, 2000, 0], ["Biju Thomas", "St. Mary's School", 14000, 30, 1, 3000, 0],
    ["Manoj V", "Coastal Chemicals", 15500, 27, 0, 5000, 0], ["Sreeja R", "Coastal Chemicals", 15500, 20, 0, 0, 0],
    ["Vinod Kumar", "Lakeside Resort", 20000, 23, 3, 3000, 23], ["Joseph Mathew", "Lakeside Resort", 20000, 12, 0, 6000, 12],
  ];
  s.guards = G.map(([name, site, salary], i) => ({ id: "g" + i, name, site, salary, bank: i % 2 ? "Federal Bank" : "State Bank of India",
    account: "XXXXXXXX" + (1200 + i * 37), ifsc: i % 2 ? "FDRL000XXXX" : "SBIN000XXXX", upi: i === 5 ? "sreeja@upi" : "", phone: "" }));
  s.entries["2026-10"] = Object.fromEntries(G.map(([, , , duties, sp, adv, mess], i) => ["g" + i, {
    duties, specialDuties: sp || "", specialRate: 800, bonus: "", advance: adv || "", messDays: mess || "", messRate: 140, uniform: i === 6 ? 1000 : "", other: "" }]));
  return s;
}

function updateHeader() { $("#count-guards").textContent = state.guards.length; }
function renderAll() { renderSettings(); renderGuards(); renderRegister(); renderSheet(); }
renderAll();
if (!state.guards.length) showTab("settings");
