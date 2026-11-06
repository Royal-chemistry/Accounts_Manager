import { computePay, totals, inr, inWords, parseCSV, toCSV, daysInMonth, divisorFor, cashSummary } from "./calc.js";

const KEY = "accounts-manager:v1";
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
  cash: [],
});

let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings && Array.isArray(s.guards)) return { ...blank(), ...s, cash: s.cash || [], settings: { ...blank().settings, ...s.settings } };
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
  if (name === "cash") renderCash();
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
    `${monthLabel(st.month)} has ${daysInMonth(st.month)} days. Someone on ₹15,000 earns ₹${(15000 / div).toFixed(2)} per day` +
    (st.basis === "calendar" ? ", so 30 days pays " + inr(Math.round(15000 / div * 30)) + "." : ".");
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
  ["name", "text", "Full name"], ["site", "text", "Team / branch"], ["salary", "number", "15000"],
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
  if (!confirm(`Remove ${g.name || "this person"}?`)) return;
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
    ["Rajesh K", "Main shop", 15500, "State Bank of India", "00000000000", "SBIN0000000", "", "9800000000"]]));
});
$("#file-guards").addEventListener("change", async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  const rows = parseCSV(await file.text());
  let added = 0;
  for (const r of rows) {
    const name = r.name || r.full_name || r.staff || r.employee || r.guard;
    if (!name) continue;
    state.guards.push({
      id: uid(), name, site: r.team || r.branch || r.site || r.department || "", salary: Number(String(r.salary || r.monthly_salary || r.basic || 0).replace(/[^0-9.]/g, "")) || 0,
      bank: r.bank || r.bank_name || "", account: r.account || r.account_no || r.account_number || "", ifsc: (r.ifsc || "").toUpperCase(),
      upi: r.upi || r.upi_id || "", phone: r.phone || r.mobile || "",
    });
    added++;
  }
  ev.target.value = "";
  save(); renderGuards();
  toast(added ? `Imported ${added} ${added > 1 ? "people" : "person"}` : "No rows found — check the CSV has a Name column");
});

/* ---------------- register ---------------- */
const E_FIELDS = ["duties", "specialDuties", "specialRate", "bonus", "advance", "messDays", "messRate", "uniform", "other"];
function sites() { return [...new Set(state.guards.map((g) => g.site).filter(Boolean))].sort(); }
function renderRegister() {
  $("#reg-month").textContent = monthLabel(state.settings.month);
  const sel = $("#reg-site"), cur = sel.value;
  sel.innerHTML = `<option value="">All teams</option>` + sites().map((s) => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");
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
  toast(c ? `Filled ${n} days for ${c} ${c > 1 ? "people" : "person"} (empty rows only)` : "Every row already has days filled in");
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
    `<tr><td colspan="14" class="empty">Add staff and fill in attendance first.</td></tr>`;
  $("#sheet-table tfoot").innerHTML = rs.length ? `<tr><td>Total</td><td>${rs.length} staff</td>${cols(t).map((v) => `<td class="n">${v}</td>`).join("")}<td class="net">${inr(t.net)}</td></tr>` : "";
  const owe = rs.filter((x) => x.r.net < 0);
  $("#sheet-note").textContent = owe.length
    ? `${owe.map((x) => x.g.name).join(", ")} ${owe.length > 1 ? "owe" : "owes"} you money this month (deductions are more than pay). They're left out of the payout list.`
    : `Pay basis: ${st.basis === "calendar" ? `salary ÷ ${daysInMonth(st.month)} days` : `salary ÷ ${st.basis}`} × days worked.`;
  const payable = rs.filter((x) => x.r.net > 0).reduce((s, x) => s + x.r.net, 0);
  $("#stats").innerHTML = [
    ["Staff", rs.length], ["Days worked", t.duties], ["Gross pay", inr(t.gross)], ["Deductions", inr(t.deductions)], ["To pay out", inr(payable)],
  ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
  const by = {};
  for (const { g, r } of rs) {
    const k = g.site || "No team";
    by[k] ??= { n: 0, duties: 0, net: 0, gross: 0 };
    by[k].n++; by[k].duties += r.duties; by[k].net += r.net; by[k].gross += r.gross;
  }
  $("#sites").innerHTML = Object.entries(by).sort((a, b) => b[1].net - a[1].net).map(([k, v]) =>
    `<div class="site"><h3>${esc(k)}</h3><p><b>${inr(v.net)}</b> net · ${v.n} staff · ${v.duties} days</p></div>`).join("") ||
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
  const head = ["Name", "Team", "Monthly salary", "Days worked", "Earned", "Extra shifts", "Bonus", "Gross", "Advance", "Food", "Uniform/kit", "Other", "PF", "ESI", "Net pay"];
  const body = rs.map(({ g, r }) => [g.name, g.site, g.salary, r.duties, r.base, r.special, r.bonus, r.gross, r.advance, r.mess, r.uniform, r.other, r.pf, r.esi, r.net]);
  const t = totals(rs.map((x) => x.r));
  body.push(["TOTAL", "", "", t.duties, t.base, t.special, t.bonus, t.gross, t.advance, t.mess, t.uniform, t.other, t.pf, t.esi, t.net]);
  download(`salary-sheet-${fileMonth()}.csv`, toCSV([head, ...body]));
});
$("#btn-payout").addEventListener("click", () => {
  const rs = results().filter((x) => x.r.net > 0);
  const rows = rs.map(({ g, r }) => [g.name, g.site, r.net, g.account, g.ifsc, g.bank, g.upi, g.phone, `Salary ${monthLabel(fileMonth())}`]);
  const missing = rs.filter(({ g }) => !g.account && !g.upi).length;
  download(`payout-list-${fileMonth()}.csv`, toCSV([["Beneficiary name", "Team", "Amount", "Account no.", "IFSC", "Bank", "UPI ID", "Phone", "Remarks"], ...rows]));
  if (missing) toast(`${missing} ${missing > 1 ? "people have" : "person has"} no account or UPI — fill them in Staff`);
});
$("#btn-whatsapp").addEventListener("click", async () => {
  const st = state.settings; const rs = results();
  const t = totals(rs.map((x) => x.r));
  const lines = [`*${st.agency || "Salary"} — ${monthLabel(st.month)}*`, ""];
  for (const { g, r } of rs) lines.push(`${g.name} (${g.site}): ${r.duties} days → *${inr(r.net)}*${r.advance ? ` (adv ${inr(r.advance)})` : ""}`);
  lines.push("", `Total net: *${inr(t.net)}* for ${rs.length} staff`);
  const text = lines.join("\n");
  try { await navigator.clipboard.writeText(text); toast("Summary copied — paste it in WhatsApp"); }
  catch { prompt("Copy this summary:", text); }
});
$("#btn-print").addEventListener("click", () => {
  const st = state.settings;
  const rs = results();
  if (!rs.length) return toast("Add staff first");
  $("#print-area").innerHTML = rs.map(({ g, r }) => `<section class="slip">
    <div class="meta"><div><h2>${esc(st.agency || "Payslip")}</h2><div>${esc(st.address)}</div></div>
      <div style="text-align:right"><b>PAYSLIP</b><br>${monthLabel(st.month)}</div></div>
    <table><tr><td><b>Name</b></td><td>${esc(g.name)}</td><td><b>Team</b></td><td>${esc(g.site)}</td></tr>
      <tr><td><b>Monthly salary</b></td><td>${inr(g.salary || 0)}</td><td><b>Days worked</b></td><td>${r.duties} (₹${r.rate}/day)</td></tr>
      <tr><td><b>Account</b></td><td>${esc(g.account || "—")} ${esc(g.ifsc)}</td><td><b>UPI</b></td><td>${esc(g.upi || "—")}</td></tr></table>
    <table><tr><th>Earnings</th><th>₹</th><th>Deductions</th><th>₹</th></tr>
      <tr><td>Basic pay</td><td>${inr(r.base)}</td><td>Advance</td><td>${inr(r.advance)}</td></tr>
      <tr><td>Extra shifts</td><td>${inr(r.special)}</td><td>Food</td><td>${inr(r.mess)}</td></tr>
      <tr><td>Bonus</td><td>${inr(r.bonus)}</td><td>Uniform / kit</td><td>${inr(r.uniform)}</td></tr>
      <tr><td></td><td></td><td>PF / ESI</td><td>${inr(r.pf + r.esi)}</td></tr>
      <tr><td></td><td></td><td>Other</td><td>${inr(r.other)}</td></tr>
      <tr class="total"><td>Gross</td><td>${inr(r.gross)}</td><td>Total deductions</td><td>${inr(r.deductions)}</td></tr>
      <tr class="total"><td colspan="3">NET PAY</td><td>${inr(r.net)}</td></tr></table>
    <p>Rupees ${r.net < 0 ? "minus " : ""}${inWords(r.net)} only.</p>
    <div class="sign"><span>Employee signature</span><span>For ${esc(st.agency || "the employer")}</span></div></section>`).join("");
  window.print();
});

/* ---------------- toolbar ---------------- */
$("#btn-backup").addEventListener("click", () => {
  download(`accounts-manager-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 1), "application/json");
});
$("#file-restore").addEventListener("change", async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const s = JSON.parse((await f.text()).replace(/^﻿/, ""));
    if (!s.settings || !Array.isArray(s.guards)) throw new Error();
    state = { ...blank(), ...s }; save(); renderAll(); toast("Backup restored");
  } catch { toast("That file isn't an Accounts Manager backup"); }
  ev.target.value = "";
});
$("#btn-clear").addEventListener("click", () => {
  if (!confirm("Delete all staff, attendance, cash book entries and settings from this browser? Make a Backup first if you need it.")) return;
  state = blank(); save(); renderAll(); showTab("settings"); toast("Cleared");
});
$("#btn-sample").addEventListener("click", () => {
  if (state.guards.length && !confirm("Replace your current data with sample data?")) return;
  state = sample(); save(); renderAll(); showTab("sheet"); toast("Sample data loaded — explore the tabs");
});

function sample() {
  const s = blank();
  s.settings = { ...s.settings, agency: "Sample Traders", address: "Kochi, Kerala", month: "2026-10", specialRate: 500, messRate: 100 };
  const G = [
    ["Rajesh K", "Main shop", 15500, 31, 2, 4000, 26], ["Suresh P", "Main shop", 15500, 30, 0, 0, 30],
    ["Anitha M", "Billing", 14000, 26, 0, 2000, 0], ["Biju Thomas", "Billing", 14000, 30, 1, 3000, 0],
    ["Manoj V", "Warehouse", 15500, 27, 0, 5000, 0], ["Sreeja R", "Warehouse", 15500, 20, 0, 0, 0],
    ["Vinod Kumar", "Delivery", 20000, 23, 3, 3000, 23], ["Joseph Mathew", "Delivery", 20000, 12, 0, 6000, 12],
  ];
  s.guards = G.map(([name, site, salary], i) => ({ id: "g" + i, name, site, salary, bank: i % 2 ? "Federal Bank" : "State Bank of India",
    account: "XXXXXXXX" + (1200 + i * 37), ifsc: i % 2 ? "FDRL000XXXX" : "SBIN000XXXX", upi: i === 5 ? "sreeja@upi" : "", phone: "" }));
  s.entries["2026-10"] = Object.fromEntries(G.map(([, , , duties, sp, adv, mess], i) => ["g" + i, {
    duties, specialDuties: sp || "", specialRate: 500, bonus: "", advance: adv || "", messDays: mess || "", messRate: 100, uniform: i === 6 ? 1000 : "", other: "" }]));
  const C = [
    ["2026-10-02", "income", "Sales", "Week 1 counter sales", "Cash", 182000], ["2026-10-05", "expense", "Rent", "Shop rent", "Bank transfer", 35000],
    ["2026-10-07", "expense", "Stock purchase", "Wholesale order", "Bank transfer", 96000], ["2026-10-09", "income", "Sales", "Week 2 counter sales", "UPI", 171500],
    ["2026-10-12", "expense", "Electricity", "KSEB bill", "UPI", 6840], ["2026-10-16", "income", "Sales", "Week 3 counter sales", "UPI", 165200],
    ["2026-10-18", "expense", "Transport", "Diesel for van", "Cash", 9200], ["2026-10-23", "income", "Sales", "Week 4 counter sales", "Cash", 190300],
    ["2026-10-25", "expense", "Stock purchase", "Wholesale order", "Bank transfer", 104000], ["2026-10-28", "expense", "Internet & phone", "", "UPI", 1499],
  ];
  s.cash = C.map(([date, type, category, note, via, amount], i) => ({ id: "c" + i, date, type, category, note, via, amount }));
  return s;
}

/* ---------------- cash book ---------------- */
function renderCash() {
  const st = state.settings;
  $("#cash-month").textContent = monthLabel(st.month);
  if (!$("#c-date").value || !$("#c-date").value.startsWith(st.month)) {
    const today = new Date().toISOString().slice(0, 10);
    $("#c-date").value = today.startsWith(st.month) ? today : st.month + "-01";
  }
  const rows = state.cash.filter((e) => String(e.date).startsWith(st.month)).sort((a, b) => a.date.localeCompare(b.date));
  $("#cash-table tbody").innerHTML = rows.map((e) => `<tr><td>${esc(e.date.split("-").reverse().join("/"))}</td><td><b>${esc(e.category)}</b></td><td>${esc(e.note)}</td><td>${esc(e.via)}</td>
    <td class="inc">${e.type === "income" ? inr(e.amount) : ""}</td><td class="exp">${e.type !== "income" ? inr(e.amount) : ""}</td>
    <td><button class="icon-btn" data-cdel="${e.id}" aria-label="Delete entry" title="Delete">✕</button></td></tr>`).join("") ||
    `<tr><td colspan="7" class="empty">No entries for ${monthLabel(st.month)} yet.</td></tr>`;
  const c = cashSummary(state.cash, st.month);
  const sal = results().filter((x) => x.r.net > 0).reduce((s, x) => s + x.r.net, 0);
  const profit = c.income - c.expense - sal;
  $("#cash-stats").innerHTML = [
    ["Income", inr(c.income), ""], ["Expenses", inr(c.expense), ""], ["Salaries", inr(sal), ""],
    ["Profit / loss", inr(profit), profit >= 0 ? "good" : "bad"],
  ].map(([k, v, cls]) => `<div class="stat ${cls}"><span>${k}</span><b>${v}</b></div>`).join("");
  const cats = Object.entries(c.byCategory).sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense));
  $("#cash-cats").innerHTML = cats.map(([k, v]) => `<div class="site"><h3>${esc(k)}</h3><p>${v.income ? `<b class="inc">+${inr(v.income)}</b> ` : ""}${v.expense ? `<b>−${inr(v.expense)}</b>` : ""}</p></div>`).join("") ||
    `<p class="empty">Add income and expenses to see them by category.</p>`;
  const known = [...new Set(["Sales", "Rent", "Electricity", "Stock purchase", "Transport", "Internet & phone", "Repairs", "Taxes", "Loan EMI", ...state.cash.map((e) => e.category)])];
  $("#cat-list").innerHTML = known.map((k) => `<option>${esc(k)}</option>`).join("");
}
$("#cash-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const amount = Number($("#c-amount").value);
  if (!amount) return toast("Enter an amount");
  state.cash.push({ id: uid(), date: $("#c-date").value, type: $("#c-type").value, category: $("#c-cat").value.trim(), note: $("#c-note").value.trim(), via: $("#c-via").value.trim(), amount });
  save();
  $("#c-amount").value = ""; $("#c-note").value = "";
  if (!$("#c-date").value.startsWith(state.settings.month)) toast("Saved — that date is in another month");
  renderCash(); $("#c-cat").focus();
});
$("#cash-table").addEventListener("click", (ev) => {
  const id = ev.target.dataset?.cdel; if (!id) return;
  if (!confirm("Delete this entry?")) return;
  state.cash = state.cash.filter((e) => e.id !== id); save(); renderCash();
});
$("#btn-cash-csv").addEventListener("click", () => {
  const m = state.settings.month;
  const rows = state.cash.filter((e) => String(e.date).startsWith(m)).sort((a, b) => a.date.localeCompare(b.date));
  const c = cashSummary(state.cash, m);
  download(`cash-book-${m}.csv`, toCSV([["Date", "Type", "Category", "Note", "Paid via", "Amount"], ...rows.map((e) => [e.date, e.type, e.category, e.note, e.via, e.amount]),
    [], ["", "", "", "", "Total income", c.income], ["", "", "", "", "Total expenses", c.expense], ["", "", "", "", "Net", c.net]]));
});

function updateHeader() { $("#count-guards").textContent = state.guards.length; }
function renderAll() { renderSettings(); renderGuards(); renderRegister(); renderSheet(); renderCash(); }
renderAll();
if (!state.guards.length) showTab("settings");
