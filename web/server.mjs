import http from "node:http";
import https from "node:https";
import { createReadStream, realpathSync } from "node:fs";
import { readFile, stat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectories = ["web", "build", "locales", "docs", "distribution"];
const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".wasm", "application/wasm"], [".txt", "text/plain; charset=utf-8"], [".md", "text/plain; charset=utf-8"]]);

function previewIdentity(root) {
  const resolved = realpathSync(root);
  return createHash("sha256").update(process.platform === "win32" ? resolved.toLowerCase() : resolved).digest("hex");
}

export function createPreviewServer({ root = defaultRoot, tls } = {}) {
  const absoluteRoot = path.resolve(root);
  const identity = previewIdentity(absoluteRoot);
  const isPublic = (relative) => publicDirectories.some((directory) => relative.startsWith(directory + path.sep));
  const handleRequest = async (request, response) => {
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Rogue-Preview", identity);
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

function readPreviewResponse(url, method, tls) {
  return new Promise((resolve, reject) => {
    const request = (tls ? https : http).request(url, { method, ...(tls ? { ca: tls.cert } : {}) }, response => {
      const chunks = [];
      let length = 0;
      response.on("data", chunk => {
        length += chunk.length;
        if (length > 512 * 1024) request.destroy(new Error("Preview response too large"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => request.destroy(new Error("Preview response timeout")), 1500);
    request.once("close", () => clearTimeout(timer));
    request.on("error", reject);
    request.end();
  });
}

async function isSamePreview(url, root, tls) {
  try {
    const response = await readPreviewResponse(url, "HEAD", tls);
    if (response.status !== 200 || response.headers["cross-origin-opener-policy"] !== "same-origin" ||
        response.headers["cross-origin-embedder-policy"] !== "require-corp") return false;
    if (response.headers["x-rogue-preview"]) return response.headers["x-rogue-preview"] === previewIdentity(root);
    // Servers started before the identity header was added can still serve the
    // updated files. Verify the entry point, server source and build together.
    const matches = await Promise.all(["web/index.html", "web/server.mjs", "build/build-manifest.json"].map(async file => {
      const [local, remote] = await Promise.all([readFile(path.join(root, file)), readPreviewResponse(new URL(file, url), "GET", tls)]);
      return remote.status === 200 && local.equals(remote.body);
    }));
    return matches.every(Boolean);
  } catch { return false; }
}

export async function startPreviewServer({ root = defaultRoot, port = 4173, host = "127.0.0.1", tls } = {}) {
  const server = createPreviewServer({ root, tls });
  const urlFor = value => (tls ? "https" : "http") + "://" + (host.includes(":") ? "[" + host + "]" : host) + ":" + value + "/";
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => { server.removeListener("error", reject); resolve(); });
    });
    return { server, url: urlFor(server.address().port), reused: false };
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    const url = urlFor(port);
    if (await isSamePreview(url, root, tls)) return { server: null, url, reused: true };
    throw new Error(`ポート ${port} (${host}) は別のサーバーが使用しています。\nそのサーバーを終了するか、.\\start.ps1 -Port ${port < 65535 ? port + 1 : port - 1} で別のポートを指定してください。`);
  }
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
  try {
    const { server, url, reused } = await startPreviewServer({ port, host, tls });
    if (reused) console.log("Rogueは既に起動しています。このURLをブラウザーで開いてください。");
    console.log("Rogue preview: " + url);
    if (server) {
      server.on("error", error => { console.error(error.message); process.exitCode = 1; });
      for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
