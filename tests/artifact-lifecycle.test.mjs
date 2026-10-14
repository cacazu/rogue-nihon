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

test("compiler workspace removes partial output and restores absent environment variables", () => {
  const workspace = new URL('../tools/compiler-workspace.mjs', import.meta.url).href;
  const script = `import {compilerWorkspace} from ${JSON.stringify(workspace)};
    import {existsSync,writeFileSync} from 'node:fs';import path from 'node:path';
    delete process.env.CARGO_TARGET_DIR;
    const scope=compilerWorkspace(${JSON.stringify(root)});const owned=scope.directory;
    try {writeFileSync(path.join(owned,'partial.wasm'),'partial');throw Error('expected');}
    catch(error){if(error.message!=='expected')throw error;}finally{scope.close();}
    if(existsSync(owned)||process.env.CARGO_TARGET_DIR!==undefined)throw Error('Incomplete cleanup or restoration');
    console.log('PASS');`;
  const run = spawnSync(process.execPath, ['--input-type=module','-e',script], {encoding:'utf8',env:{...process.env,ROGUE_ARTIFACT_SCOPE:'',ROGUE_KEEP_ARTIFACTS:'0'}});
  assert.equal(run.status,0,run.stderr);
  assert.equal(run.stdout.trim(),'PASS');
});

test("the command wrapper cleans up and preserves native failure status", () => {
  const run = spawnSync(process.execPath, [path.join(root,'tools/run-clean.mjs'),
    process.execPath,'-e',"console.log(process.env.ROGUE_ARTIFACT_SCOPE);process.exit(23)"], {encoding:'utf8',env:{...process.env,ROGUE_ARTIFACT_SCOPE:'',ROGUE_KEEP_ARTIFACTS:'0'}});
  assert.equal(run.status,23,run.stderr);
  assert.equal(existsSync(run.stdout.trim()),false);
});
