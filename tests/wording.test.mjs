import {fileURLToPath} from 'node:url';
import {compilerWorkspace} from '../tools/compiler-workspace.mjs';
import {pythonExecutable, run} from '../tools/toolchain.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const options = new Set(process.argv.slice(2));
for (const arg of options) if (!['--skip-build', '--keep-artifacts'].includes(arg)) throw Error('Unknown option: ' + arg);
const scope = compilerWorkspace(root, options.has('--keep-artifacts') || process.env.ROGUE_KEEP_ARTIFACTS === '1');
try {
  const python = pythonExecutable(), exec = (command, args) => run(command, args, {cwd: root});
  exec(python, ['tools/generate_catalog.py', ...(options.has('--skip-build') ? ['--check'] : [])]);
  for (const test of ['tests/catalog.test.py', 'tests/localization.test.py']) exec(python, [test]);
  exec('cargo', ['test', '--offline', '--locked', '--manifest-path', 'rust/Cargo.toml', '--release', '-p', 'rogue-display', '-p', 'rogue-browser-display', '--lib', 'all_catalog']);
  if (!options.has('--skip-build')) {
    exec(python, ['tools/build.py', '--skip-catalog-generation', '--keep-artifacts']);
    exec(python, ['tools/build.py', '--output-name', 'game-fixtures', '--test-fixtures', '--skip-catalog-generation', '--keep-artifacts']);
  }
  for (const test of ['wording-catalog', 'arrow-consumption', 'pickup-quantity']) exec(process.execPath, ['tests/browser-smoke/' + test + '.mjs']);
} finally {scope.close();}
