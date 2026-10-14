import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {compilerWorkspace} from '../tools/compiler-workspace.mjs';
import {pythonExecutable, run} from '../tools/toolchain.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2);
const environmentOptions = {'--python': 'ROGUE_TEST_PYTHON', '--playwright': 'ROGUE_PLAYWRIGHT_MODULE', '--browser': 'ROGUE_CHROME', '--sdk-root': 'EMSDK'};
let keep = false, list = false;
const selected = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--keep-artifacts') {keep = true; continue;}
  if (arg === '--list') {list = true; continue;}
  if (arg === '--env' || arg in environmentOptions) {
    const value = args[++i]; if (!value) throw Error('Missing value for ' + arg);
    if (arg === '--env') {
      const split = value.indexOf('='); if (split < 1) throw Error('--env requires NAME=value');
      process.env[value.slice(0, split)] = value.slice(split + 1);
    } else process.env[environmentOptions[arg]] = value;
    continue;
  }
  if (arg.startsWith('--')) throw Error('Unknown option: ' + arg);
  selected.push(arg);
}
if (list) {
  const files = [];
  const walk = directory => {for (const e of readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, e.name);
    if (e.isDirectory() && !/output|results|baseline|diffs|__pycache__/.test(e.name)) walk(file);
    else if (e.isFile() && !['browser-runtime.mjs','ja-scenarios.mjs','playwright-cdp.mjs','test-adapter.mjs'].includes(e.name) && /(?:\.test\.(?:mjs|py)|browser-smoke[/\\][^/\\]+\.mjs)$/.test(file)) files.push(path.relative(root, file).split(path.sep).join('/'));
  }};
  walk(path.join(root, 'tests')); console.log(JSON.stringify(files.sort(), null, 2));
} else {
  if (!selected.length) throw Error('Select wording, messages, save, native, or test file paths. Use --list to inspect tests.');
  const scope = compilerWorkspace(root, keep || process.env.ROGUE_KEEP_ARTIFACTS === '1');
  const exec = (command, argv) => run(command, argv, {cwd: root});
  try {
    for (const test of selected) {
      if (test === 'wording') exec(process.execPath, ['tests/wording.test.mjs']);
      else if (test === 'messages' || test === 'save') exec(pythonExecutable(), [test === 'messages' ? 'tests/build-message-tests.py' : 'tests/build-save-adapter.py']);
      else if (test === 'native') exec('cargo', ['test', '--offline', '--locked', '--manifest-path', 'rust/Cargo.toml', '--workspace', '--exclude', 'rogue-layers', '--lib']);
      else {
        const file = path.resolve(root, test), relative = path.relative(path.join(root, 'tests'), file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test must be inside tests/: ' + test);
        if (file.endsWith('.py')) exec(pythonExecutable(), [file]);
        else if (file.endsWith('.mjs')) exec(process.execPath, [...(file.endsWith('.test.mjs') ? ['--test'] : []), file]);
        else throw Error('Unsupported test file: ' + test);
      }
    }
  } finally {scope.close();}
}
