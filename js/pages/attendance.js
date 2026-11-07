// Attendance and pay inputs. The daily grid fills in days worked, and the pay sheet takes everything else.
import { daysInMonth, monthLabel } from "../core/dates.js";
import { num } from "../core/money.js";
import { ATTENDANCE_MARKS, attendanceSummary, effectiveDays, fullMonthDays, payFor } from "../core/payroll.js";
import { $, $$, html, on, raw, setHTML } from "../ui/dom.js";
import { icon } from "../ui/icons.js";
import { emptyState } from "../ui/table.js";
import { toast } from "../ui/toast.js";
import { pageHead } from "./_common.js";

const CYCLE = ["", "P", "H", "L", "A"];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TEAM_KEY = "accounts-manager:attendance-team";

const pad = (n) => String(n).padStart(2, "0");
const activeStaff = (state, team) => state.staff.filter((s) => s.active !== false && (!team || s.team === team));
const teamsOf = (state) => [...new Set(state.staff.filter((s) => s.active !== false).map((s) => s.team).filter(Boolean))].sort();
const getTeam = () => { try { return sessionStorage.getItem(TEAM_KEY) || ""; } catch { return ""; } };
const setTeam = (t) => { try { sessionStorage.setItem(TEAM_KEY, t); } catch { /* not important */ } };

function dayInfo(month, d) {
  const [y, m] = month.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return { weekday, letter: WEEKDAYS[weekday], name: WEEKDAY_NAMES[weekday], isSunday: weekday === 0 };
}

function cellLabel(person, month, d, mark) {
  const { name } = dayInfo(month, d);
  return `${person.name}, ${name} ${d}: ${mark ? ATTENDANCE_MARKS[mark].label : "not marked"}`;
}

function teamSelect(state, team) {
  const teams = teamsOf(state);
  if (!teams.length) return "";
  return html`
    <label class="sr-only" for="att-team">Team</label>
    <select class="input fit" id="att-team" data-team>
      <option value="">All teams</option>
      ${teams.map((t) => html`<option value="${t}" ${t === team ? raw("selected") : ""}>${t}</option>`)}
    </select>`;
}

/** Days worked as it should read in the totals column. */
function daysCell(state, person, month) {
  const entry = state.entries[month]?.[person.id];
  const { days, source } = effectiveDays(entry, state.attendance[month]?.[person.id], state.settings.pay);
  return source === "manual" ? html`${days}<span class="cell-sub" title="A figure typed on the pay sheet overrides these marks">typed</span>` : html`${days}`;
}

function renderGrid(host, ctx) {
  const state = ctx.state();
  const month = state.settings.month;
  const team = getTeam();
  const people = activeStaff(state, team);
  const total = daysInMonth(month);
  const days = Array.from({ length: total }, (_, i) => i + 1);
  const today = ctx.today();

  if (!state.staff.length) {
    setHTML(host, html`<section class="card">${emptyState({ icon: "users", title: "Add staff first", hint: "Once you have staff, you can mark their attendance here.", action: html`<a class="btn btn-primary" href="#/staff">${icon("plus")}Go to Staff</a>` })}</section>`);
    return;
  }

  setHTML(host, html`
    <section class="card card-flush">
      <div class="toolbar">
        ${teamSelect(state, team)}
        <button type="button" class="btn" data-fill>Mark unmarked days present</button>
        ${today.startsWith(month) ? html`<button type="button" class="btn" data-today>Mark today present</button>` : ""}
        <span class="grow"></span>
        <span class="att-legend small muted" aria-hidden="true">
          ${Object.entries(ATTENDANCE_MARKS).map(([k, m]) => html`<span><span class="att-chip att-${k}">${k}</span> ${m.label}</span>`)}
        </span>
      </div>
      <div class="table-wrap att-desktop" role="region" aria-label="Attendance for ${monthLabel(month)}" tabindex="0">
        <table class="att-table" role="grid" aria-label="Attendance grid. Use the arrow keys to move, and P, H, L or A to mark.">
          <thead>
            <tr>
              <th scope="col" class="att-name">Staff</th>
              ${days.map((d) => { const i = dayInfo(month, d); return html`<th scope="col" class="att-day ${i.isSunday ? "att-sun" : ""} ${`${month}-${pad(d)}` === today ? "att-today" : ""}" title="${i.name} ${d}"><span class="att-num">${d}</span><span class="att-wd" aria-hidden="true">${i.letter}</span></th>`; })}
              <th scope="col" class="att-total">Days</th>
            </tr>
          </thead>
          <tbody>
            ${people.map((p, row) => {
              const marks = state.attendance[month]?.[p.id] || {};
              return html`<tr data-staff="${p.id}">
                <th scope="row" class="att-name"><a href="#/staff/${p.id}">${p.name || "(no name)"}</a><span class="cell-sub">${p.team}</span></th>
                ${days.map((d, col) => { const mark = marks[pad(d)] || ""; return html`<td class="${dayInfo(month, d).isSunday ? "att-sun" : ""}"><button type="button" class="att-cell ${mark ? `att-${mark}` : ""}" data-day="${d}" data-row="${row}" data-col="${col}" tabindex="${row === 0 && col === 0 ? 0 : -1}" aria-label="${cellLabel(p, month, d, mark)}">${mark}</button></td>`; })}
                <td class="att-total num" data-total>${daysCell(state, p, month)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <div class="att-phone" data-phone-view></div>
    </section>`);

  const write = (staffId, d, mark) => {
    ctx.store.update((s) => {
      s.attendance[month] ??= {};
      s.attendance[month][staffId] ??= {};
      if (mark) s.attendance[month][staffId][pad(d)] = mark;
      else delete s.attendance[month][staffId][pad(d)];
    }, "quiet");
  };
  const paintRow = (staffId) => {
    const s = ctx.state();
    const person = s.staff.find((x) => x.id === staffId);
    const row = host.querySelector(`tr[data-staff="${staffId}"]`);
    if (row) setHTML($("[data-total]", row), daysCell(s, person, month));
  };
  const setCell = (btn, mark) => {
    const staffId = btn.closest("tr").dataset.staff;
    const d = Number(btn.dataset.day);
    write(staffId, d, mark);
    btn.textContent = mark;
    btn.className = `att-cell ${mark ? `att-${mark}` : ""}`;
    const person = ctx.state().staff.find((x) => x.id === staffId);
    btn.setAttribute("aria-label", cellLabel(person, month, d, mark));
    paintRow(staffId);
  };
  const moveTo = (row, col) => {
    const target = host.querySelector(`.att-cell[data-row="${row}"][data-col="${col}"]`);
    if (!target) return;
    $$(".att-cell[tabindex='0']", host).forEach((b) => { b.tabIndex = -1; });
    target.tabIndex = 0;
    target.focus();
  };

  on(host, "click", ".att-cell", (e, btn) => {
    const current = btn.textContent.trim();
    setCell(btn, CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]);
  });
  on(host, "keydown", ".att-cell", (e, btn) => {
    const row = Number(btn.dataset.row), col = Number(btn.dataset.col);
    const key = e.key.toUpperCase();
    if (e.key === "ArrowRight") { e.preventDefault(); moveTo(row, col + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveTo(row, col - 1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveTo(row + 1, col); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(row - 1, col); }
    else if (key in ATTENDANCE_MARKS && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setCell(btn, key); moveTo(row, col + 1); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); setCell(btn, ""); }
  });
  on(host, "change", "[data-team]", (e, el) => { setTeam(el.value); renderTab(host.parentElement, ctx, "grid"); });

  const fill = (dayNumbers, message) => {
    const before = structuredClone(ctx.state().attendance[month] || {});
    let changed = 0;
    ctx.store.update((s) => {
      s.attendance[month] ??= {};
      for (const p of activeStaff(s, team)) {
        s.attendance[month][p.id] ??= {};
        for (const d of dayNumbers) if (!s.attendance[month][p.id][pad(d)]) { s.attendance[month][p.id][pad(d)] = "P"; changed++; }
      }
    });
    toast(changed ? `${message}: ${changed} ${changed === 1 ? "day" : "days"} marked` : "Everything is already marked", changed ? {
      action: { label: "Undo", onClick: () => ctx.store.update((s) => { s.attendance[month] = before; }) }, duration: 8000,
    } : { kind: "info" });
  };
  on(host, "click", "[data-fill]", () => fill(days, "Marked present"));
  on(host, "click", "[data-today]", () => fill([Number(today.slice(8))], "Marked today"));

  renderPhone($("[data-phone-view]", host), ctx, people, month, write);
}

/** Phones show one person at a time as a small calendar. */
function renderPhone(host, ctx, people, month, write) {
  const total = daysInMonth(month);
  let index = 0;
  const firstWeekday = dayInfo(month, 1).weekday;
  const paint = () => {
    if (!people.length) { setHTML(host, ""); return; }
    const state = ctx.state();
    const p = people[index];
    const marks = state.attendance[month]?.[p.id] || {};
    const summary = attendanceSummary(marks, state.settings.pay);
    const { days, source } = effectiveDays(state.entries[month]?.[p.id], marks, state.settings.pay);
    setHTML(host, html`
      <div class="att-person">
        <button type="button" class="icon-btn" data-person-step="-1" aria-label="Previous person" ${index === 0 ? raw("disabled") : ""}>${icon("chevron-left")}</button>
        <div class="grow text-center"><div class="strong">${p.name || "(no name)"}</div><div class="small muted">${index + 1} of ${people.length} · ${days} days${source === "manual" ? " (typed)" : ""}</div></div>
        <button type="button" class="icon-btn" data-person-step="1" aria-label="Next person" ${index === people.length - 1 ? raw("disabled") : ""}>${icon("chevron-right")}</button>
      </div>
      <div class="att-cal" role="group" aria-label="Attendance for ${p.name}">
        ${WEEKDAYS.map((w) => html`<span class="att-cal-head" aria-hidden="true">${w}</span>`)}
        ${Array.from({ length: firstWeekday }, () => html`<span></span>`)}
        ${Array.from({ length: total }, (_, i) => { const d = i + 1; const mark = marks[pad(d)] || ""; return html`<button type="button" class="att-cal-day ${mark ? `att-${mark}` : ""}" data-cal-day="${d}" aria-label="${cellLabel(p, month, d, mark)}"><span class="att-cal-num">${d}</span><span class="att-cal-mark">${mark}</span></button>`; })}
      </div>
      <p class="small muted att-cal-note">Tap a day to change it. Present ${summary.P}, half ${summary.H}, leave ${summary.L}, absent ${summary.A}.</p>`);
  };
  on(host, "click", "[data-person-step]", (e, b) => { index += Number(b.dataset.personStep); paint(); });
  on(host, "click", "[data-cal-day]", (e, b) => {
    const d = Number(b.dataset.calDay);
    const current = ctx.state().attendance[month]?.[people[index].id]?.[pad(d)] || "";
    write(people[index].id, d, CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]);
    paint();
    host.querySelector(`[data-cal-day="${d}"]`)?.focus();
  });
  paint();
}

const PAY_FIELDS = [
  ["daysWorked", "Days worked"], ["extraShifts", "Extra shifts"], ["extraRate", "Shift rate"], ["bonus", "Bonus"], ["advance", "Advance"],
  ["foodDays", "Food days"], ["foodRate", "Food rate"], ["kit", "Kit"], ["other", "Other cut"],
];

function renderPaySheet(host, ctx) {
  const state = ctx.state();
  const month = state.settings.month;
  const team = getTeam();
  const people = activeStaff(state, team);
  if (!state.staff.length) {
    setHTML(host, html`<section class="card">${emptyState({ icon: "users", title: "Add staff first", hint: "Once you have staff, you can fill in their pay here.", action: html`<a class="btn btn-primary" href="#/staff">${icon("plus")}Go to Staff</a>` })}</section>`);
    return;
  }
  const defaults = state.settings.pay;
  const valueFor = (p, key) => {
    const e = state.entries[month]?.[p.id];
    const v = e?.[key];
    if (v !== undefined && v !== "") return v;
    if (key === "extraRate") return defaults.extraRate || "";
    if (key === "foodRate") return defaults.foodRate || "";
    return "";
  };
  const placeholder = (p, key) => {
    if (key !== "daysWorked") return "";
    const s = attendanceSummary(state.attendance[month]?.[p.id], defaults);
    return s.marked ? String(s.days) : "";
  };
  setHTML(host, html`
    <section class="card card-flush">
      <div class="toolbar">
        ${teamSelect(state, team)}
        <button type="button" class="btn" data-fill-days>Fill full month</button>
        <span class="grow"></span>
        <span class="small muted">Advances from the Advances page are added automatically.</span>
      </div>
      <div class="table-wrap" role="region" aria-label="Pay sheet for ${monthLabel(month)}" tabindex="0">
        <table class="pay-sheet" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col" class="pay-name">Staff</th>
              ${PAY_FIELDS.map(([, label]) => html`<th role="columnheader" scope="col" class="col-num">${label}</th>`)}
              <th role="columnheader" scope="col" class="col-num pay-net">Net pay</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            ${people.map((p, row) => {
              const pay = payFor(state, p, month);
              const logged = pay.advance - num(state.entries[month]?.[p.id]?.advance);
              return html`<tr role="row" data-staff="${p.id}">
                <th role="rowheader" scope="row" class="pay-name"><a href="#/staff/${p.id}">${p.name || "(no name)"}</a><span class="cell-sub">${p.team ? `${p.team} · ` : ""}${ctx.money(p.salary || 0)}</span></th>
                ${PAY_FIELDS.map(([key, label], col) => html`
                  <td role="cell" data-label="${label}">
                    <input class="input input-num pay-input" inputmode="decimal" aria-label="${label} for ${p.name}" data-key="${key}" data-row="${row}" data-col="${col}" value="${valueFor(p, key)}" placeholder="${placeholder(p, key)}">
                    ${key === "advance" && logged ? html`<span class="cell-sub pay-logged">+${ctx.money(logged)} logged</span>` : ""}
                  </td>`)}
                <td role="cell" class="col-num pay-net" data-label="Net pay" data-net><span class="num ${pay.net < 0 ? "text-danger" : ""} strong">${ctx.money(pay.net)}</span></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </section>`);

  on(host, "input", ".pay-input", (e, input) => {
    const tr = input.closest("tr");
    const id = tr.dataset.staff;
    const clean = input.value.replace(/[,\s₹]/g, "");
    const value = clean === "" ? "" : Number(clean);
    if (clean !== "" && (!Number.isFinite(value) || value < 0)) { input.setAttribute("aria-invalid", "true"); return; }
    input.removeAttribute("aria-invalid");
    ctx.store.update((s) => {
      s.entries[month] ??= {};
      s.entries[month][id] ??= {};
      s.entries[month][id][input.dataset.key] = value;
    }, "quiet");
    const fresh = ctx.state();
    const pay = payFor(fresh, fresh.staff.find((x) => x.id === id), month);
    setHTML($("[data-net]", tr), html`<span class="num ${pay.net < 0 ? "text-danger" : ""} strong">${ctx.money(pay.net)}</span>`);
  });
  on(host, "keydown", ".pay-input", (e, input) => {
    const row = Number(input.dataset.row), col = Number(input.dataset.col);
    const go = (r) => host.querySelector(`.pay-input[data-row="${r}"][data-col="${col}"]`)?.focus();
    if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); go(row + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(row - 1); }
  });
  on(host, "focusin", ".pay-input", (e, input) => input.select());
  on(host, "change", "[data-team]", (e, el) => { setTeam(el.value); renderTab(host.parentElement, ctx, "pay"); });
  on(host, "click", "[data-fill-days]", () => {
    const s = ctx.state();
    const n = fullMonthDays(s.settings.pay.basis, month);
    let changed = 0;
    ctx.store.update((draft) => {
      draft.entries[month] ??= {};
      for (const p of activeStaff(draft, team)) {
        const e = draft.entries[month][p.id] ??= {};
        const hasMarks = attendanceSummary(draft.attendance[month]?.[p.id]).marked > 0;
        if ((e.daysWorked === "" || e.daysWorked == null) && !hasMarks) { e.daysWorked = n; changed++; }
      }
    });
    toast(changed ? `Filled ${n} days for ${changed} ${changed === 1 ? "person" : "people"}` : "Everyone already has days filled in", { kind: changed ? "success" : "info" });
  });
}

function renderTab(host, ctx, tab) {
  setHTML(host, html`<div data-tab-content></div>`);
  const content = $("[data-tab-content]", host);
  if (tab === "pay") renderPaySheet(content, ctx);
  else renderGrid(content, ctx);
}

export default {
  id: "attendance",
  title: "Attendance",
  render(root, ctx, params) {
    const tab = params[0] === "pay" ? "pay" : "grid";
    setHTML(root, html`
      <div class="page">
        ${pageHead({ title: tab === "pay" ? "Pay sheet" : "Attendance", sub: `${monthLabel(ctx.state().settings.month)}. ${tab === "pay" ? "Days and deductions for each person. Net pay updates as you type." : "Mark each day. Days worked feed into pay unless you type a figure on the pay sheet."}` })}
        <nav class="tabs" aria-label="Attendance sections">
          <a class="tab" href="#/attendance" ${tab === "grid" ? raw('aria-current="page"') : ""}>Daily attendance</a>
          <a class="tab" href="#/attendance/pay" ${tab === "pay" ? raw('aria-current="page"') : ""}>Pay sheet</a>
        </nav>
        <div data-tab-host></div>
      </div>`);
    renderTab($("[data-tab-host]", root), ctx, tab);
  },
};
