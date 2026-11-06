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
const JS = () => [...walk("js/core", [".js"]), ...walk("js/state", [".js"]), ...walk("js/ui", [".js"]), ...walk("js/pages", [".js"]), ...walk("js", ["main.js"]).filter((p) => /main\.js$/.test(p))];
const UI = () => [...JS(), ...walk("css/app", [".css"]), ...(existsSync(join(ROOT, "app.html")) ? ["app.html"] : [])];

test("no blocking browser popups anywhere in the new code", () => {
  for (const file of JS()) {
    const code = read(file).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/(?<![\w.])(confirm|alert|prompt)\s*\(/.test(code), `${file} uses a blocking popup`);
    assert.ok(!/window\.(confirm|alert|prompt)/.test(code), `${file} uses a blocking popup`);
  }
});

test("no emoji anywhere in the UI code", () => {
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]/u;
  for (const file of UI()) assert.ok(!emoji.test(read(file)), `${file} contains an emoji`);
});
