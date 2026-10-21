import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "dist");
const PORT = Number(process.env.BENCH_BROWSER_PORT ?? 4180);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === "/" || path.endsWith("/")) path = join(path, "index.html");
    const file = join(ROOT, path);

    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(500).end("error");
  }
});

server.listen(PORT, () => {
  process.stdout.write(`bench-browser static server on http://localhost:${PORT} (root ${ROOT})\n`);
});
