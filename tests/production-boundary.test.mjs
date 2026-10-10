import test from "node:test";
import assert from "node:assert/strict";
import {copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const text = file => readFile(path.join(root, file), "utf8");

test("every shipped browser/server module has no test or artifact-management dependency", async () => {
  const files = (await readdir(path.join(root, "web"))).filter(file => /\.m?js$/.test(file));
  for (const file of files) {
    const source = await text("web/" + file);
    assert.doesNotMatch(source, /__rogueBrowserTest|RogueCanvasUi\.active|recoverTemporaryArtifacts|artifact-registry|temporary.artifacts|ROGUE_KEEP_ARTIFACTS/, file);
    for (const [, dependency] of source.matchAll(/(?:from\s*|import\s*\(|importScripts\s*\(|require\s*\()\s*["']([^"']+)/g)) {
      assert.ok(dependency.startsWith("node:") || dependency.startsWith("/web/") || dependency === "/build/game.js", file + " -> " + dependency);
    }
  }
  assert.doesNotMatch(await text("web/index.html"), /tests\/|tools\/|fixture|artifact/i);
  assert.doesNotMatch(await text("start.ps1"), /tests[\\/]|tools[\\/]|artifact|recover/i);
});

test("production compiler entry points do not register or recover interrupted runs", async () => {
  for (const file of ["build.ps1", "build-ui.ps1", "tools/temporary-artifacts.ps1",
    "generate-abi.ps1", "tools/generate_catalog.py", "tools/generate_game_ui.py", "tools/generate_entities.py"]) {
    assert.doesNotMatch(await text(file), /artifact-registry|artifact-processes|recoverTemporaryArtifacts|Invoke-RogueRecovery/, file);
  }
  assert.match(await text("build.ps1"), /\$OutputName -eq 'game' -and \(\$TestFixtures -or \$TestHooks -or \$LogicDirectory\)/);
});

test("published Wasm and loader exclude regression exports and fixture code", async () => {
  const bytes = await readFile(path.join(root, "build/game.wasm"));
  const module = await WebAssembly.compile(bytes);
  assert.ok(WebAssembly.Module.exports(module).some(entry => entry.name === "rg_run"));
  assert.ok(WebAssembly.Module.exports(module).every(entry => !entry.name.startsWith("rg_test_")));
  for (const token of ["rg_test_repaint", "rg_test_save_roundtrip", "rg_test_apply_fixture", "/fixture.id"]) {
    assert.equal(bytes.includes(Buffer.from(token)), false, token);
  }
  assert.doesNotMatch(await text("build/game.js"), /rg_test_|game-fixtures|temporary.artifacts/);
  const ui = await WebAssembly.compile(await readFile(path.join(root, "build/browser-ui.wasm")));
  assert.deepEqual(WebAssembly.Module.imports(ui).map(({module, name}) => ({module, name})),
    [{module: "canvas", name: "measure_text"}]);
  const manifest = JSON.parse(await text("build/build-manifest.json"));
  assert.equal(manifest.test_hooks, false);
  assert.equal(manifest.test_fixtures, false);
});

test("explicit regression builds retain the hooks without modifying the published game", async () => {
  const module = await WebAssembly.compile(await readFile(path.join(root, "build/game-fixtures.wasm")));
  const exports = WebAssembly.Module.exports(module).map(entry => entry.name);
  for (const name of ["rg_test_repaint", "rg_test_save_roundtrip"]) assert.ok(exports.includes(name), name);
});

test("compiler workspace lifecycle works without any recovery registry or process-query tools", {skip: process.platform !== "win32"}, async () => {
  const parent = await realpath(path.join(root, ".local"));
  const project = await mkdtemp(path.join(parent, "production-compile-"));
  try {
    await mkdir(path.join(project, "tools"));
    const helper = path.join(project, "tools/temporary-artifacts.ps1");
    await copyFile(path.join(root, "tools/temporary-artifacts.ps1"), helper);
    const script = `. '${helper.replaceAll("'", "''")}';
      Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue;
      $scope=New-RogueArtifactScope -ProjectPath '${project.replaceAll("'", "''")}';
      $owned=$scope.Path;
      try {Set-Content -LiteralPath (Join-Path $owned 'partial.wasm') -Value 'partial'}
      finally {Close-RogueArtifactScope $scope};
      if ((Test-Path -LiteralPath $owned) -or $null -ne $env:CARGO_TARGET_DIR) {throw 'Incomplete compiler workspace cleanup'};
      Write-Output 'PASS'`;
    const run = spawnSync("pwsh", ["-NoProfile", "-Command", script],
      {encoding: "utf8", windowsHide: true, env: {...process.env, ROGUE_KEEP_ARTIFACTS: "0", ROGUE_ARTIFACT_SCOPE: ""}});
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.equal(run.stdout.trim(), "PASS");
  } finally {
    assert.equal(await realpath(project), project);
    assert.equal(path.dirname(project), parent);
    assert.ok(path.basename(project).startsWith("production-compile-"));
    await rm(project, {recursive: true, force: true});
  }
});
