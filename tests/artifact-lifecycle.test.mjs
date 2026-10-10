import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = fileURLToPath(new URL("../", import.meta.url));
const helper = new URL("../tools/temporary-artifacts.mjs", import.meta.url).href;
const protectedFiles = ["build/game.js", "build/game.wasm", "build/build-manifest.json", "build/ja-main-translations.json", "locales/ja.json"];
if (existsSync(path.join(root, "build/browser-ui.wasm"))) protectedFiles.push("build/browser-ui.wasm");
const hashes = () => protectedFiles.map(file => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex"));
const source = `import {artifactDirectory} from ${JSON.stringify(helper)};
import {mkdirSync,writeFileSync} from 'node:fs';import path from 'node:path';
const output=artifactDirectory(path.join(${JSON.stringify(root)},'tests/browser-smoke/output/lifecycle-${randomUUID()}'));
mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'result.json'),'{}');
console.log(output);`;

for (const fail of [false, true]) test(`owned output is deleted after ${fail ? "an exception" : "success"}`, () => {
  const before = hashes();
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", source + (fail ? "throw Error('expected failure');" : "")], {
    encoding: "utf8", env: { ...process.env, ROGUE_KEEP_ARTIFACTS: "0" }
  });
  assert.equal(run.status, fail ? 1 : 0, run.stderr);
  assert.equal(existsSync(run.stdout.trim()), false);
  assert.deepEqual(hashes(), before);
});

test("one completed run cannot remove a concurrent run's output", async () => {
  const running = spawn(process.execPath, ["--input-type=module", "-e", source + "process.stdin.resume();"], {
    env: { ...process.env, ROGUE_KEEP_ARTIFACTS: "0" }, stdio: ["pipe", "pipe", "pipe"]
  });
  const held = (await once(running.stdout, "data"))[0].toString().trim();
  try {
    const completed = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      encoding: "utf8", env: { ...process.env, ROGUE_KEEP_ARTIFACTS: "0" }
    });
    assert.equal(completed.status, 0, completed.stderr);
    assert.equal(existsSync(completed.stdout.trim()), false);
    assert.equal(existsSync(path.join(held, "result.json")), true);
  } finally {
    const closed = once(running, "close"); running.stdin.end(); await closed;
  }
  assert.equal(existsSync(held), false);
});

test("source and runnable-build paths cannot become temporary outputs", () => {
  for (const directory of ["build", "locales", "tests/baseline-src", "../outside"]) {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import {artifactDirectory} from ${JSON.stringify(helper)};artifactDirectory(${JSON.stringify(path.resolve(root, directory))});`], { encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Not a temporary artifact directory/);
  }
});

test("explicit evidence retention keeps the requested output", () => {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", env: { ...process.env, ROGUE_KEEP_ARTIFACTS: "1" }
  });
  assert.equal(run.status, 0, run.stderr);
  const output = realpathSync(run.stdout.trim());
  assert.equal(path.dirname(output), realpathSync(path.join(root, "tests/browser-smoke/output")));
  assert.ok(path.basename(output).startsWith("lifecycle-"));
  try { assert.ok(existsSync(path.join(output, "result.json"))); }
  finally { rmSync(output, { recursive: true, force: true }); }
});

test("PowerShell removes a partial build and restores absent environment variables", { skip: process.platform !== "win32" }, () => {
  const script = `Set-Location -LiteralPath '${root.replaceAll("'", "''")}';
    . ./tools/temporary-artifacts.ps1
    Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    $scope = New-RogueArtifactScope -ProjectPath $PWD
    $owned = $scope.Path
    try { Set-Content -LiteralPath (Join-Path $owned 'partial.wasm') -Value 'partial'; throw 'expected' }
    catch { if ($_.Exception.Message -ne 'expected') { throw } }
    finally { Close-RogueArtifactScope $scope }
    if ((Test-Path -LiteralPath $owned) -or $null -ne $env:CARGO_TARGET_DIR) { throw 'Incomplete cleanup or environment restoration' }
    Write-Output 'PASS'`;
  const run = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "PASS");
});

test("the command wrapper cleans up and preserves native failure status", { skip: process.platform !== "win32" }, () => {
  const run = spawnSync("pwsh", ["-NoProfile", "-File", path.join(root, "tools/run-clean.ps1"),
    process.execPath, "-e", "console.log(process.env.ROGUE_ARTIFACT_SCOPE);process.exit(23)"], { encoding: "utf8" });
  assert.equal(run.status, 23, run.stderr);
  assert.equal(existsSync(run.stdout.trim()), false);
});
