/** Node regression host only. The product Worker implements this boundary in Rust. */
export async function createStandaloneGame(wasmBytes, host, printErr = () => {}) {
  let exports;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const heap = () => {
    if (!(exports?.memory instanceof WebAssembly.Memory)) throw new Error('Game memory unavailable');
    return new Uint8Array(exports.memory.buffer);
  };
  const borrowed = (pointer, length) => {
    const memory = heap();
    if (!Number.isInteger(pointer) || !Number.isInteger(length) || pointer < 0 || length < 0
        || pointer + length > memory.length) throw new Error('Game buffer outside memory');
    return memory.subarray(pointer, pointer + length);
  };
  const imports = {
    rogue: {
      read_event: () => host.readEvent(),
      flush_input: () => host.flushInput(),
      present: (pointer, length) => {
        // The test host keeps values, never views of the C/Rust borrowed memory.
        host.present(decoder.decode(borrowed(pointer, length)));
      },
      store: (pointer, length) => host.store(borrowed(pointer, length).slice()),
      outcome: (code, pointer, length) => host.outcome(code, decoder.decode(borrowed(pointer, length))),
      clock_milliseconds: () => Date.now(),
      calendar_year: () => new Date().getFullYear(),
      diagnostic: (pointer, length) => printErr(decoder.decode(borrowed(pointer, length))),
    },
    wasi_snapshot_preview1: {
      proc_exit: (code) => { throw new Error('Unexpected WASI process exit: ' + code); },
    },
  };
  ({ instance: { exports } } = await WebAssembly.instantiate(wasmBytes, imports));
  for (const name of ['_initialize', 'rg_alloc', 'rg_dealloc', 'rg_configure', 'rg_run', 'rg_snapshot_json', 'rg_string_free']) {
    if (typeof exports[name] !== 'function') throw new Error('Missing standalone game export: ' + name);
  }
  // Match the old test module's numeric-export/snapshot interface, without a
  // filesystem or ccall implementation. New-game entry uses the explicit ABI.
  const module = {};
  for (const [name, value] of Object.entries(exports)) {
    if (typeof value === 'function') module['_' + name] = value;
  }
  Object.defineProperty(module, 'HEAPU8', { get: heap });
  module.UTF8ToString = (pointer) => {
    const memory = heap();
    if (!Number.isInteger(pointer) || pointer < 0 || pointer >= memory.length) throw new Error('String outside game memory');
    const end = memory.indexOf(0, pointer);
    if (end < 0) throw new Error('Unterminated game string');
    return decoder.decode(memory.subarray(pointer, end));
  };
  const transfer = (bytes, action) => {
    const pointer = exports.rg_alloc(bytes.length);
    if (!pointer) throw new Error('Game transfer allocation failed');
    try {
      // rg_alloc may grow memory; acquire the view after the allocation.
      borrowed(pointer, bytes.length).set(bytes);
      return action(pointer);
    } finally {
      exports.rg_dealloc(pointer, bytes.length);
    }
  };
  module.configureStartup = (config = {}) => {
    const request = {
      locale: config.locale ?? 'en',
      trace: true,
      message_paging: config.messagePaging === 'legacy' ? 'classic' : config.messagePaging ?? 'classic',
      restore: config.restore ?? null,
    };
    if (config.fixture !== undefined) request.fixture = config.fixture;
    const bytes = Buffer.from(JSON.stringify(request), 'utf8');
    const code = transfer(bytes, (pointer) => exports.rg_configure(pointer, bytes.length));
    if (code !== 0) throw new Error('Startup configuration rejected: ' + code);
  };
  module.run = (seed, name) => {
    if (typeof name !== 'string') throw new Error('Player name must be a string');
    return transfer(Buffer.from(name + '\0', 'utf8'), (pointer) => exports.rg_run(seed, pointer));
  };
  exports._initialize();
  return module;
}
