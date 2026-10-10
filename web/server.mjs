import http from "node:http";
import https from "node:https";
import { createReadStream } from "node:fs";
import { readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectories = ["web", "build", "locales", "docs", "distribution"];
const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".wasm", "application/wasm"], [".txt", "text/plain; charset=utf-8"], [".md", "text/plain; charset=utf-8"]]);

export function createPreviewServer({ root = defaultRoot, tls } = {}) {
  const absoluteRoot = path.resolve(root);
  const isPublic = (relative) => publicDirectories.some((directory) => relative.startsWith(directory + path.sep));
  const handleRequest = async (request, response) => {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!new Set(["GET", "HEAD"]).has(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }); response.end("Method not allowed"); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname.includes("\0") || pathname.includes("\\")) throw Object.assign(new Error("Invalid path"), { status: 400 });
      const relative = pathname === "/" ? "web/index.html" : pathname.slice(1);
      const candidate = path.resolve(absoluteRoot, relative);
      if (!isPublic(path.relative(absoluteRoot, candidate))) throw Object.assign(new Error("Not a public file"), { status: 403 });
      const resolved = await realpath(candidate);
      const relativeResolved = path.relative(absoluteRoot, resolved);
      if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved) || !isPublic(relativeResolved)) throw Object.assign(new Error("Not a public file"), { status: 403 });
      if (!(await stat(resolved)).isFile()) throw Object.assign(new Error("Not a file"), { status: 404 });
      response.writeHead(200, { "Content-Type": mime.get(path.extname(resolved)) || "application/octet-stream" });
      if (request.method === "HEAD") response.end();
      else createReadStream(resolved).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 500 ? "Preview read failed" : error.message);
    }
  };
  return tls ? https.createServer(tls, handleRequest) : http.createServer(handleRequest);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ROGUE_PORT || process.argv[2] || 4173);
  const host = process.env.ROGUE_HOST || process.argv[3] || "127.0.0.1";
  const certificate = process.env.ROGUE_TLS_CERT || process.argv[4];
  const privateKey = process.env.ROGUE_TLS_KEY || process.argv[5];
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  if (Boolean(certificate) !== Boolean(privateKey)) throw new Error("TLS requires both a certificate and a private key");
  if (!certificate && !["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("LAN access requires HTTPS; use start.ps1 -Lan");
  const tls = certificate ? { cert: await readFile(certificate), key: await readFile(privateKey) } : undefined;
  const server = createPreviewServer({ tls });
  server.listen(port, host, () => console.log("Rogue preview: " + (tls ? "https" : "http") + "://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + server.address().port + "/"));
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
}
