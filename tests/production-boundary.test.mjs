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

// Inspect the compiled core's wire types, rather than trusting source names or
// generator settings. Every host call must use fixed-width numeric arguments.
function coreImports(bytes) {
  let position = 8;
  const byte = () => bytes[position++];
  const integer = () => {
    let value = 0, shift = 0, next;
    do {
      next = byte();
      value |= (next & 0x7f) << shift;
      shift += 7;
      assert.ok(shift <= 35, "Invalid Wasm integer");
    } while (next & 0x80);
    return value >>> 0;
  };
  const name = () => {
    const length = integer(), start = position;
    position += length;
    return bytes.subarray(start, position).toString("utf8");
  };
  const vector = read => Array.from({length: integer()}, read);
  const types = [], imports = [];
  while (position < bytes.length) {
    const section = byte(), length = integer(), end = position + length;
    if (section === 1) {
      types.push(...vector(() => {
        assert.equal(byte(), 0x60, "The core uses ordinary function types");
        return {parameters: vector(byte), results: vector(byte)};
      }));
    } else if (section === 2) {
      imports.push(...vector(() => {
        const module = name(), field = name();
        assert.equal(byte(), 0, "The core imports functions only");
        return {module, name: field, kind: "function", ...types[integer()]};
      }));
    }
    position = end;
  }
  return imports.sort((a, b) => `${a.module}.${a.name}`.localeCompare(`${b.module}.${b.name}`));
}

test("shipped browser modules exclude the local server, tests and artifact management", async () => {
  const files = await webSources();
  assert.deepEqual(files.filter(file => /\.[cm]?js$/i.test(file)), ["web/app.js", "web/worker.js"],
    "Every shipped JavaScript source file is a Wasm startup entry point");
  for (const file of files) {
    const source = await text(file);
    assert.doesNotMatch(source, /__rogueBrowserTest|RogueCanvasUi\.active|recoverTemporaryArtifacts|artifact-registry|temporary.artifacts|ROGUE_KEEP_ARTIFACTS|node:/, file);
    for (const [, dependency] of source.matchAll(/(?:from\s*|import\s*\(|importScripts\s*\(|require\s*\()\s*["']([^"']+)/g)) {
      assert.ok(dependency.startsWith("/web/") || dependency === "/build/browser-ui.js", file + " -> " + dependency);
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
  assert.doesNotMatch(binding, /__wbg_decode_|\bnew\s+(?:Image|Path2D|ImageBitmap|OffscreenCanvas)\s*\(/,
    "Images must be decoded and rasterized in Rust");
  assert.match(binding, /\.putImageData\s*\(/, "The browser receives completed Rust pixels");
});

test("published JavaScript only starts Wasm and connects browser APIs", async () => {
  const binding = await text("build/browser-ui.js");
  assert.doesNotMatch(binding, /\bTextEncoder\b|\bTextDecoder\b|JSON\s*\.\s*(?:parse|stringify)\b|\bdebugString\b|\bdecodeText\b|MAX_SAFARI_DECODE_BYTES|numBytesDecoded/,
    "Value traversal and UTF-8/UTF-16 conversion must execute in Rust");
  assert.doesNotMatch(binding, /Promise\s*\.\s*all\b|Object\s*\.\s*fromEntries\b|\b(?:for|while)\s*\(/,
    "Collection traversal and async request aggregation must execute in Rust");
  assert.doesNotMatch(binding, /__wbg_new_with_base_|\bnew\s+URLSearchParams\s*\(/,
    "Asset path resolution and query parsing must execute in Rust");
  assert.doesNotMatch(binding, /\b(?:MEMFS|SYSCALLS|UTF8ToString|stringToUTF8|allocateUTF8|ccall|cwrap|createRogueModule)\b|__syscall_/,
    "The browser binding must not include the old core runtime");
  assert.match(binding, /return wasm\.browser_decode_utf8\(ptr >>> 0, len\);/,
    "Browser strings must be decoded by the Rust codec");
  assert.match(binding, /const ret = wasm\.browser_encode_utf8\(arg\);/,
    "Browser strings must be encoded by the Rust codec");
  const published = await readdir(path.join(root, "build"));
  assert.equal(published.includes("game.js"), false, "The core has no JavaScript loader or runtime");
  const manifest = JSON.parse(await text("build/build-manifest.json"));
  assert.deepEqual(manifest.outputs.map(({file}) => file).sort(),
    ["browser-ui.js", "browser-ui.wasm", "game.wasm"]);
});

test("production compiler entry points do not register or recover interrupted runs", async () => {
  for (const file of ["tools/build.py", "tools/compiler_workspace.py", "tools/compiler-workspace.mjs", "tools/generate_catalog.py", "tools/generate_game_ui.py", "tools/generate_entities.py"]) {
    assert.doesNotMatch(await text(file), /artifact-registry|artifact-processes|recoverTemporaryArtifacts|Invoke-RogueRecovery/, file);
  }
  assert.match(await text("tools/build.py"), /options.output_name == 'game' and \(hooks or options.logic_directory\)/);
});

test("published Wasm excludes regression code and imports the fixed-width Rust host only", async () => {
  const bytes = await readFile(path.join(root, "build/game.wasm"));
  const module = await WebAssembly.compile(bytes);
  assert.ok(WebAssembly.Module.exports(module).some(entry => entry.name === "rg_run"));
  assert.ok(WebAssembly.Module.exports(module).every(entry => !entry.name.startsWith("rg_test_")));
  for (const token of ["rg_test_repaint", "rg_test_save_roundtrip", "rg_test_apply_fixture", "/fixture.id"]) {
    assert.equal(bytes.includes(Buffer.from(token)), false, token);
  }
  const i32 = 0x7f, f64 = 0x7c;
  const host = (name, parameters = [], results = []) => ({module:"rogue", name, kind:"function", parameters, results});
  const expected = [
    host("read_event", [], [i32]), host("flush_input"),
    host("present", [i32, i32]), host("store", [i32, i32]),
    host("outcome", [i32, i32, i32]), host("clock_milliseconds", [], [f64]),
    host("diagnostic", [i32, i32]), host("calendar_year", [], [i32]),
    {module:"wasi_snapshot_preview1", name:"proc_exit", kind:"function", parameters:[i32], results:[]},
  ].sort((a, b) => `${a.module}.${a.name}`.localeCompare(`${b.module}.${b.name}`));
  assert.deepEqual(coreImports(bytes), expected);
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
