import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".wasm", "application/wasm"], [".txt", "text/plain; charset=utf-8"]]);

export function createPreviewServer({ root = defaultRoot } = {}) {
  const absoluteRoot = path.resolve(root);
  return http.createServer(async (request, response) => {
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
      const resolved = await realpath(candidate);
      const relativeResolved = path.relative(absoluteRoot, resolved);
      if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) throw Object.assign(new Error("Path outside project"), { status: 403 });
      if (!(await stat(resolved)).isFile()) throw Object.assign(new Error("Not a file"), { status: 404 });
      response.writeHead(200, { "Content-Type": mime.get(path.extname(resolved)) || "application/octet-stream" });
      if (request.method === "HEAD") response.end();
      else createReadStream(resolved).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 500 ? "Preview read failed" : error.message);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ROGUE_PORT || process.argv[2] || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const server = createPreviewServer();
  server.listen(port, "127.0.0.1", () => console.log(`Rogue private preview: http://127.0.0.1:${server.address().port}/`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
}
