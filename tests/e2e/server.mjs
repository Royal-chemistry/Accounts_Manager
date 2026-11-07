// A tiny static file server for local use and browser tests. No dependencies.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".csv": "text/csv; charset=utf-8",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  // The live site is served from this sub-folder, so tests can check nothing assumes the top of the site.
  const path = pathname.replace(/^\/Accounts_Manager(?=\/|$)/, "");
  const safe = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
  const file = join(ROOT, safe || "index.html");
  if (!file.startsWith(ROOT.replace(/[/\\]$/, "") + sep) && file !== ROOT) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Accounts Manager running at http://localhost:${PORT}`));
