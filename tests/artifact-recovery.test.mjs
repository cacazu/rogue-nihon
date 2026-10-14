import {loadPlaywright, browserExecutable, pythonExecutable} from '../tools/toolchain.mjs';
import { installBrowserTestAdapter } from "./browser-smoke/test-adapter.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import os from "node:os";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const previewServer = fileURLToPath(new URL("../../tools/server.mjs", import.meta.url));
const base = path.join(root, ".local", "tasks");
const helper = new URL("../tools/temporary-artifacts.mjs", import.meta.url).href;
const registry = path.join(root, "tools/artifact_registry.py");
const python = pythonExecutable();
const protectedFiles = ["build/game.js", "build/game.wasm", "build/build-manifest.json", "locales/ja.json"];
if (existsSync(path.join(root, "build/browser-ui.wasm"))) protectedFiles.push("build/browser-ui.wasm");
const hashes = () => protectedFiles.map(file => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex"));
const environment = { ...process.env, ROGUE_KEEP_ARTIFACTS: "0" };
delete environment.ROGUE_ARTIFACT_SCOPE;

async function firstLine(child) {
  let output = "", errors = "";
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for artifact owner: " + errors)), 30000);
    child.stderr.on("data", bytes => { errors += bytes; });
    child.stdout.on("data", bytes => {
      output += bytes;
      if (output.includes("\n")) { clearTimeout(timer); resolve(output.split(/\r?\n/)[0]); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("Owner exited before ready: " + code + " " + errors)); });
  });
}

async function stop(child, force = true) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  if (force) child.kill("SIGKILL"); else child.stdin.end();
  await closed;
}

function removeOwn(directory) {
  if (!existsSync(directory)) return;
  assert.equal(path.dirname(directory), base);
  assert.match(path.basename(directory), /^(node|python)-[a-zA-Z0-9_-]+$/);
  assert.equal(realpathSync(directory), directory);
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const ownedRuns = [];
// Scope simulated enumeration to this test's own processes/directories. The
// native restricted-snapshot branch is exercised separately; it must retain data.
function recoveryScript(extra = '') {
  const pids=ownedRuns.map(r=>r.child.pid);
  for(const run of ownedRuns){const file=path.join(run.directory,'child-pid.txt');if(existsSync(file))pids.push(Number(readFileSync(file,'utf8')));}
  return `import sys;sys.path.insert(0,${JSON.stringify(path.join(root,'tools'))});import artifact_registry as registry
allowed=set(${JSON.stringify(ownedRuns.map(r=>r.directory))})
record=registry.record_for
registry.record_for=lambda project,directory: record(project,directory) if str(directory) in allowed else None
registry.snapshot=lambda: [registry.query(pid) for pid in ${JSON.stringify(pids)}]
${extra}
registry.recover(${JSON.stringify(root)})`;
}
function recover() {
  const result = spawnSync(python, ['-c',recoveryScript()], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

async function owner(runtime = "node", keep = false, extra = "") {
  let command, arguments_;
  if (runtime === "node") {
    command = process.execPath;
    const retainedWorkspace = new URL('../tools/compiler-workspace.mjs',import.meta.url).href;
    arguments_ = ["--input-type=module", "-e", `import {artifactDirectory} from ${JSON.stringify(helper)};
      import {compilerWorkspace} from ${JSON.stringify(retainedWorkspace)};
      import {execFileSync} from 'node:child_process';
      import path from 'node:path';import {mkdirSync,writeFileSync} from 'node:fs';
      let scope,output;
      if(${keep}){
        const workspace=compilerWorkspace(${JSON.stringify(root)},true);scope=workspace.directory;output=path.join(scope,'artifacts');
        execFileSync(${JSON.stringify(python)},[${JSON.stringify(registry)},'register','--project',${JSON.stringify(root)},'--directory',scope,'--pid',String(process.pid),'--keep']);
        process.once('exit',()=>workspace.close());
      }else{
        output=artifactDirectory(path.join(${JSON.stringify(root)},'tests/browser-smoke/output/recovery-${randomUUID()}'));
        scope=output.slice(0,output.indexOf(path.sep+'artifacts'+path.sep));
      }
      mkdirSync(output,{recursive:true});writeFileSync(path.join(output,'result.json'),'{}');
      ${extra}
      console.log(scope);process.stdin.resume();`];
  } else {
    command = python;
    arguments_ = ["-B", "-c", `import sys,pathlib;sys.path.insert(0,${JSON.stringify(path.join(root, "tools"))});from temporary_artifacts import TemporaryArtifacts
with TemporaryArtifacts(${JSON.stringify(root)}) as scope:
    (scope.directory/'partial.wasm').write_text('partial')
    print(scope.directory,flush=True)
    sys.stdin.read()`];
  }
  const child = spawn(command, arguments_, { cwd: root, env: { ...environment, ROGUE_KEEP_ARTIFACTS: keep ? "1" : "0" }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  try {const run={child,directory:await firstLine(child)};ownedRuns.push(run);return run;}
  catch (error) { await stop(child); throw error; }
}


test("preview startup preserves interrupted and live run directories and playable files", async () => {
  const before = hashes();
  const dead = await owner(), live = await owner();
  let server, browser, runtime;
  try {
    await stop(dead.child);
    assert.ok(existsSync(dead.directory));
    server = spawn(process.execPath, [previewServer, "--root", root, "0"], { cwd: root, env: environment, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const ready = await firstLine(server);
    assert.match(ready, /^Rogue (?:private )?preview: http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(existsSync(dead.directory), true);
    assert.ok(existsSync(live.directory));
    const { prepareBrowserRuntime } = await import('./browser-smoke/browser-runtime.mjs');
    runtime = await prepareBrowserRuntime(root);
    const {chromium} = loadPlaywright();
    browser = await chromium.launch({ executablePath: browserExecutable(), headless: true, downloadsPath: runtime.downloadsPath });
    const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });await installBrowserTestAdapter(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ready.replace(/^Rogue (?:private )?preview: /, '') + '?trace=1&lang=ja');
    await page.waitForFunction(() => window.__rogueBrowserTest);
    const canvasUi = await page.evaluate(() => Boolean(__rogueBrowserTest.canvas));
    const canvasBox = await page.locator('#rogue-canvas').boundingBox();
    if (canvasUi) {
    await page.waitForFunction(() => __rogueBrowserTest.canvas.paintCount > 0);
    for (const [id, value] of [['name', '回収検査勇者'], ['seed', '17']]) {
      const field = await page.evaluate(id => __rogueBrowserTest.canvas.controls.find(control => control.id === id).rect, id);
      await page.mouse.click(canvasBox.x + field.x + field.w / 2, canvasBox.y + field.y + field.h / 2);
      await page.keyboard.press('Control+a'); await page.keyboard.insertText(value);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await page.waitForFunction(() => __rogueBrowserTest.canvas.controls.some(control => control.id === 'new-game' && !control.disabled));
    const button = await page.evaluate(() => __rogueBrowserTest.canvas.controls.find(control => control.id === 'new-game').rect);
    await page.mouse.click(canvasBox.x + button.x + button.w / 2, canvasBox.y + button.y + button.h / 2);
    } else {
      await page.locator('#name').fill('回収検査勇者');
      await page.locator('#seed').fill('17');
      await page.locator('#new-game').click();
    }
    await page.waitForFunction(() => __rogueBrowserTest.running && __rogueBrowserTest.trace && __rogueBrowserTest.inputRequestCount > 0 && __rogueBrowserTest.queuePending === 0);
    const turn = await page.evaluate(() => __rogueBrowserTest.trace.words[13]);
    await page.keyboard.press('.');
    await page.waitForFunction(previous => __rogueBrowserTest.trace.words[13] === previous + 1, turn);
    assert.deepEqual(errors, []);
    assert.ok(existsSync(live.directory));
    assert.deepEqual(hashes(), before);
  } finally {
    await browser?.close(); await runtime?.dispose();
    if (server) await stop(server);
    await stop(live.child, false);
    removeOwn(dead.directory); removeOwn(live.directory);
  }
});

for (const runtime of ["node", "python"]) test(`${runtime} recovers killed output and preserves explicit retention`, async () => {
  const dead = await owner(runtime), kept = await owner(runtime, true);
  try {
    await stop(dead.child); await stop(kept.child);
    assert.ok(existsSync(dead.directory)); assert.ok(existsSync(kept.directory));
    recover();
    assert.equal(existsSync(dead.directory), false);
    assert.ok(existsSync(kept.directory));
  } finally {
    await stop(dead.child); await stop(kept.child);
    removeOwn(dead.directory); removeOwn(kept.directory);
  }
});

test("surviving subprocesses protect an interrupted run until they exit", async () => {
  const dead = await owner("node", false, `import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)',scope],{windowsHide:true,detached:true,stdio:'ignore'});
    writeFileSync(path.join(scope,'child-pid.txt'),String(child.pid));`);
  const childPid = Number(readFileSync(path.join(dead.directory, "child-pid.txt"), "utf8"));
  try {
    await stop(dead.child);
    assert.doesNotThrow(() => process.kill(childPid, 0), 'The detached child must still be alive');
    recover();
    assert.ok(existsSync(dead.directory));
    process.kill(childPid, "SIGKILL");
    recover();
    assert.equal(existsSync(dead.directory), false);
  } finally {
    await stop(dead.child);
    try { process.kill(childPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    removeOwn(dead.directory);
  }
});

test("unknown metadata and junctions are preserved", async () => {
  const dead = await owner();
  const unknown = path.join(base, "node-unknown-" + randomUUID());
  const before = hashes();
  try {
    await stop(dead.child);
    mkdirSync(unknown); writeFileSync(path.join(unknown, ".rogue-owner.json"), "{partial");
    const marker = path.join(dead.directory, ".rogue-owner.json");
    const record = JSON.parse(readFileSync(marker, "utf8"));
    for (const invalid of [{ owner_start: null }, { project: path.dirname(root) }, { version: 2 }, { version: true }]) {
      writeFileSync(marker, JSON.stringify({ ...record, ...invalid }));
      recover(); assert.ok(existsSync(dead.directory)); assert.ok(existsSync(unknown));
    }
    writeFileSync(marker, JSON.stringify(record));
    try {
      symlinkSync(path.join(root, "build"), path.join(dead.directory, "protected-build"), process.platform==='win32'?'junction':'dir');
    } catch (error) {
      if (!['EPERM','EACCES'].includes(error.code)) throw error;
      // Exercise the same refusal branch if the host cannot create filesystem links.
      const link=path.join(dead.directory,'protected-build');writeFileSync(link,'link probe');
      const script=recoveryScript(`from pathlib import Path
original=Path.is_symlink
Path.is_symlink=lambda p: str(p)==${JSON.stringify(link)} or original(p)`);
      const probe=spawnSync(python,['-c',script],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
      assert.ok(existsSync(dead.directory));assert.deepEqual(hashes(),before);
      return;
    }
    recover(); assert.ok(existsSync(dead.directory)); assert.deepEqual(hashes(), before);
  } finally {
    await stop(dead.child); removeOwn(dead.directory); removeOwn(unknown);
  }
});

test("PID reuse cannot remove the replacement owner's work", async () => {
  const dead = await owner(), live = await owner();
  try {
    await stop(dead.child);
    const marker = path.join(dead.directory, '.rogue-owner.json');
    const record = JSON.parse(readFileSync(marker, 'utf8'));
    writeFileSync(marker, JSON.stringify({ ...record, owner_pid: live.child.pid, owner_start: '1' }));
    const probe = spawnSync(python, [registry, 'query', '--pid', String(live.child.pid)], {encoding:'utf8'});
    assert.equal(probe.status, 0, probe.stderr);
    const identity = JSON.parse(probe.stdout);
    recover();
    // A replacement PID's busy descendants may conservatively retain the old
    // directory too; its current work must always remain intact.
    if (identity.status === 'unknown') assert.ok(existsSync(dead.directory));
    assert.ok(existsSync(live.directory));
    const current = JSON.parse(readFileSync(path.join(live.directory, '.rogue-owner.json'), 'utf8'));
    assert.equal(current.owner_pid, live.child.pid);
    assert.notEqual(current.owner_start, '1');
  } finally {
    await stop(dead.child); await stop(live.child, false);
    removeOwn(dead.directory); removeOwn(live.directory);
  }
});

test("restricted process snapshots defer recovery", async () => {
  const dead=await owner(),before=hashes();
  try {
    await stop(dead.child);
    const script=`import sys;sys.path.insert(0,${JSON.stringify(path.join(root,'tools'))});import artifact_registry as registry
registry.snapshot=lambda: (_ for _ in ()).throw(OSError('Process list is restricted'))
registry.recover(${JSON.stringify(root)})`;
    const probe=spawnSync(python,['-c',script],{encoding:'utf8'});
    assert.equal(probe.status,0,probe.stderr);
    assert.match(probe.stderr,/recovery deferred/);
    assert.ok(existsSync(dead.directory));assert.deepEqual(hashes(),before);
  } finally {await stop(dead.child);removeOwn(dead.directory);}
});

test("two simultaneous recoveries can safely claim the same abandoned directory", async () => {
  const dead = await owner();
  try {
    await stop(dead.child);
    const runs = [0, 1].map(() => spawn(python, ['-c',recoveryScript()], { stdio: 'ignore', windowsHide: true }));
    const statuses = await Promise.all(runs.map(child => once(child, 'close')));
    assert.deepEqual(statuses.map(([code]) => code), [0, 0]);
    assert.equal(existsSync(dead.directory), false);
  } finally { await stop(dead.child); removeOwn(dead.directory); }
});

test("a partially failed cleanup retains ownership and can be retried", async () => {
  const dead=await owner();
  try {
    await stop(dead.child);
    const blocked=path.join(dead.directory,'locked.bin');writeFileSync(blocked,'temporarily locked');
    const script=recoveryScript(`from pathlib import Path
unlink=Path.unlink
def fail_once(p,*a,**k):
    if p.name=='locked.bin': raise PermissionError('test locked file')
    return unlink(p,*a,**k)
Path.unlink=fail_once`);
    const probe=spawnSync(python,['-c',script],{encoding:'utf8'});
    assert.equal(probe.status,0,probe.stderr);
    assert.ok(existsSync(blocked));assert.ok(existsSync(path.join(dead.directory,'.rogue-owner.json')));
    recover();assert.equal(existsSync(dead.directory),false);
  } finally {await stop(dead.child);removeOwn(dead.directory);}
});
