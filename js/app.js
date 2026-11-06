import { computePay, totals, inr, inWords, parseCSV, toCSV, daysInMonth, divisorFor, cashSummary, invoiceTotals, bankBalances, nextDue } from "./calc.js";

/* ============ basics ============ */
const KEY = "accounts-manager:v1";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const dmy = (d) => (d ? d.split("-").reverse().join("/") : "—");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const inr2 = (n) => (Math.round(n) === Math.round(n * 100) / 100 ? inr(n) : inr(Math.trunc(n)) + "." + String(Math.round(Math.abs(n) * 100) % 100).padStart(2, "0"));

function lastMonth() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const blank = () => ({
  settings: { agency: "", address: "", month: lastMonth(), basis: "calendar", capAtFull: false, pf: false, esi: false, specialRate: 800, messRate: 140, gstRate: 18, prefix: "INV-", nextInv: 1, bankLine: "" },
  guards: [], entries: {}, cash: [], advances: [], salaryPaid: {}, clients: [], invoices: [], banks: [], transfers: [], loans: [], recurring: [],
});
let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings && Array.isArray(s.guards)) { const b = blank(); return { ...b, ...s, settings: { ...b.settings, ...s.settings } }; }
  } catch { /* private mode */ }
  return blank();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast("Couldn't save in this browser — use Backup."); } }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
function monthLabel(ym) { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); }
const M = () => state.settings.month;
const inMonth = (d) => String(d || "").startsWith(M());
const bankName = (id) => state.banks.find((b) => b.id === id)?.name || "Cash / not linked";
const staffName = (id) => state.guards.find((g) => g.id === id)?.name || "(removed)";
const clientName = (id) => state.clients.find((c) => c.id === id)?.name || "(removed)";
const bankOptions = (sel) => `<option value="">Cash / not linked</option>` + state.banks.map((b) => `<option value="${b.id}"${b.id === sel ? " selected" : ""}>${esc(b.name)}</option>`).join("");
function download(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: `${type};charset=utf-8` })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const kpis = (sel, list) => { $(sel).innerHTML = list.map(([k, v, cls = "", sub = ""]) => `<div class="kpi ${cls}"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ""}</div>`).join(""); };

/* ============ dialog form ============ */
function openForm(title, fields, values = {}, onSave, okLabel = "Save") {
  $("#dlg-title").textContent = title; $("#dlg-ok").textContent = okLabel;
  $("#dlg-body").innerHTML = fields.map((f) => {
    const v = values[f.k] ?? f.def ?? "";
    const full = f.full ? ' class="full"' : "";
    if (f.type === "html") return `<div class="full">${f.html}</div>`;
    if (f.type === "select") return `<label${full}>${f.label}<select name="${f.k}"${f.req ? " required" : ""}>${f.options.map(([val, lab]) => `<option value="${esc(val)}"${String(val) === String(v) ? " selected" : ""}>${esc(lab)}</option>`).join("")}</select></label>`;
    if (f.type === "checkbox") return `<label class="check${f.full ? " full" : ""}"><input type="checkbox" name="${f.k}"${v ? " checked" : ""}> ${f.label}</label>`;
    return `<label${full}>${f.label}<input name="${f.k}" type="${f.type || "text"}" value="${esc(v)}"${f.req ? " required" : ""}${f.type === "number" ? ' step="any" min="0"' : ""}${f.ph ? ` placeholder="${esc(f.ph)}"` : ""}${f.list ? ` list="${f.list}"` : ""}></label>`;
  }).join("");
  const dlg = $("#dlg");
  dlg.returnValue = "";
  dlg.showModal();
  fields.find((f) => f.onOpen)?.onOpen($("#dlg-body"));
  const done = () => {
    dlg.removeEventListener("close", done);
    if (dlg.returnValue !== "ok") return;
    const out = {};
    for (const f of fields) {
      const el = $(`#dlg-body [name="${f.k}"]`); if (!el) continue;
      out[f.k] = f.type === "checkbox" ? el.checked : f.type === "number" ? num(el.value) : el.value.trim();
    }
    onSave(out, $("#dlg-body"));
  };
  dlg.addEventListener("close", done);
}

/* ============ navigation ============ */
const IC = {
  dashboard: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
  guards: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  register: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 16l2 2 4-4",
  sheet: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8",
  advances: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  clients: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4",
  invoices: "M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-1-3 1-3-1-3 1-3-1zM8 7h8M8 11h8M8 15h5",
  cash: "M2 7h20v12H2zM16 13h.01M2 11h20",
  recurring: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  banks: "M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
};
const NAV = [
  ["Overview"], ["dashboard", "Dashboard"],
  ["People"], ["guards", "Staff"], ["register", "Attendance & pay"], ["sheet", "Salary sheet"], ["advances", "Advances"],
  ["Money in"], ["clients", "Clients"], ["invoices", "Invoices"],
  ["Money out"], ["cash", "Cash book"], ["recurring", "Recurring"], ["banks", "Banks & loans"],
  ["Setup"], ["settings", "Settings"],
];
const RENDER = {};
let current = "dashboard";
function renderNav() {
  const open = state.invoices.filter((i) => invoiceTotals(i).status !== "paid").length;
  const dueSoon = upcoming().filter((u) => u.days <= 3 && !u.paid).length;
  const badge = { guards: state.guards.length, invoices: open ? [open, "warn"] : 0, recurring: dueSoon ? [dueSoon, "warn"] : 0 };
  $("#nav").innerHTML = NAV.map(([k, label]) => label === undefined ? `<div class="grp">${k}</div>` :
    `<button data-tab="${k}" class="${k === current ? "active" : ""}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${IC[k]}"/></svg>${label}${
      badge[k] ? `<span class="badge ${Array.isArray(badge[k]) ? badge[k][1] : ""}">${Array.isArray(badge[k]) ? badge[k][0] : badge[k]}</span>` : ""}</button>`).join("");
  $("#biz-name").textContent = state.settings.agency || "Your business";
}
function showTab(name) {
  current = name;
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  RENDER[name]?.(); renderNav();
  $("#main").scrollTo?.(0, 0); window.scrollTo({ top: 0 });
}
$("#nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) showTab(b.dataset.go); });
$("#g-month").addEventListener("change", (e) => { if (!e.target.value) return; state.settings.month = e.target.value; save(); RENDER[current]?.(); renderSettings(); });

/* ============ settings ============ */
const S = { agency: "#s-agency", address: "#s-address", basis: "#s-basis", specialRate: "#s-special", messRate: "#s-mess", capAtFull: "#s-cap", pf: "#s-pf", esi: "#s-esi", gstRate: "#s-gst", prefix: "#s-prefix", bankLine: "#s-bankline" };
function renderSettings() {
  for (const [k, sel] of Object.entries(S)) { const el = $(sel); if (el.type === "checkbox") el.checked = !!state.settings[k]; else el.value = state.settings[k] ?? ""; }
  $("#g-month").value = M();
  const div = divisorFor(state.settings.basis, M());
  $("#basis-hint").textContent = `${monthLabel(M())} has ${daysInMonth(M())} days. Someone on ₹15,000 earns ₹${(15000 / div).toFixed(2)} per day` +
    (state.settings.basis === "calendar" ? `, so 30 days pays ${inr(Math.round(15000 / div * 30))}.` : ".");
}
RENDER.settings = renderSettings;
for (const [k, sel] of Object.entries(S)) {
  $(sel).addEventListener("input", (ev) => {
    const el = ev.target;
    state.settings[k] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    save(); renderSettings(); renderNav();
  });
}

/* ============ payroll ============ */
function entryFor(gid) {
  state.entries[M()] ??= {};
  state.entries[M()][gid] ??= { duties: "", specialDuties: "", specialRate: state.settings.specialRate, bonus: "", advance: "", messDays: "", messRate: state.settings.messRate, uniform: "", other: "" };
  return state.entries[M()][gid];
}
const loggedAdvance = (gid, month = M()) => state.advances.filter((a) => a.staffId === gid && String(a.date).startsWith(month)).reduce((s, a) => s + num(a.amount), 0);
function payFor(g) {
  const e = entryFor(g.id);
  return computePay(g, { ...e, advance: num(e.advance) + loggedAdvance(g.id) }, state.settings);
}
const results = () => state.guards.map((g) => ({ g, e: entryFor(g.id), r: payFor(g) }));
const paidInfo = (gid, month = M()) => state.salaryPaid[month]?.[gid];

const GUARD_FIELDS = [["name", "text", "Full name"], ["site", "text", "Team / branch"], ["salary", "number", "15000"], ["bank", "text", "Bank"], ["account", "text", "Account no."], ["ifsc", "text", "IFSC"], ["upi", "text", "name@upi"], ["phone", "tel", "Phone"]];
function renderGuards() {
  $("#guards-table tbody").innerHTML = state.guards.map((g) => `<tr data-id="${g.id}">${GUARD_FIELDS.map(([f, type, ph]) =>
    `<td><input type="${type}" data-f="${f}" value="${esc(g[f])}" placeholder="${ph}" aria-label="${f}"${type === "number" ? ' min="0" step="100"' : ""}></td>`).join("")}
    <td><button class="icon-btn del" data-del="${g.id}" aria-label="Remove ${esc(g.name)}">✕</button></td></tr>`).join("");
  $("#guards-empty").style.display = state.guards.length ? "none" : "block";
  $("#guards-table").parentElement.style.display = state.guards.length ? "" : "none";
  $("#count-guards").textContent = state.guards.length;
}
RENDER.guards = renderGuards;
$("#guards-table").addEventListener("input", (ev) => {
  const tr = ev.target.closest("tr"); const g = state.guards.find((x) => x.id === tr?.dataset.id); if (!g) return;
  g[ev.target.dataset.f] = ev.target.type === "number" ? Number(ev.target.value) : ev.target.value; save();
});
$("#guards-table").addEventListener("click", (ev) => {
  const id = ev.target.dataset?.del; if (!id) return;
  const g = state.guards.find((x) => x.id === id);
  if (!confirm(`Remove ${g.name || "this person"}?`)) return;
  state.guards = state.guards.filter((x) => x.id !== id); save(); renderGuards(); renderNav();
});
$("#btn-add-guard").addEventListener("click", () => {
  state.guards.push({ id: uid(), name: "", site: state.guards.at(-1)?.site ?? "", salary: state.guards.at(-1)?.salary ?? 15000, bank: "", account: "", ifsc: "", upi: "", phone: "" });
  save(); renderGuards(); renderNav(); $("#guards-table tbody tr:last-child input")?.focus();
});
$("#btn-guards-template").addEventListener("click", () => download("staff-template.csv", toCSV([["Name", "Team", "Salary", "Bank", "Account", "IFSC", "UPI", "Phone"], ["Rajesh K", "Main shop", 15500, "State Bank of India", "00000000000", "SBIN0000000", "", "9800000000"]])));
$("#file-guards").addEventListener("change", async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  let added = 0;
  for (const r of parseCSV(await f.text())) {
    const name = r.name || r.full_name || r.staff || r.employee || r.guard; if (!name) continue;
    state.guards.push({ id: uid(), name, site: r.team || r.branch || r.site || r.department || "", salary: Number(String(r.salary || r.monthly_salary || r.basic || 0).replace(/[^0-9.]/g, "")) || 0,
      bank: r.bank || r.bank_name || "", account: r.account || r.account_no || r.account_number || "", ifsc: (r.ifsc || "").toUpperCase(), upi: r.upi || r.upi_id || "", phone: r.phone || r.mobile || "" });
    added++;
  }
  ev.target.value = ""; save(); renderGuards(); renderNav();
  toast(added ? `Imported ${added} ${added > 1 ? "people" : "person"}` : "No rows found — the CSV needs a Name column");
});

const E_FIELDS = ["duties", "specialDuties", "specialRate", "bonus", "advance", "messDays", "messRate", "uniform", "other"];
const teams = () => [...new Set(state.guards.map((g) => g.site).filter(Boolean))].sort();
function renderRegister() {
  $("#reg-month").textContent = monthLabel(M());
  const sel = $("#reg-site"), cur = sel.value;
  sel.innerHTML = `<option value="">All teams</option>` + teams().map((s) => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("");
  $("#reg-table tbody").innerHTML = state.guards.filter((g) => !sel.value || g.site === sel.value).map((g) => {
    const e = entryFor(g.id), r = payFor(g), lg = loggedAdvance(g.id);
    return `<tr data-id="${g.id}"><td class="name">${esc(g.name || "(no name)")}<small>${esc(g.site)} · ${inr(g.salary || 0)}</small></td>
      ${E_FIELDS.map((f) => `<td><input type="number" min="0" step="${f === "duties" ? "0.5" : "1"}" data-f="${f}" value="${esc(e[f])}" aria-label="${f} for ${esc(g.name)}">${f === "advance" && lg ? `<small class="logged">+${inr(lg)} logged</small>` : ""}</td>`).join("")}
      <td class="net${r.net < 0 ? " neg" : ""}">${inr(r.net)}</td></tr>`;
  }).join("");
  $("#reg-empty").style.display = state.guards.length ? "none" : "block";
}
RENDER.register = renderRegister;
$("#reg-site").addEventListener("change", renderRegister);
$("#reg-table").addEventListener("input", (ev) => {
  const tr = ev.target.closest("tr"); const g = state.guards.find((x) => x.id === tr?.dataset.id); if (!g) return;
  entryFor(g.id)[ev.target.dataset.f] = ev.target.value === "" ? "" : Number(ev.target.value); save();
  const r = payFor(g), td = tr.querySelector("td.net"); td.textContent = inr(r.net); td.classList.toggle("neg", r.net < 0);
});
$("#btn-fill-full").addEventListener("click", () => {
  const n = state.settings.basis === "calendar" ? daysInMonth(M()) : Number(state.settings.basis), site = $("#reg-site").value;
  let c = 0;
  for (const g of state.guards) { if (site && g.site !== site) continue; const e = entryFor(g.id); if (e.duties === "" || e.duties == null) { e.duties = n; c++; } }
  save(); renderRegister(); toast(c ? `Filled ${n} days for ${c} ${c > 1 ? "people" : "person"}` : "Every row already has days filled in");
});

function renderSheet() {
  $("#sheet-month").textContent = monthLabel(M());
  const rs = results(), t = totals(rs.map((x) => x.r));
  const cols = (r) => [r.duties, inr(r.base), inr(r.special), inr(r.bonus), inr(r.gross), inr(r.advance), inr(r.mess), inr(r.uniform), inr(r.other), inr(r.pf), inr(r.esi)];
  $("#sheet-table tbody").innerHTML = rs.map(({ g, r }) => {
    const p = paidInfo(g.id);
    const st = r.net <= 0 ? `<span class="pill muted">Nothing to pay</span>` : p ? `<span class="pill paid">Paid ${dmy(p.date)}</span>` : `<button class="icon-btn" data-pay="${g.id}">Mark paid</button>`;
    return `<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.site)}</td>${cols(r).map((v) => `<td class="n">${v}</td>`).join("")}<td class="net${r.net < 0 ? " neg" : ""}">${inr(r.net)}</td><td>${st}${p ? ` <button class="icon-btn" data-unpay="${g.id}" title="Undo">↺</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="15" class="empty">Add staff and fill in attendance first.</td></tr>`;
  $("#sheet-table tfoot").innerHTML = rs.length ? `<tr><td>Total</td><td>${rs.length} staff</td>${cols(t).map((v) => `<td class="n">${v}</td>`).join("")}<td class="n">${inr(t.net)}</td><td></td></tr>` : "";
  const owe = rs.filter((x) => x.r.net < 0);
  $("#sheet-note").textContent = owe.length ? `${owe.map((x) => x.g.name).join(", ")} ${owe.length > 1 ? "owe" : "owes"} you money this month (deductions are more than pay) and ${owe.length > 1 ? "are" : "is"} left out of the payout.`
    : `Pay basis: ${state.settings.basis === "calendar" ? `salary ÷ ${daysInMonth(M())} days` : `salary ÷ ${state.settings.basis}`} × days worked.`;
  const payable = rs.filter((x) => x.r.net > 0), paidAmt = payable.filter((x) => paidInfo(x.g.id)).reduce((s, x) => s + x.r.net, 0), due = payable.reduce((s, x) => s + x.r.net, 0);
  kpis("#stats", [["Staff", rs.length], ["Days worked", t.duties], ["Gross pay", inr(t.gross)], ["Deductions", inr(t.deductions)], ["Paid", inr(paidAmt), "good"], ["Still to pay", inr(due - paidAmt), due - paidAmt > 0 ? "warn" : "good"]]);
  const by = {};
  for (const { g, r } of rs) { const k = g.site || "No team"; by[k] ??= { n: 0, d: 0, net: 0 }; by[k].n++; by[k].d += r.duties; by[k].net += r.net; }
  $("#sites").innerHTML = Object.entries(by).sort((a, b) => b[1].net - a[1].net).map(([k, v]) => `<div class="tile"><h3>${esc(k)}</h3><b>${inr(v.net)}</b><p>${v.n} staff · ${v.d} days</p></div>`).join("") || `<p class="empty">No data yet.</p>`;
}
RENDER.sheet = renderSheet;
function markPaid(ids) {
  openForm(ids.length > 1 ? `Mark ${ids.length} salaries paid` : `Mark ${staffName(ids[0])}'s salary paid`, [
    { k: "date", label: "Paid on", type: "date", def: today(), req: true },
    { k: "bankId", label: "Paid from", type: "select", options: [["", "Cash / not linked"], ...state.banks.map((b) => [b.id, b.name])] },
  ], {}, (v) => {
    state.salaryPaid[M()] ??= {};
    for (const id of ids) { const g = state.guards.find((x) => x.id === id); state.salaryPaid[M()][id] = { date: v.date, bankId: v.bankId, amount: payFor(g).net }; }
    save(); renderSheet(); toast("Marked paid");
  }, "Mark paid");
}
$("#sheet-table").addEventListener("click", (e) => {
  if (e.target.dataset.pay) markPaid([e.target.dataset.pay]);
  if (e.target.dataset.unpay) { delete state.salaryPaid[M()]?.[e.target.dataset.unpay]; save(); renderSheet(); }
});
$("#btn-payall").addEventListener("click", () => {
  const ids = results().filter((x) => x.r.net > 0 && !paidInfo(x.g.id)).map((x) => x.g.id);
  if (!ids.length) return toast("Everyone is already marked paid");
  markPaid(ids);
});
$("#btn-csv").addEventListener("click", () => {
  const rs = results(), t = totals(rs.map((x) => x.r));
  download(`salary-sheet-${M()}.csv`, toCSV([["Name", "Team", "Monthly salary", "Days worked", "Earned", "Extra shifts", "Bonus", "Gross", "Advance", "Food", "Uniform/kit", "Other", "PF", "ESI", "Net pay", "Paid on"],
    ...rs.map(({ g, r }) => [g.name, g.site, g.salary, r.duties, r.base, r.special, r.bonus, r.gross, r.advance, r.mess, r.uniform, r.other, r.pf, r.esi, r.net, paidInfo(g.id)?.date || ""]),
    ["TOTAL", "", "", t.duties, t.base, t.special, t.bonus, t.gross, t.advance, t.mess, t.uniform, t.other, t.pf, t.esi, t.net, ""]]));
});
$("#btn-payout").addEventListener("click", () => {
  const rs = results().filter((x) => x.r.net > 0 && !paidInfo(x.g.id));
  download(`payout-list-${M()}.csv`, toCSV([["Beneficiary name", "Team", "Amount", "Account no.", "IFSC", "Bank", "UPI ID", "Phone", "Remarks"], ...rs.map(({ g, r }) => [g.name, g.site, r.net, g.account, g.ifsc, g.bank, g.upi, g.phone, `Salary ${monthLabel(M())}`])]));
  const miss = rs.filter(({ g }) => !g.account && !g.upi).length;
  if (miss) toast(`${miss} ${miss > 1 ? "people have" : "person has"} no account or UPI — add them in Staff`);
});
$("#btn-whatsapp").addEventListener("click", async () => {
  const rs = results(), t = totals(rs.map((x) => x.r));
  const text = [`*${state.settings.agency || "Salary"} — ${monthLabel(M())}*`, "", ...rs.map(({ g, r }) => `${g.name} (${g.site}): ${r.duties} days → *${inr(r.net)}*${r.advance ? ` (adv ${inr(r.advance)})` : ""}`), "", `Total net: *${inr(t.net)}* for ${rs.length} staff`].join("\n");
  try { await navigator.clipboard.writeText(text); toast("Copied — paste it in WhatsApp"); } catch { prompt("Copy this summary:", text); }
});
$("#btn-print").addEventListener("click", () => {
  const st = state.settings, rs = results();
  if (!rs.length) return toast("Add staff first");
  $("#print-area").innerHTML = rs.map(({ g, r }) => `<section class="slip"><div class="meta"><div><h2>${esc(st.agency || "Payslip")}</h2><div>${esc(st.address)}</div></div><div style="text-align:right"><b>PAYSLIP</b><br>${monthLabel(M())}</div></div>
    <table><tr><td><b>Name</b></td><td>${esc(g.name)}</td><td><b>Team</b></td><td>${esc(g.site)}</td></tr><tr><td><b>Monthly salary</b></td><td>${inr(g.salary || 0)}</td><td><b>Days worked</b></td><td>${r.duties} (₹${r.rate}/day)</td></tr>
    <tr><td><b>Account</b></td><td>${esc(g.account || "—")} ${esc(g.ifsc)}</td><td><b>UPI</b></td><td>${esc(g.upi || "—")}</td></tr></table>
    <table><tr><th>Earnings</th><th>₹</th><th>Deductions</th><th>₹</th></tr><tr><td>Basic pay</td><td>${inr(r.base)}</td><td>Advance</td><td>${inr(r.advance)}</td></tr><tr><td>Extra shifts</td><td>${inr(r.special)}</td><td>Food</td><td>${inr(r.mess)}</td></tr>
    <tr><td>Bonus</td><td>${inr(r.bonus)}</td><td>Uniform / kit</td><td>${inr(r.uniform)}</td></tr><tr><td></td><td></td><td>PF / ESI</td><td>${inr(r.pf + r.esi)}</td></tr><tr><td></td><td></td><td>Other</td><td>${inr(r.other)}</td></tr>
    <tr class="total"><td>Gross</td><td>${inr(r.gross)}</td><td>Total deductions</td><td>${inr(r.deductions)}</td></tr><tr class="total"><td colspan="3">NET PAY</td><td>${inr(r.net)}</td></tr></table>
    <p>Rupees ${r.net < 0 ? "minus " : ""}${inWords(r.net)} only.</p><div class="sign"><span>Employee signature</span><span>For ${esc(st.agency || "the employer")}</span></div></section>`).join("");
  window.print();
});

/* ============ advances ============ */
function renderAdvances() {
  const list = state.advances.filter((a) => inMonth(a.date)).sort((a, b) => b.date.localeCompare(a.date));
  $("#adv-title").textContent = `Advances · ${monthLabel(M())}`;
  $("#adv-table tbody").innerHTML = list.map((a) => { const g = state.guards.find((x) => x.id === a.staffId);
    return `<tr><td>${dmy(a.date)}</td><td><b>${esc(g?.name || "(removed)")}</b></td><td>${esc(g?.site || "")}</td><td>${esc(bankName(a.bankId))}</td><td>${esc(a.note)}</td><td class="n">${inr(a.amount)}</td>
    <td><button class="icon-btn" data-edit="${a.id}">Edit</button><button class="icon-btn del" data-del="${a.id}" aria-label="Delete">✕</button></td></tr>`; }).join("") ||
    `<tr><td colspan="7" class="empty">No advances in ${monthLabel(M())}.</td></tr>`;
  const total = list.reduce((s, a) => s + num(a.amount), 0), people = new Set(list.map((a) => a.staffId)).size;
  const biggest = Object.entries(list.reduce((m, a) => ((m[a.staffId] = (m[a.staffId] || 0) + num(a.amount)), m), {})).sort((a, b) => b[1] - a[1])[0];
  kpis("#adv-kpis", [["Given this month", inr(total), "warn"], ["People", people], ["Entries", list.length], ["Largest", biggest ? inr(biggest[1]) : "—", "", biggest ? staffName(biggest[0]) : ""]]);
}
RENDER.advances = renderAdvances;
function advanceForm(a = {}) {
  if (!state.guards.length) return toast("Add staff first");
  openForm(a.id ? "Edit advance" : "Record advance", [
    { k: "staffId", label: "Staff", type: "select", options: state.guards.map((g) => [g.id, `${g.name} · ${g.site}`]), req: true },
    { k: "date", label: "Date", type: "date", def: inMonth(today()) ? today() : M() + "-01", req: true },
    { k: "amount", label: "Amount ₹", type: "number", req: true },
    { k: "bankId", label: "Paid from", type: "select", options: [["", "Cash / not linked"], ...state.banks.map((b) => [b.id, b.name])] },
    { k: "note", label: "Note", full: true, ph: "Optional" },
  ], a, (v) => {
    if (!v.amount) return toast("Enter an amount");
    if (a.id) Object.assign(a, v); else state.advances.push({ id: uid(), ...v });
    save(); renderAdvances(); toast(`Advance saved — it comes off ${monthLabel(v.date.slice(0, 7))} pay`);
  });
}
$("#btn-add-adv").addEventListener("click", () => advanceForm());
$("#adv-table").addEventListener("click", (e) => {
  const a = state.advances.find((x) => x.id === (e.target.dataset.edit || e.target.dataset.del)); if (!a) return;
  if (e.target.dataset.edit) advanceForm(a);
  else if (confirm("Delete this advance?")) { state.advances = state.advances.filter((x) => x !== a); save(); renderAdvances(); }
});

/* ============ clients & invoices ============ */
function renderClients() {
  $("#count-clients").textContent = state.clients.length;
  $("#client-table tbody").innerHTML = state.clients.map((c) => {
    const inv = state.invoices.filter((i) => i.clientId === c.id).map(invoiceTotals);
    const billed = inv.reduce((s, t) => s + t.total, 0), out = inv.reduce((s, t) => s + t.balance, 0);
    return `<tr><td><b>${esc(c.name)}</b><small>${esc(c.address)}</small></td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td><td>${esc(c.gstin)}</td><td class="n">${inr(billed)}</td><td class="n ${out > 0 ? "neg" : ""}">${inr(out)}</td>
    <td><button class="icon-btn" data-inv="${c.id}">+ Invoice</button><button class="icon-btn" data-edit="${c.id}">Edit</button><button class="icon-btn del" data-del="${c.id}" aria-label="Delete">✕</button></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">No clients yet.</td></tr>`;
}
RENDER.clients = renderClients;
function clientForm(c = {}) {
  openForm(c.id ? "Edit client" : "Add client", [
    { k: "name", label: "Client / company name", req: true, full: true }, { k: "contact", label: "Contact person" }, { k: "phone", label: "Phone" },
    { k: "email", label: "Email", type: "email" }, { k: "gstin", label: "GSTIN" }, { k: "address", label: "Address", full: true },
    { k: "rate", label: "Usual rate ₹ (optional)", type: "number" }, { k: "gst", label: "Charge GST on invoices", type: "checkbox", def: true },
  ], c, (v) => { if (c.id) Object.assign(c, v); else state.clients.push({ id: uid(), ...v }); save(); renderClients(); });
}
$("#btn-add-client").addEventListener("click", () => clientForm());
$("#client-table").addEventListener("click", (e) => {
  const d = e.target.dataset, c = state.clients.find((x) => x.id === (d.edit || d.del || d.inv)); if (!c) return;
  if (d.inv) return invoiceForm({ clientId: c.id });
  if (d.edit) return clientForm(c);
  if (state.invoices.some((i) => i.clientId === c.id)) return toast("This client has invoices — delete those first");
  if (confirm(`Delete ${c.name}?`)) { state.clients = state.clients.filter((x) => x !== c); save(); renderClients(); }
});

function renderInvoices() {
  const f = $("#inv-filter").value;
  const list = state.invoices.map((i) => ({ i, t: invoiceTotals(i) })).filter(({ t }) => !f || (f === "paid" ? t.status === "paid" : t.status !== "paid"))
    .sort((a, b) => b.i.date.localeCompare(a.i.date) || String(b.i.no).localeCompare(String(a.i.no)));
  const now = today();
  $("#inv-table tbody").innerHTML = list.map(({ i, t }) => {
    const overdue = t.status !== "paid" && i.due && i.due < now;
    return `<tr><td><b>${esc(i.no)}</b></td><td>${dmy(i.date)}${i.due ? `<small>due ${dmy(i.due)}</small>` : ""}</td><td>${esc(clientName(i.clientId))}</td><td class="n">${inr2(t.total)}</td><td class="n">${inr2(t.received + t.tds)}</td>
    <td class="n ${t.balance > 0 ? "neg" : ""}">${inr2(t.balance)}</td><td><span class="pill ${overdue ? "due" : t.status}">${overdue ? "Overdue" : t.status[0].toUpperCase() + t.status.slice(1)}</span></td>
    <td>${t.status !== "paid" ? `<button class="icon-btn" data-recv="${i.id}">Receive</button>` : ""}<button class="icon-btn" data-print="${i.id}">Print</button><button class="icon-btn" data-edit="${i.id}">Edit</button><button class="icon-btn del" data-del="${i.id}" aria-label="Delete">✕</button></td></tr>`;
  }).join("") || `<tr><td colspan="8" class="empty">No invoices yet.</td></tr>`;
  const all = state.invoices.map(invoiceTotals);
  const out = all.reduce((s, t) => s + t.balance, 0);
  const monthBilled = state.invoices.filter((i) => inMonth(i.date)).map(invoiceTotals).reduce((s, t) => s + t.total, 0);
  const monthRecv = state.invoices.flatMap((i) => i.payments || []).filter((p) => inMonth(p.date)).reduce((s, p) => s + num(p.amount), 0);
  const overdue = state.invoices.filter((i) => i.due && i.due < now && invoiceTotals(i).status !== "paid").length;
  kpis("#inv-kpis", [["Outstanding", inr(out), out > 0 ? "warn" : "good"], [`Billed in ${monthLabel(M()).split(" ")[0]}`, inr(monthBilled)], [`Received in ${monthLabel(M()).split(" ")[0]}`, inr(monthRecv), "good"], ["Overdue", overdue, overdue ? "bad" : ""]]);
}
RENDER.invoices = renderInvoices;
$("#inv-filter").addEventListener("change", renderInvoices);
function invoiceForm(inv = {}) {
  if (!state.clients.length) { toast("Add a client first"); return showTab("clients"); }
  const client = state.clients.find((c) => c.id === inv.clientId);
  const items = inv.items?.length ? inv.items : [{ desc: "", qty: 1, rate: client?.rate || "" }];
  const itemRow = (it) => `<div class="it"><input data-i="desc" placeholder="Description" value="${esc(it.desc)}"><input data-i="qty" type="number" step="any" min="0" placeholder="Qty" value="${esc(it.qty)}"><input data-i="rate" type="number" step="any" min="0" placeholder="Rate ₹" value="${esc(it.rate)}"><button type="button" class="icon-btn del" data-rm aria-label="Remove line">✕</button></div>`;
  openForm(inv.id ? `Edit invoice ${inv.no}` : "New invoice", [
    { k: "clientId", label: "Client", type: "select", options: state.clients.map((c) => [c.id, c.name]), req: true, full: true },
    { k: "no", label: "Invoice no.", def: `${state.settings.prefix || ""}${String(state.settings.nextInv).padStart(3, "0")}`, req: true },
    { k: "date", label: "Date", type: "date", def: today(), req: true },
    { k: "due", label: "Due date", type: "date" }, { k: "gstRate", label: "GST %", type: "number", def: state.settings.gstRate },
    { k: "gst", label: "Add GST", type: "checkbox", def: client ? client.gst !== false : true, full: true },
    { k: "_items", type: "html", html: `<div class="items"><b>Items</b><div id="it-rows">${items.map(itemRow).join("")}</div><button type="button" class="btn ghost sm" id="it-add">+ Line</button><div class="tot" id="it-tot"></div></div>`,
      onOpen: (root) => {
        const recalc = () => { const its = readItems(); const t = invoiceTotals({ items: its, gst: root.querySelector('[name="gst"]').checked, gstRate: root.querySelector('[name="gstRate"]').value });
          root.querySelector("#it-tot").textContent = `Subtotal ${inr2(t.subtotal)} · GST ${inr2(t.gst)} · Total ${inr2(t.total)}`; };
        root.addEventListener("input", recalc); root.addEventListener("change", recalc);
        root.querySelector("#it-add").onclick = () => { root.querySelector("#it-rows").insertAdjacentHTML("beforeend", itemRow({ desc: "", qty: 1, rate: "" })); recalc(); };
        root.querySelector("#it-rows").onclick = (e) => { if (e.target.dataset.rm !== undefined && root.querySelectorAll(".it").length > 1) { e.target.closest(".it").remove(); recalc(); } };
        root.querySelector('[name="clientId"]').onchange = (e) => { const c = state.clients.find((x) => x.id === e.target.value); root.querySelector('[name="gst"]').checked = c?.gst !== false; recalc(); };
        recalc();
      } },
  ], { ...inv, clientId: inv.clientId || state.clients[0].id }, (v) => {
    const its = readItems().filter((it) => it.desc || num(it.qty) * num(it.rate));
    if (!its.length) return toast("Add at least one line");
    const data = { clientId: v.clientId, no: v.no, date: v.date, due: v.due, gst: v.gst, gstRate: v.gstRate, items: its };
    if (inv.id) Object.assign(inv, data);
    else { state.invoices.push({ id: uid(), payments: [], ...data }); state.settings.nextInv++; }
    save(); renderInvoices(); renderNav(); toast(`Invoice ${v.no} saved`);
  });
}
function readItems() { return [...document.querySelectorAll("#it-rows .it")].map((r) => ({ desc: r.querySelector('[data-i="desc"]').value.trim(), qty: num(r.querySelector('[data-i="qty"]').value), rate: num(r.querySelector('[data-i="rate"]').value) })); }
$("#btn-add-inv").addEventListener("click", () => invoiceForm());
$("#inv-table").addEventListener("click", (e) => {
  const d = e.target.dataset, inv = state.invoices.find((x) => x.id === (d.edit || d.del || d.recv || d.print)); if (!inv) return;
  if (d.edit) return invoiceForm(inv);
  if (d.print) return printInvoice(inv);
  if (d.recv) {
    const t = invoiceTotals(inv);
    return openForm(`Payment for ${inv.no}`, [
      { k: "date", label: "Received on", type: "date", def: today(), req: true }, { k: "bankId", label: "Into account", type: "select", options: [["", "Cash / not linked"], ...state.banks.map((b) => [b.id, b.name])] },
      { k: "amount", label: "Amount received ₹", type: "number", def: t.balance, req: true }, { k: "tds", label: "TDS deducted by client ₹", type: "number", def: 0 },
      { k: "note", label: "Note", full: true, ph: `Balance due ${inr2(t.balance)}` },
    ], {}, (v) => { inv.payments ??= []; inv.payments.push({ id: uid(), ...v }); save(); renderInvoices(); renderNav(); toast(invoiceTotals(inv).status === "paid" ? `${inv.no} fully paid` : `Part payment saved for ${inv.no}`); }, "Save payment");
  }
  if (d.del && confirm(`Delete invoice ${inv.no}? Its payments are removed too.`)) { state.invoices = state.invoices.filter((x) => x !== inv); save(); renderInvoices(); renderNav(); }
});
function printInvoice(inv) {
  const st = state.settings, c = state.clients.find((x) => x.id === inv.clientId) || {}, t = invoiceTotals(inv);
  $("#print-area").innerHTML = `<section class="slip"><div class="meta"><div><h2>${esc(st.agency || "Invoice")}</h2><div>${esc(st.address)}</div></div><div style="text-align:right"><b>${inv.gst ? "TAX INVOICE" : "INVOICE"}</b><br>${esc(inv.no)}<br>${dmy(inv.date)}</div></div>
    <p><b>Bill to:</b> ${esc(c.name)}<br>${esc(c.address)}${c.gstin ? `<br>GSTIN: ${esc(c.gstin)}` : ""}</p>
    <table><tr><th>#</th><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>${inv.items.map((it, k) => `<tr><td>${k + 1}</td><td>${esc(it.desc)}</td><td>${it.qty}</td><td>${inr2(it.rate)}</td><td>${inr2(num(it.qty) * num(it.rate))}</td></tr>`).join("")}
    <tr><td colspan="4">Subtotal</td><td>${inr2(t.subtotal)}</td></tr>${inv.gst ? `<tr><td colspan="4">CGST ${inv.gstRate / 2}%</td><td>${inr2(t.gst / 2)}</td></tr><tr><td colspan="4">SGST ${inv.gstRate / 2}%</td><td>${inr2(t.gst / 2)}</td></tr>` : ""}
    <tr class="total"><td colspan="4">TOTAL</td><td>${inr2(t.total)}</td></tr></table>
    <p>Rupees ${inWords(t.total)} only.${inv.due ? ` Due by ${dmy(inv.due)}.` : ""}</p>${st.bankLine ? `<p><b>Pay to:</b> ${esc(st.bankLine)}</p>` : ""}
    <div class="sign"><span></span><span>For ${esc(st.agency || "")}<br><br>Authorised signatory</span></div></section>`;
  window.print();
}

/* ============ cash book ============ */
function renderCash() {
  $("#cash-month").textContent = monthLabel(M());
  if (!inMonth($("#c-date").value)) $("#c-date").value = inMonth(today()) ? today() : M() + "-01";
  const keep = $("#c-bank").value; $("#c-bank").innerHTML = bankOptions(keep);
  const rows = state.cash.filter((e) => inMonth(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  $("#cash-table tbody").innerHTML = rows.map((e) => `<tr><td>${dmy(e.date)}</td><td><b>${esc(e.category)}</b></td><td>${esc(e.note)}</td><td>${esc(bankName(e.bankId))}</td>
    <td class="inc">${e.type === "income" ? inr2(e.amount) : ""}</td><td class="exp">${e.type !== "income" ? inr2(e.amount) : ""}</td><td><button class="icon-btn del" data-cdel="${e.id}" aria-label="Delete">✕</button></td></tr>`).join("") ||
    `<tr><td colspan="7" class="empty">No entries for ${monthLabel(M())} yet.</td></tr>`;
  const p = monthPL();
  kpis("#cash-stats", [["Income", inr(p.income), "good", `incl. ${inr(p.invoiceIn)} from invoices`], ["Expenses", inr(p.expense), "", `incl. ${inr(p.recurringPaid)} recurring`], ["Salaries", inr(p.salaries)], ["Profit / loss", inr(p.profit), p.profit >= 0 ? "good" : "bad"]]);
  const c = cashSummary(state.cash, M());
  $("#cash-cats").innerHTML = Object.entries(c.byCategory).sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense)).map(([k, v]) => `<div class="tile"><h3>${esc(k)}</h3><b class="${v.income ? "" : "neg"}">${v.income ? "+" + inr(v.income) : "−" + inr(v.expense)}</b></div>`).join("") || `<p class="empty">Nothing yet.</p>`;
  $("#cat-list").innerHTML = [...new Set(["Sales", "Rent", "Electricity", "Stock purchase", "Transport", "Internet & phone", "Repairs", "Taxes", "Food", ...state.cash.map((e) => e.category)])].map((k) => `<option>${esc(k)}</option>`).join("");
}
RENDER.cash = renderCash;
function monthPL(month = M()) {
  const c = cashSummary(state.cash, month);
  const invoiceIn = state.invoices.flatMap((i) => i.payments || []).filter((p) => String(p.date).startsWith(month)).reduce((s, p) => s + num(p.amount), 0);
  const salaries = state.guards.reduce((s, g) => { const r = computePay(g, { ...(state.entries[month]?.[g.id] || {}), advance: num(state.entries[month]?.[g.id]?.advance) + loggedAdvance(g.id, month) }, { ...state.settings, month }); return s + Math.max(0, r.net) + r.advance; }, 0);
  const loanOut = state.loans.flatMap((l) => l.payments || []).filter((p) => String(p.date).startsWith(month)).reduce((s, p) => s + num(p.amount), 0);
  const recurringPaid = state.cash.filter((e) => e.recurringId && String(e.date).startsWith(month)).reduce((s, e) => s + num(e.amount), 0);
  const income = c.income + invoiceIn, expense = c.expense + loanOut;
  return { income, invoiceIn, expense, salaries, recurringPaid, profit: income - expense - salaries };
}
$("#cash-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const amount = Number($("#c-amount").value); if (!amount) return toast("Enter an amount");
  state.cash.push({ id: uid(), date: $("#c-date").value, type: $("#c-type").value, category: $("#c-cat").value.trim(), note: $("#c-note").value.trim(), bankId: $("#c-bank").value, amount });
  save(); $("#c-amount").value = ""; $("#c-note").value = "";
  if (!inMonth($("#c-date").value)) toast("Saved — that date is in another month");
  renderCash(); $("#c-cat").focus();
});
$("#cash-table").addEventListener("click", (e) => { const id = e.target.dataset?.cdel; if (!id || !confirm("Delete this entry?")) return; state.cash = state.cash.filter((x) => x.id !== id); save(); renderCash(); });
$("#btn-cash-csv").addEventListener("click", () => {
  const rows = state.cash.filter((e) => inMonth(e.date)).sort((a, b) => a.date.localeCompare(b.date)), p = monthPL();
  download(`cash-book-${M()}.csv`, toCSV([["Date", "Type", "Category", "Note", "Account", "Amount"], ...rows.map((e) => [e.date, e.type, e.category, e.note, bankName(e.bankId), e.amount]), [],
    ["", "", "", "", "Income (incl. invoices)", p.income], ["", "", "", "", "Expenses (incl. EMIs)", p.expense], ["", "", "", "", "Salaries", p.salaries], ["", "", "", "", "Profit / loss", p.profit]]));
});

/* ============ recurring ============ */
function upcoming(fromDate = today()) {
  return state.recurring.map((r) => {
    const due = nextDue(r.dueDay, fromDate), month = due.slice(0, 7);
    const days = Math.round((new Date(due) - new Date(fromDate)) / 864e5);
    return { r, due, days, paid: !!r.paid?.[month] };
  }).sort((a, b) => a.due.localeCompare(b.due));
}
function renderRecurring() {
  $("#rec-title").textContent = `Every month · ${monthLabel(M())}`;
  const list = [...state.recurring].sort((a, b) => num(a.dueDay) - num(b.dueDay));
  $("#rec-table tbody").innerHTML = list.map((r) => {
    const paid = r.paid?.[M()], cash = paid && state.cash.find((c) => c.id === paid);
    return `<tr><td class="num">${String(r.dueDay).padStart(2, "0")}</td><td><b>${esc(r.name)}</b>${r.note ? `<small>${esc(r.note)}</small>` : ""}</td><td>${esc(r.category)}</td><td>${esc(bankName(r.bankId))}</td><td class="n">${inr(r.amount)}</td>
      <td>${paid ? `<span class="pill paid">Paid ${dmy(cash?.date)}</span> <button class="icon-btn" data-unpay="${r.id}" title="Undo">↺</button>` : `<button class="icon-btn" data-pay="${r.id}">Mark paid</button>`}</td>
      <td><button class="icon-btn" data-edit="${r.id}">Edit</button><button class="icon-btn del" data-del="${r.id}" aria-label="Delete">✕</button></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">Add rent, subscriptions, EMIs or SIPs you pay every month.</td></tr>`;
  const total = state.recurring.reduce((s, r) => s + num(r.amount), 0), paid = state.recurring.filter((r) => r.paid?.[M()]).reduce((s, r) => s + num(r.amount), 0);
  const nx = upcoming().find((u) => !u.paid);
  kpis("#rec-kpis", [["Every month", inr(total)], [`Paid in ${monthLabel(M()).split(" ")[0]}`, inr(paid), "good"], ["Still due", inr(total - paid), total - paid > 0 ? "warn" : "good"], ["Next", nx ? dmy(nx.due) : "—", nx && nx.days <= 3 ? "bad" : "", nx ? `${nx.r.name} · ${inr(nx.r.amount)}` : ""]]);
}
RENDER.recurring = renderRecurring;
function recurringForm(r = {}) {
  openForm(r.id ? "Edit recurring payment" : "Add recurring payment", [
    { k: "name", label: "Name", req: true, ph: "Shop rent", full: true }, { k: "category", label: "Category", def: "Rent", list: "cat-list" },
    { k: "amount", label: "Amount ₹", type: "number", req: true }, { k: "dueDay", label: "Due day of month (1–31)", type: "number", def: 5, req: true },
    { k: "bankId", label: "Usually paid from", type: "select", options: [["", "Cash / not linked"], ...state.banks.map((b) => [b.id, b.name])] },
    { k: "note", label: "Note", full: true, ph: "Optional" },
  ], r, (v) => { v.dueDay = Math.min(31, Math.max(1, Math.round(v.dueDay) || 1)); if (r.id) Object.assign(r, v); else state.recurring.push({ id: uid(), paid: {}, ...v }); save(); renderRecurring(); renderNav(); });
}
$("#btn-add-rec").addEventListener("click", () => recurringForm());
$("#rec-table").addEventListener("click", (e) => {
  const d = e.target.dataset, r = state.recurring.find((x) => x.id === (d.edit || d.del || d.pay || d.unpay)); if (!r) return;
  if (d.edit) return recurringForm(r);
  if (d.pay) return openForm(`Pay ${r.name}`, [
    { k: "date", label: "Paid on", type: "date", def: inMonth(today()) ? today() : `${M()}-${String(Math.min(r.dueDay, daysInMonth(M()))).padStart(2, "0")}`, req: true },
    { k: "amount", label: "Amount ₹", type: "number", def: r.amount, req: true }, { k: "bankId", label: "Paid from", type: "select", def: r.bankId, options: [["", "Cash / not linked"], ...state.banks.map((b) => [b.id, b.name])] },
  ], {}, (v) => { const id = uid(); state.cash.push({ id, date: v.date, type: "expense", category: r.category || "Recurring", note: r.name, bankId: v.bankId, amount: v.amount, recurringId: r.id }); r.paid ??= {}; r.paid[M()] = id; save(); renderRecurring(); renderNav(); toast(`${r.name} paid — added to the cash book`); }, "Mark paid");
  if (d.unpay) { const cid = r.paid[M()]; state.cash = state.cash.filter((c) => c.id !== cid); delete r.paid[M()]; save(); renderRecurring(); renderNav(); }
  if (d.del && confirm(`Delete ${r.name}? Past payments stay in the cash book.`)) { state.recurring = state.recurring.filter((x) => x !== r); save(); renderRecurring(); renderNav(); }
});

/* ============ banks & loans ============ */
function balances() {
  return bankBalances({
    banks: state.banks, cash: state.cash, transfers: state.transfers,
    invoicePayments: state.invoices.flatMap((i) => i.payments || []),
    salaryPayments: Object.values(state.salaryPaid).flatMap((m) => Object.values(m)),
    advances: state.advances, loanPayments: state.loans.flatMap((l) => l.payments || []),
  });
}
function movements() {
  const mv = [];
  for (const c of state.cash) mv.push({ date: c.date, bankId: c.bankId, what: `${c.category}${c.note ? " · " + c.note : ""}`, amt: c.type === "income" ? num(c.amount) : -num(c.amount) });
  for (const i of state.invoices) for (const p of i.payments || []) mv.push({ date: p.date, bankId: p.bankId, what: `Invoice ${i.no} · ${clientName(i.clientId)}`, amt: num(p.amount) });
  for (const [m, rec] of Object.entries(state.salaryPaid)) for (const [gid, p] of Object.entries(rec)) mv.push({ date: p.date, bankId: p.bankId, what: `Salary ${monthLabel(m)} · ${staffName(gid)}`, amt: -num(p.amount) });
  for (const a of state.advances) mv.push({ date: a.date, bankId: a.bankId, what: `Advance · ${staffName(a.staffId)}`, amt: -num(a.amount) });
  for (const l of state.loans) for (const p of l.payments || []) mv.push({ date: p.date, bankId: p.bankId, what: `EMI · ${l.name}`, amt: -num(p.amount) });
  for (const t of state.transfers) { mv.push({ date: t.date, bankId: t.from, what: `Transfer to ${bankName(t.to)}`, amt: -num(t.amount) }); mv.push({ date: t.date, bankId: t.to, what: `Transfer from ${bankName(t.from)}`, amt: num(t.amount) }); }
  return mv.filter((m) => m.bankId).sort((a, b) => b.date.localeCompare(a.date));
}
const loanPaid = (l) => (l.payments || []).reduce((s, p) => s + num(p.amount), 0);
const loanOutstanding = (l) => Math.max(0, num(l.outstanding) - (l.payments || []).filter((p) => !l.since || p.date >= l.since).reduce((s, p) => s + num(p.amount), 0));
function renderBanks() {
  const bal = balances(), total = Object.values(bal).reduce((s, v) => s + v, 0);
  $("#bank-tiles").innerHTML = state.banks.map((b) => `<div class="tile"><h3>${esc(b.name)}<span><button class="icon-btn" data-bedit="${b.id}">Edit</button></span></h3><b class="${bal[b.id] < 0 ? "neg" : ""}">${inr2(bal[b.id])}</b><p>${esc(b.accountNo || "")} · opening ${inr(b.opening || 0)}</p></div>`).join("") || `<p class="empty">Add your bank accounts (and a "Cash in hand" account if you like).</p>`;
  $("#loan-table tbody").innerHTML = state.loans.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.lender)}</td><td class="num">${l.dueDay || "—"}</td><td class="n">${inr(l.emi || 0)}</td><td class="n">${inr(loanPaid(l))}</td><td class="n">${inr(loanOutstanding(l))}</td>
    <td><button class="icon-btn" data-lpay="${l.id}">Pay EMI</button><button class="icon-btn" data-ledit="${l.id}">Edit</button><button class="icon-btn del" data-ldel="${l.id}" aria-label="Delete">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No loans.</td></tr>`;
  $("#move-table tbody").innerHTML = movements().slice(0, 40).map((m) => `<tr><td>${dmy(m.date)}</td><td>${esc(bankName(m.bankId))}</td><td>${esc(m.what)}</td><td class="inc">${m.amt > 0 ? inr2(m.amt) : ""}</td><td class="exp">${m.amt < 0 ? inr2(-m.amt) : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Payments linked to an account show up here.</td></tr>`;
  const debt = state.loans.reduce((s, l) => s + loanOutstanding(l), 0);
  kpis("#bank-kpis", [["Total in banks", inr2(total), total >= 0 ? "good" : "bad"], ["Accounts", state.banks.length], ["Loans outstanding", inr(debt), debt ? "warn" : ""], ["Monthly EMIs", inr(state.loans.reduce((s, l) => s + num(l.emi), 0))]]);
}
RENDER.banks = renderBanks;
function bankForm(b = {}) {
  openForm(b.id ? `Edit ${b.name}` : "Add account", [{ k: "name", label: "Account name", req: true, ph: "SBI current / Cash in hand", full: true }, { k: "accountNo", label: "Account no. (optional)" }, { k: "opening", label: "Opening balance ₹", type: "number", def: 0 }],
    b, (v) => { if (b.id) Object.assign(b, v); else state.banks.push({ id: uid(), ...v }); save(); renderBanks(); });
}
$("#btn-add-bank").addEventListener("click", () => bankForm());
$("#bank-tiles").addEventListener("click", (e) => { const b = state.banks.find((x) => x.id === e.target.dataset.bedit); if (b) bankForm(b); });
$("#btn-transfer").addEventListener("click", () => {
  if (state.banks.length < 2) return toast("Add at least two accounts first");
  const opts = state.banks.map((b) => [b.id, b.name]);
  openForm("Transfer between accounts", [{ k: "from", label: "From", type: "select", options: opts }, { k: "to", label: "To", type: "select", options: opts, def: opts[1][0] }, { k: "amount", label: "Amount ₹", type: "number", req: true }, { k: "date", label: "Date", type: "date", def: today(), req: true }, { k: "note", label: "Note", full: true }],
    {}, (v) => { if (v.from === v.to) return toast("Pick two different accounts"); state.transfers.push({ id: uid(), ...v }); save(); renderBanks(); toast("Transfer saved"); }, "Transfer");
});
$("#btn-adjust").addEventListener("click", () => {
  if (!state.banks.length) return toast("Add an account first");
  const bal = balances();
  openForm("Match the app to your bank", [{ k: "bankId", label: "Account", type: "select", options: state.banks.map((b) => [b.id, `${b.name} (app: ${inr2(bal[b.id])})`]) }, { k: "actual", label: "Actual balance in your bank ₹", type: "number", req: true }],
    {}, (v) => { const diff = Math.round((v.actual - bal[v.bankId]) * 100) / 100; if (!diff) return toast("Already matches");
      state.cash.push({ id: uid(), date: today(), type: diff > 0 ? "income" : "expense", category: "Balance adjustment", note: "Matched to bank statement", bankId: v.bankId, amount: Math.abs(diff) });
      save(); renderBanks(); toast(`Adjusted by ${diff > 0 ? "+" : "−"}${inr2(Math.abs(diff))}`); }, "Adjust");
});
function loanForm(l = {}) {
  openForm(l.id ? `Edit ${l.name}` : "Add loan", [{ k: "name", label: "Loan name", req: true, ph: "Car loan", full: true }, { k: "lender", label: "Lender" }, { k: "emi", label: "EMI ₹", type: "number" },
    { k: "dueDay", label: "EMI day of month", type: "number" }, { k: "outstanding", label: "Outstanding today ₹", type: "number", req: true }],
    l, (v) => { if (l.id) Object.assign(l, v, { since: today() }); else state.loans.push({ id: uid(), payments: [], since: today(), ...v }); save(); renderBanks(); });
}
$("#btn-add-loan").addEventListener("click", () => loanForm());
$("#loan-table").addEventListener("click", (e) => {
  const d = e.target.dataset, l = state.loans.find((x) => x.id === (d.lpay || d.ledit || d.ldel)); if (!l) return;
  if (d.ledit) return loanForm(l);
  if (d.lpay) return openForm(`Pay EMI · ${l.name}`, [{ k: "date", label: "Paid on", type: "date", def: today(), req: true }, { k: "amount", label: "Amount ₹", type: "number", def: l.emi, req: true }, { k: "bankId", label: "Paid from", type: "select", options: [["", "Cash / not linked"], ...state.banks.map((b) => [b.id, b.name])] }],
    {}, (v) => { l.payments ??= []; l.payments.push({ id: uid(), ...v }); save(); renderBanks(); toast("EMI recorded"); }, "Save");
  if (d.ldel && confirm(`Delete ${l.name}?`)) { state.loans = state.loans.filter((x) => x !== l); save(); renderBanks(); }
});

/* ============ dashboard ============ */
function renderDashboard() {
  const p = monthPL(), bal = balances(), total = Object.values(bal).reduce((s, v) => s + v, 0);
  const out = state.invoices.map(invoiceTotals).reduce((s, t) => s + t.balance, 0);
  const rs = results(), toPay = rs.filter((x) => x.r.net > 0 && !paidInfo(x.g.id)).reduce((s, x) => s + x.r.net, 0);
  $("#dash-sub").textContent = `${state.settings.agency || "Your business"} · ${monthLabel(M())}`;
  kpis("#dash-kpis", [["Money in banks", inr2(total), total >= 0 ? "good" : "bad"], ["Clients owe you", inr(out), out ? "warn" : ""], ["Salaries to pay", inr(toPay), toPay ? "warn" : "good"], [`Profit · ${monthLabel(M()).split(" ")[0]}`, inr(p.profit), p.profit >= 0 ? "good" : "bad"]]);
  $("#dash-banks").innerHTML = state.banks.length ? `<div class="rows">${state.banks.map((b) => `<div class="r"><span>${esc(b.name)}</span><b class="${bal[b.id] < 0 ? "neg" : ""}">${inr2(bal[b.id])}</b></div>`).join("")}</div>` : `<p class="empty">No accounts yet.</p>`;
  const up = upcoming().filter((u) => !u.paid).slice(0, 6);
  $("#dash-due").innerHTML = up.length ? `<div class="rows">${up.map((u) => `<div class="r"><span>${dmy(u.due)} · ${esc(u.r.name)} ${u.days <= 1 ? `<span class="pill due">${u.days ? "Tomorrow" : "Today"}</span>` : u.days <= 3 ? `<span class="pill partial">${u.days} days</span>` : ""}</span><b>${inr(u.r.amount)}</b></div>`).join("")}</div>` : `<p class="empty">Nothing due.</p>`;
  const open = state.invoices.map((i) => ({ i, t: invoiceTotals(i) })).filter((x) => x.t.balance > 0).sort((a, b) => a.i.date.localeCompare(b.i.date)).slice(0, 6);
  $("#dash-recv").innerHTML = open.length ? `<div class="rows">${open.map(({ i, t }) => `<div class="r"><span>${esc(i.no)} · ${esc(clientName(i.clientId))}</span><b>${inr(t.balance)}</b></div>`).join("")}</div>` : `<p class="empty">All invoices paid.</p>`;
  $("#dash-month").innerHTML = `<div class="rows"><div class="r"><span>Income (incl. invoices)</span><b class="inc">${inr(p.income)}</b></div><div class="r"><span>Expenses (incl. EMIs)</span><b>${inr(p.expense)}</b></div><div class="r"><span>Salaries (net + advances)</span><b>${inr(p.salaries)}</b></div><div class="r"><span><b>Profit / loss</b></span><b class="${p.profit < 0 ? "neg" : "inc"}">${inr(p.profit)}</b></div></div>`;
}
RENDER.dashboard = renderDashboard;

/* ============ backup / sample ============ */
$("#btn-backup").addEventListener("click", () => download(`accounts-manager-backup-${today()}.json`, JSON.stringify(state, null, 1), "application/json"));
$("#file-restore").addEventListener("change", async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try { const s = JSON.parse((await f.text()).replace(/^﻿/, "")); if (!s.settings || !Array.isArray(s.guards)) throw 0; const b = blank(); state = { ...b, ...s, settings: { ...b.settings, ...s.settings } }; save(); renderAll(); toast("Backup restored"); }
  catch { toast("That file isn't an Accounts Manager backup"); }
  ev.target.value = "";
});
$("#btn-clear").addEventListener("click", () => { if (!confirm("Delete ALL data from this browser? Make a Backup first if you need it.")) return; state = blank(); save(); renderAll(); showTab("settings"); toast("Cleared"); });
$("#btn-sample").addEventListener("click", () => { if ((state.guards.length || state.invoices.length) && !confirm("Replace your current data with sample data?")) return; state = sample(); save(); renderAll(); showTab("dashboard"); toast("Sample data loaded — explore the menu"); });

function sample() {
  const s = blank(), m = "2026-10";
  s.settings = { ...s.settings, agency: "Sample Traders", address: "MG Road, Kochi, Kerala · GSTIN 32ABCDE1234F1Z5", month: m, specialRate: 500, messRate: 100, prefix: "ST-", nextInv: 5, bankLine: "Federal Bank A/c XXXXXX4521 · IFSC FDRL000XXXX · UPI sampletraders@upi" };
  s.banks = [{ id: "b1", name: "Current account", accountNo: "XXXXXX4521", opening: 240000 }, { id: "b2", name: "Savings", accountNo: "XXXXXX8890", opening: 85000 }, { id: "b3", name: "Cash in hand", accountNo: "", opening: 12000 }];
  const G = [["Rajesh K", "Main shop", 15500, 31, 2, 26], ["Suresh P", "Main shop", 15500, 30, 0, 30], ["Anitha M", "Billing", 14000, 26, 0, 0], ["Biju Thomas", "Billing", 14000, 30, 1, 0],
    ["Manoj V", "Warehouse", 15500, 27, 0, 0], ["Sreeja R", "Warehouse", 15500, 20, 0, 0], ["Vinod Kumar", "Delivery", 20000, 23, 3, 23], ["Joseph Mathew", "Delivery", 20000, 12, 0, 12]];
  s.guards = G.map(([name, site, salary], i) => ({ id: "g" + i, name, site, salary, bank: i % 2 ? "Federal Bank" : "State Bank of India", account: "XXXXXXXX" + (1200 + i * 37), ifsc: i % 2 ? "FDRL000XXXX" : "SBIN000XXXX", upi: i === 5 ? "sreeja@upi" : "", phone: "" }));
  s.entries[m] = Object.fromEntries(G.map(([, , , d, sp, mess], i) => ["g" + i, { duties: d, specialDuties: sp || "", specialRate: 500, bonus: "", advance: "", messDays: mess || "", messRate: 100, uniform: i === 6 ? 1000 : "", other: "" }]));
  s.advances = [["g0", "2026-10-08", 2000, "b3"], ["g0", "2026-10-22", 2000, "b1"], ["g2", "2026-10-15", 2000, "b3"], ["g3", "2026-10-22", 3000, "b1"], ["g4", "2026-10-10", 5000, "b1"], ["g6", "2026-10-18", 3000, "b1"], ["g7", "2026-10-05", 6000, "b1"]]
    .map(([staffId, date, amount, bankId], i) => ({ id: "a" + i, staffId, date, amount, bankId, note: "" }));
  s.salaryPaid[m] = { g1: { date: "2026-11-02", bankId: "b1", amount: 12000 }, g5: { date: "2026-11-02", bankId: "b1", amount: 10000 } };
  s.clients = [{ id: "c1", name: "Harbour View Hotel", contact: "Anil (Purchase)", phone: "", email: "", gstin: "32AAACH0000A1Z1", address: "Marine Drive, Kochi", rate: 0, gst: true },
    { id: "c2", name: "St. Mary's School", contact: "Principal", phone: "", email: "", gstin: "", address: "Ernakulam", rate: 0, gst: false },
    { id: "c3", name: "Coastal Chemicals Pvt Ltd", contact: "Accounts", phone: "", email: "", gstin: "32AAECC0000B1Z2", address: "Eloor, Kochi", rate: 0, gst: true }];
  s.invoices = [
    { id: "i1", no: "ST-001", clientId: "c1", date: "2026-10-03", due: "2026-10-18", gst: true, gstRate: 18, items: [{ desc: "Bulk supply — September", qty: 1, rate: 86000 }], payments: [{ id: "p1", date: "2026-10-16", amount: 101480, tds: 0, bankId: "b1" }] },
    { id: "i2", no: "ST-002", clientId: "c2", date: "2026-10-10", due: "2026-10-25", gst: false, gstRate: 18, items: [{ desc: "Stationery kits", qty: 120, rate: 240 }], payments: [{ id: "p2", date: "2026-10-28", amount: 15000, tds: 0, bankId: "b2" }] },
    { id: "i3", no: "ST-003", clientId: "c3", date: "2026-10-20", due: "2026-11-04", gst: true, gstRate: 18, items: [{ desc: "Packing material", qty: 400, rate: 95 }, { desc: "Delivery charges", qty: 1, rate: 2500 }], payments: [] },
    { id: "i4", no: "ST-004", clientId: "c1", date: "2026-10-31", due: "2026-11-15", gst: true, gstRate: 18, items: [{ desc: "Bulk supply — October", qty: 1, rate: 92000 }], payments: [] }];
  s.recurring = [["Shop rent", "Rent", 35000, 5, "b1"], ["Godown rent", "Rent", 12000, 7, "b1"], ["Electricity (avg)", "Electricity", 6800, 12, "b1"], ["Internet & phone", "Internet & phone", 1499, 15, "b2"], ["Accounting software", "Subscriptions", 999, 20, "b2"]]
    .map(([name, category, amount, dueDay, bankId], i) => ({ id: "r" + i, name, category, amount, dueDay, bankId, note: "", paid: {} }));
  s.cash = [["2026-10-02", "income", "Sales", "Week 1 counter sales", "b3", 182000], ["2026-10-07", "expense", "Stock purchase", "Wholesale order", "b1", 96000], ["2026-10-09", "income", "Sales", "Week 2 counter sales", "b1", 171500],
    ["2026-10-16", "income", "Sales", "Week 3 counter sales", "b1", 165200], ["2026-10-18", "expense", "Transport", "Diesel for van", "b3", 9200], ["2026-10-23", "income", "Sales", "Week 4 counter sales", "b3", 190300], ["2026-10-25", "expense", "Stock purchase", "Wholesale order", "b1", 104000]]
    .map(([date, type, category, note, bankId, amount], i) => ({ id: "c" + i, date, type, category, note, bankId, amount }));
  for (const [ri, date] of [[0, "2026-10-05"], [1, "2026-10-07"], [2, "2026-10-12"], [3, "2026-10-15"]]) {
    const r = s.recurring[ri], id = "rc" + ri; s.cash.push({ id, date, type: "expense", category: r.category, note: r.name, bankId: r.bankId, amount: r.amount, recurringId: r.id }); r.paid[m] = id;
  }
  s.transfers = [{ id: "t1", date: "2026-10-24", from: "b3", to: "b1", amount: 150000, note: "Cash deposit" }];
  s.loans = [{ id: "l1", name: "Delivery van loan", lender: "HDFC Bank", emi: 18500, dueDay: 10, outstanding: 412000, since: "2026-10-01", payments: [{ id: "lp1", date: "2026-10-10", amount: 18500, bankId: "b1" }] }];
  return s;
}

function renderAll() { renderSettings(); renderGuards(); RENDER[current]?.(); renderNav(); }
renderSettings(); renderGuards(); renderNav();
showTab(state.guards.length || state.invoices.length ? "dashboard" : "settings");
