import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pythonExecutable, browserExecutable, loadPlaywright} from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function walk(directory) {for (const entry of readdirSync(directory, {withFileTypes: true})) {
  if (/^(output.*|.*results|baseline-src|baseline-diffs|split-diffs|__pycache__)$/.test(entry.name)) continue;
  const file = path.join(directory, entry.name);
  if (entry.isDirectory()) walk(file); else files.push(file);
}}
walk(path.join(root, 'tests'));
const native=[];
function rustSources(directory){for(const e of readdirSync(directory,{withFileTypes:true})){
  const p=path.join(directory,e.name);if(e.isDirectory()&&e.name!=='target')rustSources(p);
  else if(e.isFile()&&p.endsWith('.rs'))native.push(p);
}}
rustSources(path.join(root,'rust/src'));rustSources(path.join(root,'rust/crates'));
const helpers = ['toolchain.mjs', 'compiler-workspace.mjs', 'compiler_workspace.py', 'run-clean.mjs', 'build.py',
  'check-rust-layers.py', 'rust_linker.py', 'temporary-artifacts.mjs', 'temporary_artifacts.py', 'artifact_registry.py', 'verify-japanese.py'].map(f => path.join(root, 'tools', f));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('every test and its shared execution helpers exclude platform shell dependencies and fixed machine paths', () => {
  const forbidden = new RegExp(['\\.' + ['ps', '1'].join(''), ['power', 'shell'].join(''), ['pw', 'sh'].join(''), 'C:[/\\\\]', ['codex', 'runtimes'].join('-')].join('|'), 'i');
  const inspected = [...files, ...helpers, ...native].filter(f => /\.(mjs|py|md|c|h|inc|rs)$/.test(f));
  for (const file of inspected) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, forbidden, path.relative(root, file));
    assert.doesNotMatch(text, /skip:\s*process\.platform|skipUnless\([^\n]*(?:win32|Windows)/, path.relative(root, file));
  }
  assert.equal(files.some(f => f.endsWith('.' + ['ps', '1'].join(''))), false);
  const beforePath = path.join(root, '.local/test-portability-before.json');
  const before = existsSync(beforePath) ? JSON.parse(readFileSync(beforePath, 'utf8')) : {};
  const current = Object.fromEntries([...files,...native].map(f => [path.relative(root, f).split(path.sep).join('/'), hash(f)]));
  const report = {passed: true, inspected: inspected.length, shellDependencies: 0, fixedMachinePaths: 0,
    changed: Object.entries(current).filter(([f, h]) => before[f] && before[f].sha256 !== h).map(([file, sha256]) => ({file, before: before[file].sha256, after: sha256})),
    unchanged: Object.entries(current).filter(([f,h])=>before[f]?.sha256===h).map(([file,sha256])=>({file,sha256})),
    deleted: Object.keys(before).filter(f => !existsSync(path.join(root, f))),
    added: Object.entries(current).filter(([f]) => !before[f]).map(([file, sha256]) => ({file, sha256})),
    assertionCounts: Object.entries(before).filter(([f,v])=>v.assertions&&existsSync(path.join(root,f))).map(([file,v])=>({file,before:v.assertions,after:(readFileSync(path.join(root,file),'utf8').match(/\b(?:assert(?:\.[a-zA-Z_]+|_\w+)?!?|self\.assert\w+)\s*\(/g)||[]).length})),
    inspectedFiles: inspected.map(f => ({file: path.relative(root, f).split(path.sep).join('/'), sha256: hash(f)}))};
  mkdirSync(path.join(root, '.local'), {recursive: true});
  writeFileSync(path.join(root, '.local/test-portability-evidence.json'), JSON.stringify(report, null, 2) + '\n');
});

test('configured tools and browser are used without a platform-specific fallback', () => {
  const python = pythonExecutable();
  const result = spawnSync(python, ['-c', 'print("portable-python")'], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'portable-python');
  const {chromium, modulePath} = loadPlaywright(); assert.ok(modulePath);
  assert.equal(browserExecutable(), process.env.ROGUE_CHROME || chromium.executablePath());
  const previous = process.env.ROGUE_TEST_PYTHON;
  try {
    process.env.ROGUE_TEST_PYTHON = path.join(root, '.local/nonexistent-python');
    assert.throws(pythonExecutable, /Python 3 is required/);
  } finally {if (previous === undefined) delete process.env.ROGUE_TEST_PYTHON; else process.env.ROGUE_TEST_PYTHON = previous;}
});
