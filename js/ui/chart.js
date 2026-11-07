// A small grouped-column chart in plain SVG, with a tooltip on hover and keyboard focus,
// and a table of the same numbers, so nothing depends on seeing colour or using a mouse.
// It draws at the real width of its space, so its text stays readable on a phone.
import { html, raw, setHTML } from "./dom.js";

const PLOT_HEIGHT = 200;
const BAR_MAX = 24;
const GAP = 2; // the surface-coloured gap between touching bars
const LABEL_SPACE = 48; // room for a month label such as "Oct 26"
const LEFT = 44;
const RIGHT = 4;
const TOP = 10; // room for the top axis label

const round = (n) => Math.round(n * 100) / 100;

const niceStep = (max) => {
  if (max <= 0) return 1;
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const r = rough / pow;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * pow;
};

/** Short axis labels: 40K, 2L, 1Cr in rupees, and 40K, 2M elsewhere. */
export function axisLabel(n, currency = "INR") {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (x) => String(Math.round(x * 10) / 10);
  if (currency === "INR") {
    if (abs >= 1e7) return `${sign}${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${sign}${trim(abs / 1e5)}L`;
  } else if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}K`;
  return `${sign}${trim(abs)}`;
}

/** Rounded at the data end and square at the baseline. */
function barPath(x, y, w, h, up) {
  const r = Math.min(4, w / 2, h);
  const [l, t, rr, b] = [x, y, x + w, y + h].map(round);
  if (up) return `M${l} ${b}V${round(t + r)}Q${l} ${t} ${round(l + r)} ${t}H${round(rr - r)}Q${rr} ${t} ${rr} ${round(t + r)}V${b}Z`;
  return `M${l} ${t}V${round(b - r)}Q${l} ${b} ${round(l + r)} ${b}H${round(rr - r)}Q${rr} ${b} ${rr} ${round(b - r)}V${t}Z`;
}

/**
 * Renders grouped columns.
 * data: { title, categories: [label], series: [{ key, name, cls, values: [number] }] }
 * format(n) writes full amounts, axis(n) writes short ones.
 */
export function columnChart(host, { title, categories, series, format, axis }) {
  const all = series.flatMap((s) => s.values);
  const maxValue = Math.max(0, ...all);
  const minValue = Math.min(0, ...all);
  const step = niceStep(Math.max(maxValue, -minValue));
  const top = Math.ceil(maxValue / step) * step || step;
  const bottom = Math.floor(minValue / step) * step;
  const y = (v) => round(((top - v) / (top - bottom)) * PLOT_HEIGHT);
  const ticks = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(round(t));
  const baseline = y(0);
  let active = categories.length - 1; // the one bar group that's in the tab order

  const describe = (i) => `${categories[i]}: ${series.map((s) => `${s.name} ${format(s.values[i])}`).join(", ")}`;

  const svg = (width) => {
    const band = (width - LEFT - RIGHT) / categories.length;
    const pad = Math.min(16, band * 0.25);
    const barW = Math.min(BAR_MAX, (band - pad - GAP * (series.length - 1)) / series.length);
    const groupW = barW * series.length + GAP * (series.length - 1);
    const every = Math.max(1, Math.ceil(LABEL_SPACE / band));
    const showLabel = (i) => (categories.length - 1 - i) % every === 0; // always labels the latest
    return html`
      <svg class="chart-svg" viewBox="0 ${-TOP} ${width} ${PLOT_HEIGHT + 24 + TOP}" role="group" aria-label="${title}. Use the arrow keys to move between months.">
        ${ticks.map((t) => raw(`<line class="${t === 0 ? "chart-zero" : "chart-grid"}" x1="${LEFT}" x2="${width - RIGHT}" y1="${y(t)}" y2="${y(t)}"></line>`))}
        ${ticks.map((t) => html`<text class="chart-tick" x="${LEFT - 6}" y="${y(t) + 4}" text-anchor="end">${axis(t)}</text>`)}
        ${categories.map((cat, i) => {
          const gx = LEFT + band * i + (band - groupW) / 2;
          return html`<g>
            ${series.map((s, j) => {
              const v = s.values[i];
              const h = Math.abs(y(v) - baseline);
              return h > 0 ? raw(`<path class="chart-bar ${s.cls}" d="${barPath(gx + j * (barW + GAP), v >= 0 ? y(v) : baseline, barW, h, v >= 0)}"></path>`) : "";
            })}
            <rect class="chart-hit" x="${round(LEFT + band * i)}" y="0" width="${round(band)}" height="${PLOT_HEIGHT}" data-index="${i}" tabindex="${i === active ? 0 : -1}" role="img" aria-label="${describe(i)}"></rect>
          </g>`;
        })}
        ${categories.map((c, i) => (showLabel(i) ? html`<text class="chart-tick" x="${round(LEFT + band * i + band / 2)}" y="${PLOT_HEIGHT + 18}" text-anchor="middle">${c}</text>` : ""))}
      </svg>`;
  };

  setHTML(host, html`
    <figure class="chart">
      <div class="chart-legend" aria-hidden="true">
        ${series.map((s) => html`<span class="chart-key"><span class="chart-swatch ${s.cls}"></span>${s.name}</span>`)}
      </div>
      <div class="chart-plot">
        <div data-chart-canvas></div>
        <div class="chart-tip" hidden></div>
      </div>
      <details class="chart-table">
        <summary>Show as a table</summary>
        <div class="table-wrap" role="region" aria-label="${title} as a table" tabindex="0">
          <table class="tbl" role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col"><span class="sr-only">Month</span></th>${series.map((s) => html`<th role="columnheader" scope="col" class="col-num">${s.name}</th>`)}</tr></thead>
            <tbody role="rowgroup">${categories.map((c, i) => html`<tr role="row"><td role="cell" data-mobile="title">${c}</td>${series.map((s) => html`<td role="cell" class="col-num" data-label="${s.name}" data-mobile="detail">${format(s.values[i])}</td>`)}</tr>`)}</tbody>
          </table>
        </div>
      </details>
    </figure>`);

  const plot = host.querySelector(".chart-plot");
  const canvas = host.querySelector("[data-chart-canvas]");
  const tip = host.querySelector(".chart-tip");

  const show = (rect) => {
    const i = Number(rect.dataset.index);
    setHTML(tip, html`<div class="chart-tip-title">${categories[i]}</div>${series.map((s) => html`<div class="chart-tip-row"><span class="chart-key"><span class="chart-swatch ${s.cls}"></span>${s.name}</span><span class="num">${format(s.values[i])}</span></div>`)}`);
    tip.hidden = false;
    const box = plot.getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    const tipWidth = tip.getBoundingClientRect().width;
    tip.style.left = `${Math.max(0, Math.min(r.left - box.left + r.width / 2 - tipWidth / 2, box.width - tipWidth))}px`;
  };
  const hide = () => { tip.hidden = true; };

  let drawn = 0;
  const draw = () => {
    const width = Math.round(canvas.clientWidth) || 640;
    if (width === drawn) return;
    drawn = width;
    hide();
    setHTML(canvas, svg(width));
  };
  draw();
  const watcher = new ResizeObserver(() => { if (host.isConnected) draw(); else watcher.disconnect(); });
  watcher.observe(canvas);

  const moveTo = (i) => {
    const rects = canvas.querySelectorAll(".chart-hit");
    rects[active].setAttribute("tabindex", "-1");
    active = i;
    rects[active].setAttribute("tabindex", "0");
    rects[active].focus();
  };
  plot.addEventListener("pointerover", (e) => { if (e.target.matches(".chart-hit")) show(e.target); });
  plot.addEventListener("pointerleave", hide);
  plot.addEventListener("focusin", (e) => {
    if (!e.target.matches(".chart-hit")) return;
    active = Number(e.target.dataset.index);
    show(e.target);
  });
  plot.addEventListener("focusout", hide);
  plot.addEventListener("keydown", (e) => {
    const last = categories.length - 1;
    const next = { ArrowRight: Math.min(active + 1, last), ArrowLeft: Math.max(active - 1, 0), Home: 0, End: last }[e.key];
    if (e.key === "Escape") hide();
    else if (next !== undefined) { e.preventDefault(); moveTo(next); }
  });
}
