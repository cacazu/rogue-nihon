import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { assertEquivalent } from './compare-traces.mjs';

const require = createRequire(import.meta.url);
export const SAVE_EVENT = 0x120001;
export const END_EVENT = 0x120002;

export function textEvents(text) {
  if (!/^[\x00-\x7f]*$/.test(text)) throw new Error('Script keys must be ASCII');
  return Array.from(text, (key) => key.charCodeAt(0));
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Compare the C screen/state projection; translated UI metadata is additional
 * presentation evidence and remains preserved in each raw result file. */
export function originalFrames(frames) {
  return frames.map(({ cells, width, height, player, stats }) => ({ cells, width, height, player, stats }));
}

/** Use a fresh Wasm instance; scripts represent future user events, not typeahead. */
export async function runGame(modulePath, config = {}) {
  const events = config.events ?? textEvents(config.text ?? '');
  if (!Array.isArray(events) || events.some((event) => !Number.isInteger(event) || event < 0 || event > 0xffffffff)) {
    throw new Error('events must be uint32 browser event values');
  }
  const result = { seed: config.seed ?? 1, traces: [], frames: [], frame_contexts: [], presentations: [],
    input_contexts: [], messages: [], reads: [], flushes: [], stores: [],
    store_contexts: [], outcomes: [], stderr: [] };
  const jsBytes = await readFile(resolve(modulePath));
  const wasmBytes = await readFile(resolve(modulePath).replace(/\.(?:c?js)$/, '.wasm'));
  result.module = { javascript_sha256: digest(jsBytes), wasm_sha256: digest(wasmBytes) };
  let position = 0;
  globalThis.RogueHost = {
    readEvent() {
      // Test-only legacy comparison: acknowledge the currently observed C More,
      // representing explicit reader responses, never production input injection.
      const more = config.acknowledgeMore && result.frames.at(-1)?.cells.includes('--More--');
      const value = more ? 32 : position < events.length ? events[position++] : END_EVENT;
      result.reads.push({ position, event: value, trace: result.traces.length - 1 });
      return value | 0;
    },
    present(raw) {
      const value = JSON.parse(raw);
      if (value.type === 'trace') {
        if (value.words?.length !== 20) throw new Error('Trace must contain all 20 ABI words');
        result.traces.push({ words: value.words, input_index: value.input_index });
      } else if (value.type === 'frame') {
        result.frames.push({ ...value, sha256: digest(JSON.stringify(value)) });
        result.frame_contexts.push({ read_position: position, trace_index: result.traces.length - 1 });
      } else if (value.type === 'input-context') {
        result.input_contexts.push(value);
      } else if (value.type === 'presentation') {
        result.presentations.push(value);
      } else if (value.type === 'message') {
        result.messages.push(value);
      }
      if (result.traces.length > 100000 || result.frames.length > 100000) throw new Error('Game output limit exceeded');
    },
    store(bytes) {
      result.stores.push(Buffer.from(bytes).toString('utf8'));
      // Observe the already emitted host events. No C call, repaint, input read
      // or rule update occurs while recording this save-position evidence.
      result.store_contexts.push(structuredClone({
        read_position: position,
        frame_index: result.frames.length - 1,
        trace_index: result.traces.length - 1,
        frame: result.frames.at(-1) ?? null,
        trace: result.traces.at(-1) ?? null,
        input_context: result.input_contexts.at(-1) ?? null,
        read: result.reads.at(-1) ?? null,
      }));
    },
    outcome(code, text) { result.outcomes.push({ code, text }); },
    // Original flush discards already queued typeahead. These events are future
    // scripted user actions and remain available after the game asks for them.
    flushInput() { result.flushes.push({ position, trace: result.traces.length - 1 }); },
  };
  const factory = require(resolve(modulePath));
  const module = await factory({ printErr: (line) => result.stderr.push(String(line)), print: () => {} });
  if (config.repaint > 0 && typeof module._rg_test_repaint !== 'function') {
    throw new Error('Repaint regression checks require an explicit test-hooks (-TestHooks or -TestFixtures) build');
  }
  module.FS.writeFile('/trace.enabled', '1');
  module.FS.writeFile('/locale.txt', config.locale ?? 'en');
  if (config.messagePaging !== undefined) module.FS.writeFile('/message-paging.txt', config.messagePaging);
  if (config.fixture !== undefined) module.FS.writeFile('/fixture.id', config.fixture);
  if (config.restore !== undefined) module.FS.writeFile('/restore.json', config.restore);
  result.code = module.ccall('rg_run', 'number', ['number', 'string'], [result.seed, config.name ?? 'Test']);
  result.consumed = position;
  const snapshot = () => {
    const pointer = module._rg_snapshot_json();
    if (!pointer) throw new Error('Snapshot allocation failed');
    try { return JSON.parse(module.UTF8ToString(pointer)); }
    finally { module._rg_string_free(pointer); }
  };
  result.final = snapshot();
  if (config.repaint > 0) {
    const before = result.final;
    const traceCount = result.traces.length;
    for (let count = 0; count < config.repaint; count += 1) module._rg_test_repaint();
    assertEquivalent(before, snapshot(), 'Rust repaint C state');
    if (result.traces.length !== traceCount) throw new Error('Rust repaint performed a C input read');
    result.repaint_pure = config.repaint;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , modulePath, configPath, outputPath] = process.argv;
  if (!modulePath || !configPath || !outputPath) {
    process.stderr.write('Usage: node run-game.mjs MODULE.js CONFIG.json OUTPUT.json\n');
    process.exitCode = 2;
  } else {
    try {
      const config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''));
      const result = await runGame(modulePath, config);
      await writeFile(outputPath, JSON.stringify(result, null, 2));
      process.stdout.write(JSON.stringify({ code: result.code, consumed: result.consumed, traces: result.traces.length, frames: result.frames.length, stores: result.stores.length }) + '\n');
    } catch (error) {
      process.stderr.write(`${error.stack}\n`);
      process.exitCode = 1;
    }
  }
}
