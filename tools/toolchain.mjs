import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const require = createRequire(import.meta.url);
export function pythonExecutable() {
  const configured = process.env.ROGUE_TEST_PYTHON || process.env.EMSDK_PYTHON;
  for (const executable of configured ? [configured] : ['python3', 'python']) {
    const result = spawnSync(executable, ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8', windowsHide: true});
    if (result.status === 0) return result.stdout.trim();
  }
  throw Error('Python 3 is required. Set ROGUE_TEST_PYTHON or add Python to PATH.');
}

export function loadPlaywright() {
  const candidates = process.env.ROGUE_PLAYWRIGHT_MODULE ? [process.env.ROGUE_PLAYWRIGHT_MODULE] : ['playwright', 'playwright-core'];
  for (const candidate of candidates) {
    let modulePath;
    try { modulePath = require.resolve(candidate); }
    catch (error) { if (error.code === 'MODULE_NOT_FOUND') continue; throw error; }
    const playwright = require(modulePath);
    if (!playwright.chromium) throw Error('Configured Playwright module has no Chromium driver: ' + candidate);
    return {playwright, chromium: playwright.chromium, modulePath};
  }
  throw Error('Install Playwright or set ROGUE_PLAYWRIGHT_MODULE to its package path.');
}

export function browserExecutable() {
  return process.env.ROGUE_CHROME || loadPlaywright().chromium.executablePath();
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', windowsHide: true, ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${path.basename(command)} failed (${result.status ?? result.signal})`);
  return result;
}
