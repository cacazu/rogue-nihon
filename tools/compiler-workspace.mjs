import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, lstatSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

function noLinks(directory, boundary) {
  for (let p = directory; p !== boundary; p = path.dirname(p)) {
    if (p === path.dirname(p) || (existsSync(p) && lstatSync(p).isSymbolicLink())) throw Error('Unsafe compiler workspace path');
  }
}

export function compilerWorkspace(project, keep = process.env.ROGUE_KEEP_ARTIFACTS === '1') {
  project = realpathSync(project);
  const base = path.join(project, '.local', 'tasks');
  noLinks(base, project); mkdirSync(base, {recursive: true});
  const inherited = process.env.ROGUE_ARTIFACT_SCOPE;
  if (inherited) {
    const directory = realpathSync(inherited);
    if (path.dirname(directory) !== base || !existsSync(path.join(directory, 'owner.txt'))) throw Error('Invalid inherited compiler workspace');
    noLinks(directory, project);
    return {directory, build: process.env.ROGUE_ARTIFACT_BUILD || path.join(directory, 'build'), close() {}};
  }
  const directory = mkdtempSync(path.join(base, 'node-'));
  const token = path.basename(directory); writeFileSync(path.join(directory, 'owner.txt'), token);
  const build = keep ? path.join(project, 'build') : path.join(directory, 'build');
  const temp = path.join(directory, 'temp');
  for (const p of [build, temp]) mkdirSync(p, {recursive: true});
  const settings = {ROGUE_ARTIFACT_SCOPE: directory, ROGUE_ARTIFACT_BUILD: build,
    CARGO_TARGET_DIR: path.join(directory, 'cargo-target'), EM_CACHE: path.join(directory, 'em-cache'),
    TEMP: temp, TMP: temp, TMPDIR: temp, PYTHONDONTWRITEBYTECODE: '1', ROGUE_KEEP_ARTIFACTS: keep ? '1' : '0'};
  const previous = new Map(Object.keys(settings).map(k => [k, process.env[k]])); Object.assign(process.env, settings);
  let closed = false;
  return {directory, build, close() {
    if (closed) return; closed = true;
    try {
      if (!keep && existsSync(directory)) {
        noLinks(directory, project);
        const inspect = p => {for (const entry of readdirSync(p, {withFileTypes: true})) {
          if (entry.isSymbolicLink()) throw Error('Compiler cleanup must not traverse links');
          if (entry.isDirectory()) inspect(path.join(p, entry.name));
        }};
        inspect(directory);
        if (realpathSync(directory) !== directory || readFileSync(path.join(directory, 'owner.txt'), 'utf8') !== token) throw Error('Unsafe compiler cleanup target');
        rmSync(directory, {recursive: true, force: true});
      }
    } finally {for (const [k, v] of previous) {if (v === undefined) delete process.env[k]; else process.env[k] = v;}}
  }};
}
