// Rules that apply to the whole codebase, checked by reading the source files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
const LEGACY = new Set(["js/app.js", "js/calc.js", "css/style.css"].map((p) => p.replaceAll("/", "\\")).concat(["js/app.js", "js/calc.js", "css/style.css"]));
const JS = () => walk("js", [".js"]).filter((p) => !LEGACY.has(p));
const CSS = () => walk("css", [".css"]).filter((p) => !LEGACY.has(p));
const UI = () => [...JS(), ...CSS(), "index.html"];

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
  }
});
