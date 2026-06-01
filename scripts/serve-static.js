import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./config.js";

const requestedRoot = process.argv[2] || ".";
const siteRoot = path.resolve(rootDir, requestedRoot);
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.resolve(siteRoot, decoded === "/" ? "index.html" : decoded.slice(1));
  return target.startsWith(siteRoot) ? target : path.join(siteRoot, "index.html");
}

const server = http.createServer(async (request, response) => {
  try {
    let file = safePath(request.url || "/");
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) file = path.join(file, "index.html");
    const body = await fs.readFile(file);
    response.writeHead(200, { "content-type": mimeTypes[path.extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${siteRoot} at http://127.0.0.1:${port}`);
});
