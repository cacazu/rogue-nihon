import test from "node:test";
import assert from "node:assert/strict";
import {copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const text = file => readFile(path.join(root, file), "utf8");

async function webSources(directory = "web") {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
    const file = directory + "/" + entry.name;
    if (entry.isDirectory()) files.push(...await webSources(file));
    else if (/\.(?:[cm]?js|html)$/i.test(entry.name)) files.push(file);
  }
  return files.sort();
}

test("shipped browser modules exclude the local server, tests and artifact management", async () => {
  const files = await webSources();
  assert.deepEqual(files.filter(file => /\.[cm]?js$/i.test(file)), ["web/abi.js", "web/app.js", "web/worker.js"],
    "Every shipped JavaScript file is a startup entry point or generated ABI data");
  for (const file of files) {
    const source = await text(file);
    assert.doesNotMatch(source, /__rogueBrowserTest|RogueCanvasUi\.active|recoverTemporaryArtifacts|artifact-registry|temporary.artifacts|ROGUE_KEEP_ARTIFACTS|node:/, file);
    for (const [, dependency] of source.matchAll(/(?:from\s*|import\s*\(|importScripts\s*\(|require\s*\()\s*["']([^"']+)/g)) {
      assert.ok(dependency.startsWith("/web/") || dependency === "/build/game.js" || dependency === "/build/browser-ui.js", file + " -> " + dependency);
    }
    if (file.endsWith(".html")) {
      assert.doesNotMatch(source, /\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*javascript:/i,
        file + " must not contain JavaScript event handlers or URLs");
      const scripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
      assert.equal(scripts.length, [...source.matchAll(/<script\b/gi)].length,
        file + " script tags must have an explicit closing tag");
      for (const [, attributes, body] of scripts) {
        const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
        assert.equal(src, "/web/app.js", file + " loads the common Wasm startup only");
        assert.match(attributes, /\btype\s*=\s*["']module["']/i, file);
        assert.equal(body.trim(), "", file + " must not contain inline JavaScript");
      }
    }
  }
  assert.doesNotMatch(await text("web/index.html"), /tests\/|tools\/|fixture|artifact/i);
  const previewSource = await readFile(new URL("../../tools/server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(previewSource, /tests[\\/]|recoverTemporaryArtifacts|artifact-registry|temporary.artifacts/);
  assert.doesNotMatch(previewSource, /test-adapter|__rogueBrowserTest/);
  assert.doesNotMatch(previewSource, /web[\\/]server\.mjs/);
});

test("the published browser binding only transfers complete Rust-rendered pixels", async () => {
  const ui = await WebAssembly.compile(await readFile(path.join(root, "build/browser-ui.wasm")));
  const imports = WebAssembly.Module.imports(ui).map(({name}) => name);
  const rasterApi = /(?:fillRect|strokeRect|clearRect|fillText|strokeText|measureText|drawImage|Path2[dD]|CanvasGradient|CanvasPattern|HtmlImageElement|ImageBitmap|new_with_path_string|createImageBitmap|createLinearGradient|createRadialGradient|createConicGradient|createPattern|rotate|roundRect|beginPath|closePath|moveTo|lineTo|bezierCurveTo|quadraticCurveTo|ellipse|arc|clip|stroke|fill|translate|scale|setTransform|resetTransform|getTransform|getImageData)(?:_|\b)/;
  for (const name of imports) {
    assert.doesNotMatch(name, rasterApi, "Browser pixel generation must not be imported: " + name);
    assert.doesNotMatch(name, /__wbg_decode_/, "PNG decoding must run in Rust: " + name);
  }
  assert.ok(imports.some(name => /__wbg_putImageData_/.test(name)), "Complete RGBA transfer must remain available");
  const binding = await text("build/browser-ui.js");
  assert.doesNotMatch(binding, rasterApi, "Generated JavaScript must not contain browser rasterization or image decoding");
  // wasm-bindgen still needs TextDecoder for its string ABI. Its generated image
  // decode import and Image constructor are distinct from that mechanical conversion.
  assert.doesNotMatch(binding, /__wbg_decode_|\bnew\s+(?:Image|Path2D|ImageBitmap|OffscreenCanvas)\s*\(/,
    "Images must be decoded and rasterized in Rust");
  assert.match(binding, /\.putImageData\s*\(/, "The browser receives completed Rust pixels");
});

test("production compiler entry points do not register or recover interrupted runs", async () => {
  for (const file of ["tools/build.py", "tools/compiler_workspace.py", "tools/compiler-workspace.mjs", "tools/generate_catalog.py", "tools/generate_game_ui.py", "tools/generate_entities.py"]) {
    assert.doesNotMatch(await text(file), /artifact-registry|artifact-processes|recoverTemporaryArtifacts|Invoke-RogueRecovery/, file);
  }
  assert.match(await text("tools/build.py"), /options.output_name == 'game' and \(hooks or options.logic_directory\)/);
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
  assert.ok(WebAssembly.Module.imports(module).every(entry=>!entry.name.startsWith("js_rg_")));
  const ui = await WebAssembly.compile(await readFile(path.join(root, "build/browser-ui.wasm")));
  assert.ok(WebAssembly.Module.imports(ui).every(({name})=>/^__wbg_|^__wbindgen_/.test(name)));
  for(const name of ["policy_request","browser_request","browser_snapshot","ui_request","rotate_pixels"])
    assert.ok(WebAssembly.Module.exports(ui).every(entry=>entry.name!==name),name);
  assert.doesNotMatch(await text("build/browser-ui.js"), /export (?:function|class) (?:policy_request|browser_request|browser_snapshot|EventQueue|TilePainter)/);
  const manifest = JSON.parse(await text("build/build-manifest.json"));
  assert.equal(manifest.test_hooks, false);
  assert.equal(manifest.test_fixtures, false);
});

test("explicit regression builds retain the hooks without modifying the published game", async () => {
  const module = await WebAssembly.compile(await readFile(path.join(root, "build/game-fixtures.wasm")));
  const exports = WebAssembly.Module.exports(module).map(entry => entry.name);
  for (const name of ["rg_test_repaint", "rg_test_save_roundtrip"]) assert.ok(exports.includes(name), name);
});

test("compiler workspace lifecycle works without recovery registry or process-query tools", async () => {
  const parent=await realpath(path.join(root,'.local'));
  const project=await mkdtemp(path.join(parent,'production-compile-'));
  try {
    await mkdir(path.join(project,'tools'));
    const helper=path.join(project,'tools/compiler-workspace.mjs');
    await copyFile(path.join(root,'tools/compiler-workspace.mjs'),helper);
    const {pathToFileURL}=await import('node:url');
    const script=`import {compilerWorkspace} from ${JSON.stringify(pathToFileURL(helper).href)};
      import {existsSync,writeFileSync} from 'node:fs';import path from 'node:path';
      delete process.env.CARGO_TARGET_DIR;
      const scope=compilerWorkspace(${JSON.stringify(project)});const owned=scope.directory;
      try{writeFileSync(path.join(owned,'partial.wasm'),'partial');}finally{scope.close();}
      if(existsSync(owned)||process.env.CARGO_TARGET_DIR!==undefined)throw Error('Incomplete compiler cleanup');
      console.log('PASS');`;
    const run=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',windowsHide:true,env:{...process.env,ROGUE_KEEP_ARTIFACTS:'0',ROGUE_ARTIFACT_SCOPE:''}});
    assert.equal(run.status,0,run.stderr+run.stdout);assert.equal(run.stdout.trim(),'PASS');
  } finally {
    assert.equal(await realpath(project),project);assert.equal(path.dirname(project),parent);
    assert.ok(path.basename(project).startsWith('production-compile-'));await rm(project,{recursive:true,force:true});
  }
});
