import {compilerWorkspace} from './compiler-workspace.mjs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const args = process.argv.slice(2), keepIndex = args.indexOf('--keep-artifacts');
if (keepIndex !== -1) args.splice(keepIndex, 1);
if (!args.length) throw Error('Usage: node tools/run-clean.mjs [--keep-artifacts] COMMAND [ARGUMENTS...]');
const scope = compilerWorkspace(fileURLToPath(new URL('../', import.meta.url)), keepIndex !== -1 || process.env.ROGUE_KEEP_ARTIFACTS === '1');
try {
  const result = spawnSync(args[0], args.slice(1), {stdio: 'inherit', windowsHide: true});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {scope.close();}
