// Rules that apply to the whole codebase, checked by reading the source files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir, ext, out = []) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, ext, out);
    else if (ext.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const JS = () => walk("js", [".js"]);
const CSS = () => walk("css", [".css"]);
const UI = () => [...JS(), ...CSS(), "index.html"];

test("every browser test runs on the fixed date, so results can't depend on the day they run", () => {
  for (const file of walk("tests/e2e", [".spec.mjs"])) {
    assert.ok(!read(file).includes('"@playwright/test"'), `${file} should import test from ./helpers.mjs`);
  }
});

test("a visitor downloads under 350 KB, with the compression GitHub Pages applies", () => {
  const files = ["index.html", ...JS(), ...CSS(), ...walk("assets", [".svg", ".woff2"])];
  const bytes = files.reduce((sum, f) => {
    const body = readFileSync(join(ROOT, f));
    return sum + (f.endsWith(".woff2") ? body.length : gzipSync(body).length); // fonts are already compressed
  }, 0);
  assert.ok(bytes < 350 * 1024, `The app is ${Math.round(bytes / 1024)} KB to download`);
});

test("GitHub Pages will serve files whose names start with an underscore", () => {
  // Pages runs Jekyll by default, which silently drops them, and the app wouldn't start. No browser test can see this.
  const underscored = [...JS(), ...CSS()].filter((f) => f.split(/[\\/]/).some((part) => part.startsWith("_")));
  if (underscored.length) assert.ok(existsSync(join(ROOT, ".nojekyll")), `.nojekyll is needed for ${underscored.join(", ")}`);
});

test("every link and picture in the docs points at something that exists", () => {
  for (const doc of ["README.md", "CONTRIBUTING.md", "CHANGELOG.md", "tests/fixtures/README.md"]) {
    const text = read(doc);
    const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
    for (const target of targets.filter((t) => !/^(https?:|mailto:|#)/.test(t))) {
      assert.ok(existsSync(join(ROOT, dirname(doc), target.split("#")[0])), `${doc} links to ${target}, which doesn't exist`);
    }
  }
});

test("the offline list in sw.js matches the files on disk", () => {
  const listed = [...read("sw.js").matchAll(/^\s+"([^"]+)",$/gm)].map((m) => m[1]).filter((f) => f !== "./");
  const onDisk = ["index.html", ...walk("js", [".js"]), ...walk("css", [".css"]), ...walk("assets", [".svg", ".woff2"])].map((p) => p.replaceAll("\\", "/"));
  assert.deepEqual([...listed].sort(), [...onDisk].sort());
});

test("no blocking browser popups anywhere", () => {
  for (const file of JS()) {
    const code = read(file).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/(?<![\w.])(confirm|alert|prompt)\s*\(/.test(code), `${file} uses a blocking popup`);
    assert.ok(!/window\.(confirm|alert|prompt)/.test(code), `${file} uses a blocking popup`);
  }
});

test("no emoji anywhere in the UI", () => {
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u;
  for (const file of UI()) assert.ok(!emoji.test(read(file)), `${file} contains an emoji`);
});

test("no raw colours outside the tokens file", () => {
  const hex = /#[0-9a-fA-F]{3,8}\b/;
  for (const file of CSS()) {
    if (/tokens\.css$|print\.css$/.test(file)) continue;
    assert.ok(!hex.test(read(file)), `${file} has a raw colour instead of a token`);
  }
});

test("no inline styles, which the Content Security Policy would block", () => {
  for (const file of [...JS(), "index.html"]) {
    assert.ok(!/\sstyle="/.test(read(file)), `${file} has an inline style attribute`);
    assert.ok(!/<style[\s>]/.test(read(file)), `${file} has an inline style block`);
  }
});

test("the page loads nothing from other servers", () => {
  const page = read("index.html");
  assert.ok(!/(?:src|href)="https?:/.test(page), "index.html references another server");
  const csp = page.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || "";
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(csp.includes("connect-src 'self'"));
  for (const file of CSS()) assert.ok(!/url\(["']?https?:/.test(read(file)), `${file} references another server`);
});

// Every colour pair the design relies on must keep passing WCAG AA.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

test("every colour pair passes WCAG AA in both themes", () => {
  const css = read("css/tokens.css");
  const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="dark"]')));
  const dark = tokens(css.slice(css.indexOf(':root[data-theme="dark"]')));
  for (const [theme, t] of [["light", light], ["dark", dark]]) {
    const pair = (fg, bg, min) => assert.ok(ratio(t[fg], t[bg]) >= min, `${theme}: ${fg} on ${bg} is ${ratio(t[fg], t[bg]).toFixed(2)}, needs ${min}`);
    for (const bg of ["bg", "surface", "surface-2"]) {
      for (const fg of ["text", "text-muted", "primary-text", "success", "danger", "warning", "info"]) pair(fg, bg, 4.5);
      pair("border-strong", bg, 3);
      pair("primary", bg, 3);
    }
    pair("series-1", "surface", 3);
    pair("series-2", "surface", 3);
    pair("on-primary", "primary", 4.5);
    pair("on-primary", "primary-hover", 4.5);
    pair("on-danger", "danger", 4.5);
    pair("on-danger", "danger-hover", 4.5);
    pair("primary-text", "primary-soft", 4.5);
    pair("success", "success-soft", 4.5);
    pair("danger", "danger-soft", 4.5);
    pair("warning", "warning-soft", 4.5);
    pair("info", "info-soft", 4.5);
    pair("text", "warning-soft", 4.5);
    pair("text", "info-soft", 4.5);
    pair("text", "danger-soft", 4.5);
    // The page heading sits directly on the colour that drifts behind the interface.
    for (const bg of ["amb-1", "amb-2", "amb-3"]) {
      pair("text", bg, 4.5);
      pair("text-muted", bg, 4.5);
    }
    pair("primary-text", "selected", 4.5);
  }
  for (let i = 1; i <= 8; i++) {
    for (const side of ["a", "b"]) {
      assert.ok(ratio(light["on-art"], light[`art-${i}${side}`]) >= 4.5, `initials on artwork ${i}${side} are ${ratio(light["on-art"], light[`art-${i}${side}`]).toFixed(2)}`);
    }
  }
});

// A browser can't report contrast through blur, and axe skips it. So this works out the worst case by hand:
// the clearest the glass ever gets, with the strongest colour in the app scrolled directly beneath it.
test("text on glass stays readable over anything that can scroll beneath it", () => {
  const css = read("css/tokens.css");
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="dark"]'));
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("/* Touch screens"));
  const number = (block, name) => Number(block.match(new RegExp(`--${name}:\\s*([\\d.]+)`))[1]);
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  const over = (tint, alpha, hex) => toHex(channels(hex).map((c, i) => tint[i] * alpha + c * (1 - alpha)));

  for (const [theme, block] of [["light", lightBlock], ["dark", darkBlock]]) {
    const t = { ...tokens(lightBlock), ...tokens(block) };
    const tint = block.match(/--glass-tint:\s*(\d+) (\d+) (\d+)/).slice(1).map(Number);
    const art = Object.keys(t).filter((k) => /^art-\db?a?$/.test(k) || /^art-\d[ab]$/.test(k)).map((k) => t[k]);
    const check = (fg, floorName, backdrops) => {
      const floor = number(block, floorName);
      for (const hex of backdrops) {
        const seen = over(tint, floor, hex);
        const r = ratio(t[fg], seen);
        assert.ok(r >= 4.5, `${theme}: ${fg} on ${floorName} over ${hex} is ${r.toFixed(2)}, needs 4.5`);
      }
    };
    // Floating controls: anything in the app can scroll under them, so their labels only ever use the main text colour.
    check("text", "glass-floor", [t.bg, t.surface, t["surface-2"], t.primary, t.danger, t.success, t["series-1"], t["series-2"], ...art]);
    // The sidebar only ever has the page colour beneath it.
    check("text", "glass-side-floor", [t.bg, t["amb-1"], t["amb-2"], t["amb-3"]]);
    check("text-muted", "glass-side-floor", [t.bg, t["amb-1"], t["amb-2"], t["amb-3"]]);
    // Sheets and menus carry whole forms, so even their secondary text has to survive the darkest thing behind them.
    check("text", "glass-sheet-floor", [t.bg, t.surface, t.primary, ...art]);
    check("text-muted", "glass-sheet-floor", [t.bg, t.surface, t.primary, ...art]);
    // A detail page's heading sits on a 20% wash of its artwork's colour.
    for (const hex of art) {
      const wash = toHex(channels(t.bg).map((c, i) => channels(hex)[i] * 0.2 + c * 0.8));
      for (const fg of ["text", "text-muted"]) assert.ok(ratio(t[fg], wash) >= 4.5, `${theme}: ${fg} on a wash of ${hex} is ${ratio(t[fg], wash).toFixed(2)}`);
    }
  }
});

test("the Up Next sheet stays readable however the colour drifts behind it", () => {
  const t = tokens(read("css/tokens.css"));
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 1; i <= 8; i++) {
    for (const side of ["a", "b"]) {
      // The brightest it gets: artwork mixed 30% with white, under the 35% dimming layer.
      const seen = rgb(t[`art-${i}${side}`]).map((c) => (c * 0.7 + 255 * 0.3) * 0.65);
      const hex = `#${seen.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
      assert.ok(ratio(t["on-art"], hex) >= 4.5, `white on artwork ${i}${side} is ${ratio(t["on-art"], hex).toFixed(2)}`);
    }
  }
});
