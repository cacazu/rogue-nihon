import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const project = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const outputs = ["tests/browser-smoke/output", "tests/browser-smoke/output-ja",
  "tests/actual-results", "tests/fixture-results", "tests/localization-results",
  "tests/more-localization-results", "tests/ui-results", "tests/graphics-output",
  "tests/pixel-output", ".local/playwright", ".local/browser-profiles"];
let scope;
let recovered = false;
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};

function checkAncestor(target) {
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolved = realpathSync(ancestor);
  if (resolved !== project && !inside(project, resolved)) throw Error("Artifact path leaves the project");
}

function registry(mode, directory, keep = false) {
  if (process.platform !== "win32") return;
  const arguments_ = ["-NoProfile", "-NonInteractive", "-File",
    path.join(project, "tools", "artifact-registry.ps1"), "-Mode", mode, "-ProjectPath", project];
  if (directory) arguments_.push("-ScopePath", directory, "-OwnerPid", String(process.pid), "-Keep", keep ? "1" : "0");
  const options = { encoding: "utf8", windowsHide: true, timeout: 30000 };
  let result;
  try { result = execFileSync("pwsh", arguments_, options); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    result = execFileSync("powershell.exe", arguments_, options);
  }
  if (result.trim()) process.stderr.write(result.trim() + "\n");
}

export function recoverTemporaryArtifacts() {
  registry("Recover");
  recovered = true;
}

function temporaryScope() {
  if (scope) return scope;
  const base = path.join(project, ".local", "tasks");
  checkAncestor(base);
  mkdirSync(base, { recursive: true });
  const baseReal = realpathSync(base);
  const directory = mkdtempSync(path.join(baseReal, "node-"));
  registry("Register", directory);
  recovered = true;
  const temp = path.join(directory, "temp");
  mkdirSync(temp);
  const names = process.platform === "win32" ? ["TEMP", "TMP"] : ["TMPDIR"];
  const previous = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = temp;
  scope = directory;
  process.once("exit", () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    try {
      if (!existsSync(directory)) return;
      const resolved = realpathSync(directory);
      if (resolved !== directory || path.dirname(resolved) !== baseReal || !inside(project, resolved)) {
        throw Error("Unsafe artifact cleanup target");
      }
      const marker = path.join(resolved, ".rogue-owner.json");
      const ownership = existsSync(marker) ? readFileSync(marker) : undefined;
      // Keep recovery metadata until every generated file has been removed.
      for (const entry of readdirSync(resolved)) {
        if (entry !== ".rogue-owner.json") rmSync(path.join(resolved, entry), { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      }
      rmSync(marker, { force: true });
      try { rmdirSync(resolved); }
      catch (error) { if (ownership) writeFileSync(marker, ownership); throw error; }
    } catch (error) {
      process.stderr.write("Artifact cleanup failed: " + error.message + "\n");
      if (!process.exitCode) process.exitCode = 1;
    }
  });
  return directory;
}

// Keep authoring inputs, runnable builds, and other runs out of the delete scope.
// An explicit keep request uses the legacy paths for evidence aggregation.
export function artifactDirectory(directory) {
  const absolute = path.resolve(directory);
  const relative = path.relative(project, absolute).split(path.sep).join("/");
  if (!outputs.some(prefix => relative === prefix || relative.startsWith(prefix + "/"))) {
    throw Error("Not a temporary artifact directory: " + directory);
  }
  checkAncestor(absolute);
  if (process.env.ROGUE_KEEP_ARTIFACTS === "1") {
    if (!recovered) recoverTemporaryArtifacts();
    return absolute;
  }
  const output = path.join(temporaryScope(), "artifacts", relative);
  mkdirSync(output, { recursive: true });
  return output;
}
