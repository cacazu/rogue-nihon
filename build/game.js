// This code implements the `-sMODULARIZE` settings by taking the generated
// JS program code (INNER_JS_CODE) and wrapping it in a factory function.

// Single threaded MINIMAL_RUNTIME programs do not need access to
// document.currentScript, so a simple export declaration is enough.
var createRogueModule = (() => {
  // When MODULARIZE this JS may be executed later,
  // after document.currentScript is gone, so we save it.
  // In EXPORT_ES6 mode we can just use 'import.meta.url'.
  var _scriptName = globalThis.document?.currentScript?.src;
  return async function(moduleArg = {}) {
    var Module = moduleArg;
// include: shell.js
// include: minimum_runtime_check.js
(function() {
  // "30.0.0" -> 300000
  function humanReadableVersionToPacked(str) {
    str = str.split('-')[0]; // Remove any trailing part from e.g. "12.53.3-alpha"
    var vers = str.split('.').slice(0, 3);
    while(vers.length < 3) vers.push('00');
    vers = vers.map((n, i, arr) => n.padStart(2, '0'));
    return vers.join('');
  }
  // 300000 -> "30.0.0"
  var packedVersionToHumanReadable = n => [n / 10000 | 0, (n / 100 | 0) % 100, n % 100].join('.');

  var TARGET_NOT_SUPPORTED = 2147483647;

  // Note: We use a typeof check here instead of optional chaining using
  // globalThis because older browsers might not have globalThis defined.

  // We skip the node version checking when running on Bun/Deno since the node
  // version they report doesn't seem to be useful.
  if (typeof process !== 'undefined' && !process.versions?.bun && typeof Deno == "undefined") {
    var currentNodeVersion = process.versions?.node ? humanReadableVersionToPacked(process.versions.node) : TARGET_NOT_SUPPORTED;
    if (currentNodeVersion < 180300) {
      throw new Error(`This emscripten-generated code requires node v${ packedVersionToHumanReadable(180300) } (detected v${packedVersionToHumanReadable(currentNodeVersion)})`);
    }
  }

  var userAgent = typeof navigator !== 'undefined' && navigator.userAgent;
  if (!userAgent) {
    return;
  }

  var currentSafariVersion = userAgent.includes("Safari/") && !userAgent.includes("Chrome/") && userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/) ? humanReadableVersionToPacked(userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentSafariVersion < 150000) {
    throw new Error(`This emscripten-generated code requires Safari v${ packedVersionToHumanReadable(150000) } (detected v${currentSafariVersion})`);
  }

  var currentFirefoxVersion = userAgent.match(/Firefox\/(\d+(?:\.\d+)?)/) ? parseFloat(userAgent.match(/Firefox\/(\d+(?:\.\d+)?)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentFirefoxVersion < 79) {
    throw new Error(`This emscripten-generated code requires Firefox v79 (detected v${currentFirefoxVersion})`);
  }

  var currentChromeVersion = userAgent.match(/Chrome\/(\d+(?:\.\d+)?)/) ? parseFloat(userAgent.match(/Chrome\/(\d+(?:\.\d+)?)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentChromeVersion < 85) {
    throw new Error(`This emscripten-generated code requires Chrome v85 (detected v${currentChromeVersion})`);
  }
})();

// end include: minimum_runtime_check.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = !!globalThis.window;
var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


var programArgs = [];
var thisProgram = './this.program';
var quit_ = (status, toThrow) => {
  throw toThrow;
};

if (typeof __filename != 'undefined') { // Node
  _scriptName = __filename;
} else
if (ENVIRONMENT_IS_WORKER) {
  _scriptName = self.location.href;
}

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;

if (ENVIRONMENT_IS_NODE) {
  const isNode = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
  if (!isNode) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  // These modules will usually be used on Node.js. Load them eagerly to avoid
  // the complexity of lazy-loading.
  var fs = require('node:fs');

  scriptDirectory = __dirname + '/';

// include: node_shell_read.js
readBinary = (filename) => {
  // We need to re-wrap `file://` strings to URLs.
  filename = isFileURI(filename) ? new URL(filename) : filename;
  var ret = fs.readFileSync(filename);
  assert(Buffer.isBuffer(ret));
  return ret;
};

readAsync = async (filename, binary = true) => {
  // See the comment in the `readBinary` function.
  filename = isFileURI(filename) ? new URL(filename) : filename;
  var ret = fs.readFileSync(filename, binary ? undefined : 'utf8');
  assert(binary ? Buffer.isBuffer(ret) : typeof ret == 'string');
  return ret;
};
// end include: node_shell_read.js
  if (process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, '/');
  }

  programArgs = process.argv.slice(2);

  quit_ = (status, toThrow) => {
    process.exitCode = status;
    throw toThrow;
  };

} else
if (ENVIRONMENT_IS_SHELL) {

} else

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  try {
    scriptDirectory = new URL('.', _scriptName).href; // includes trailing slash
  } catch {
    // Must be a `blob:` or `data:` URL (e.g. `blob:http://site.com/etc/etc`), we cannot
    // infer anything from them.
  }

  if (!(globalThis.window || globalThis.WorkerGlobalScope)) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  {
// include: web_or_worker_shell_read.js
if (ENVIRONMENT_IS_WORKER) {
    readBinary = (url) => {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.send(null);
      return new Uint8Array(/** @type{!ArrayBuffer} */(xhr.response));
    };
  }

  readAsync = async (url) => {
    assert(!isFileURI(url), "readAsync does not work with file:// URLs");
    var response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) {
      return response.arrayBuffer();
    }
    throw new Error(response.status + ' : ' + response.url);
  };
// end include: web_or_worker_shell_read.js
  }
} else
{
  throw new Error('environment detection error');
}

var out = console.log.bind(console);
var err = console.error.bind(console);

var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var FETCHFS = 'FETCHFS is no longer included by default; build with -lfetchfs.js';
var ICASEFS = 'ICASEFS is no longer included by default; build with -licasefs.js';
var JSFILEFS = 'JSFILEFS is no longer included by default; build with -ljsfilefs.js';
var OPFS = 'OPFS is no longer included by default; build with -lopfs.js';

var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';

// perform assertions in shell.js after we set up out() and err(), as otherwise
// if an assertion fails it cannot print the message

assert(!ENVIRONMENT_IS_SHELL, 'shell environment detected but not enabled at build time (add `shell` to `-sENVIRONMENT` to enable)');

// end include: shell.js

// include: preamble.js
// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

var wasmBinary;

if (!globalThis.WebAssembly) {
  err('no native wasm support detected');
}

// Wasm globals

//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

// In STRICT mode, we only define assert() when ASSERTIONS is set.  i.e. we
// don't define it at all in release modes.  This matches the behaviour of
// MINIMAL_RUNTIME.
// TODO(sbc): Make this the default even without STRICT enabled.
/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed' + (text ? ': ' + text : ''));
  }
}

// We used to include malloc/free by default in the past. Show a helpful error in
// builds with assertions.

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */
var isFileURI = (filename) => filename.startsWith('file://');

// include: runtime_common.js
// include: runtime_exceptions.js
// Base Emscripten EH error class
class EmscriptenEH {}

class EmscriptenSjLj extends EmscriptenEH {}

// end include: runtime_exceptions.js
// include: runtime_debug.js
var runtimeDebug = true; // Switch to false at runtime to disable logging at the right times

// Used by XXXXX_DEBUG settings to output debug messages.
function dbg(...args) {
  if (!runtimeDebug && typeof runtimeDebug != 'undefined') return;
  // TODO(sbc): Make this configurable somehow.  Its not always convenient for
  // logging to show up as warnings.
  console.warn(...args);
}

// Endianness check
(() => {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) abort('Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)');
})();

function consumedModuleProp(prop) {
  var value = Module[prop];
  var msg = `Attempt to modify \`Module.${prop}\` after it has already been processed.  This can happen, for example, when code is injected via '--post-js' rather than '--pre-js'`;
  if (Array.isArray(value)) {
    value = new Proxy(value, {
      set(target, key, val) {
        abort(msg);
        return false;
      },
      defineProperty(target, key, descriptor) {
        abort(msg);
        return false;
      },
      deleteProperty(target, key) {
        abort(msg);
        return false;
      }
    });
  }
  Object.defineProperty(Module, prop, {
    configurable: true,
    get() { return value; },
    set() {
      abort(msg);
    }
  });
}

function makeInvalidEarlyAccess(name) {
  return () => assert(false, `call to '${name}' via reference taken before Wasm module initialization`);

}

function ignoredModuleProp(prop) {
  if (Object.getOwnPropertyDescriptor(Module, prop)) {
    abort(`\`Module.${prop}\` was supplied but \`${prop}\` not included in INCOMING_MODULE_JS_API`);
  }
}

// forcing the filesystem exports a few things by default
function isExportedByForceFilesystem(name) {
  return name === 'FS_createPath' ||
         name === 'FS_createDataFile' ||
         name === 'FS_createPreloadedFile' ||
         name === 'FS_preloadFile' ||
         name === 'FS_unlink' ||
         name === 'addRunDependency' ||
         // The old FS has some functionality that WasmFS lacks.
         name === 'FS_createLazyFile' ||
         name === 'FS_createDevice' ||
         name === 'removeRunDependency';
}

function missingLibrarySymbol(sym) {

  // Any symbol that is not included from the JS library is also (by definition)
  // not exported on the Module object.
  unexportedRuntimeSymbol(sym);
}

function unexportedRuntimeSymbol(sym) {
  if (!Object.getOwnPropertyDescriptor(Module, sym)) {
    Object.defineProperty(Module, sym, {
      configurable: true,
      get() {
        var msg = `'${sym}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
        if (isExportedByForceFilesystem(sym)) {
          msg += '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
        }
        abort(msg);
      },
    });
  }
}

// end include: runtime_debug.js
// include: runtime_stack_check.js
const stackCookie1 = 0x02135467;
const stackCookie2 = 0x89BACDFE;

// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  var max = _emscripten_stack_get_end();
  assert((max & 3) == 0);
  // If the stack ends at address zero we write our cookies 4 bytes into the
  // stack.  This prevents interference with SAFE_HEAP and ASAN which also
  // monitor writes to address zero.
  if (max == 0) {
    max += 4;
  }
  // The stack grow downwards towards _emscripten_stack_get_end.
  // We write cookies to the final two words in the stack and detect if they are
  // ever overwritten.
  HEAPU32[((max)>>2)] = stackCookie1;
  HEAPU32[(((max)+(4))>>2)] = stackCookie2;
  // Also test the global address 0 for integrity.
  HEAPU32[((0)>>2)] = 1668509029;
}

function u32ToHexString(num) {
  return '0x' + (num >>> 0).toString(16).padStart(8, '0');
}

function checkStackCookie() {
  if (ABORT) return;
  var max = _emscripten_stack_get_end();
  // See writeStackCookie().
  if (max == 0) {
    max += 4;
  }
  var val1 = HEAPU32[((max)>>2)];
  var val2 = HEAPU32[(((max)+(4))>>2)];
  if (val1 != stackCookie1 || val2 != stackCookie2) {
    abort(`Stack overflow! Stack cookie has been overwritten at ${ptrToString(max)}, expected hex dwords ${u32ToHexString(stackCookie2)} and ${u32ToHexString(stackCookie1)}, but received ${u32ToHexString(val2)} ${u32ToHexString(val1)}`);
  }
  // Also test the global address 0 for integrity.
  if (HEAPU32[((0)>>2)] != 0x63736d65 /* 'emsc' */) {
    abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
  }
}
// end include: runtime_stack_check.js
// Memory management

var runtimeInitialized = false;



// When ALLOW_MEMORY_GROWTH is enabled, the conversion from Wasm
// memory to ArrayBuffer requires some additional logic.
function getMemoryBuffer() {
  return wasmMemory.buffer;
}

function updateMemoryViews() {
  // If we already have a heap that is resizeable/growable buffer we don't
  // need to do anything in updateMemoryViews.
  if (HEAP8?.buffer?.resizable) return;
  var b = getMemoryBuffer();
  HEAP8 = new Int8Array(b);

  Module['HEAPU8'] = HEAPU8 = new Uint8Array(b);

  HEAP32 = new Int32Array(b);
  HEAPU32 = new Uint32Array(b);


  HEAP64 = new BigInt64Array(b);

}

// include: memoryprofiler.js
// end include: memoryprofiler.js
// end include: runtime_common.js
assert(globalThis.Int32Array && globalThis.Float64Array && Int32Array.prototype.subarray && Int32Array.prototype.set,
       'JS engine does not provide full typed array support');

function preRun() {
  var preRun = Module['preRun'];
  if (preRun) {
    if (typeof preRun == 'function') preRun = [preRun];
    onPreRuns.push(...preRun);
  }
  consumedModuleProp('preRun');
  // Begin ATPRERUNS hooks
  callRuntimeCallbacks(onPreRuns);
  // End ATPRERUNS hooks
}

function initRuntime() {
  assert(!runtimeInitialized);
  runtimeInitialized = true;

  checkStackCookie();

  // Begin ATINITS hooks
  callRuntimeCallbacks(onInits);
if (!Module['noFSInit'] && !FS.initialized) FS.init();
TTY.init();
  // End ATINITS hooks

  wasmExports['__wasm_call_ctors']();

  // Begin ATPOSTCTORS hooks
  FS.ignorePermissions = false;
  // End ATPOSTCTORS hooks

  checkStackCookie();
}

function postRun() {
  checkStackCookie();

  var postRun = Module['postRun'];
  if (postRun) {
    if (typeof postRun == 'function') postRun = [postRun];
    onPostRuns.push(...postRun);
  }
  consumedModuleProp('postRun');

  // Begin ATPOSTRUNS hooks
  callRuntimeCallbacks(onPostRuns);
  // End ATPOSTRUNS hooks
}

/**
 * @param {string|number=} what
 */
function abort(what) {
  Module['onAbort']?.(what);

  what = `Aborted(${what})`;
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);

  ABORT = true;

  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.

  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */
  var e = new WebAssembly.RuntimeError(what);

  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

function createExportWrapper(name, func, nargs) {
  assert(func);
  return (...args) => {
    assert(runtimeInitialized, `native function \`${name}\` called before runtime initialization`);
    // Only assert for too many arguments. Too few can be valid since the missing arguments will be zero filled.
    assert(args.length <= nargs, `native function \`${name}\` called with ${args.length} args but expects ${nargs}`);
    return func(...args);
  };
}

var wasmBinaryFile;

function findWasmBinary() {
  return locateFile('game.wasm');
}

function getBinarySync(file) {
  if (readBinary) {
    return readBinary(file);
  }
  // Throwing a plain string here, even though it not normally advisable since
  // this gets turning into an `abort` in instantiateArrayBuffer.
  throw 'both async and sync fetching of the wasm failed';
}

async function getWasmBinary(binaryFile) {
  // If we don't have the binary yet, load it asynchronously using readAsync.
  if (!wasmBinary) {
    // Fetch the binary using readAsync
    try {
      var response = await readAsync(binaryFile);
      return new Uint8Array(response);
    } catch {
      // Fall back to getBinarySync below;
    }
  }

  // Otherwise, getBinarySync should be able to get it synchronously
  return getBinarySync(binaryFile);
}

async function instantiateArrayBuffer(binaryFile, imports) {
  try {
    var binary = await getWasmBinary(binaryFile);
    var instance = await WebAssembly.instantiate(binary, imports);
    return instance;
  } catch (reason) {
    err(`failed to asynchronously prepare wasm: ${reason}`);

    // Warn on some common problems.
    if (isFileURI(binaryFile)) {
      err(`warning: Loading from a file URI (${binaryFile}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`);
    }
    abort(reason);
  }
}

async function instantiateAsync(binary, binaryFile, imports) {
  if (!binary
      // Avoid using instantiateStreaming() on Node.js since the `fetch()` API
      // does not support `file://` URLs.
      // See: https://github.com/emscripten-core/emscripten/pull/16917
      && !ENVIRONMENT_IS_NODE
     ) {
    try {
      var response = fetch(binaryFile, { credentials: 'same-origin' });
      var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
      return instantiationResult;
    } catch (reason) {
      // We expect the most common failure cause to be a bad MIME type for the binary,
      // in which case falling back to ArrayBuffer instantiation should work.
      err(`wasm streaming compile failed: ${reason}`);
      err('falling back to ArrayBuffer instantiation');
      // fall back of instantiateArrayBuffer below
    };
  }
  return instantiateArrayBuffer(binaryFile, imports);
}

function getWasmImports() {
  // prepare imports
  var imports = {
    'env': wasmImports,
    'wasi_snapshot_preview1': wasmImports,
  };
  return imports;
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
async function createWasm() {
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  function receiveInstance(instance) {
    wasmExports = instance.exports;

    assignWasmExports(wasmExports);

    updateMemoryViews();

    return wasmExports;
  }

  // Prefer streaming instantiation if available.
  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    return receiveInstance(result['instance']);
  }

  var info = getWasmImports();

  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  var instantiateWasm = Module['instantiateWasm'];
  if (instantiateWasm) {
    return new Promise((resolve) => {
      try {
        instantiateWasm(info, (inst) => resolve(receiveInstance(inst)));
      } catch(e) {
        err(`Module.instantiateWasm callback failed with error: ${e}`);
        throw e;
      }
    });
  }

  wasmBinaryFile ??= findWasmBinary();
  var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
  var exports = receiveInstantiationResult(result);
  return exports;
}

// end include: preamble.js

// Begin JS library code


  class ExitStatus {
      name = 'ExitStatus';
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }

  /** @type {!Int32Array} */
  var HEAP32;

  /** @type {!Int8Array} */
  var HEAP8;

  /** @type {!Uint32Array} */
  var HEAPU32;

  var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        // Pass the module as the first argument.
        callbacks.shift()(Module);
      }
    };
  var onPostRuns = [];
  var addOnPostRun = (cb) => onPostRuns.push(cb);

  var onPreRuns = [];
  var addOnPreRun = (cb) => onPreRuns.push(cb);


  var noExitRuntime = true;

  function ptrToString(ptr) {
      assert(typeof ptr === 'number', `ptrToString expects a number, got ${typeof ptr}`);
      // Convert to 32-bit unsigned value
      ptr >>>= 0;
      return '0x' + ptr.toString(16).padStart(8, '0');
    }

  var stackRestore = (val) => __emscripten_stack_restore(val);

  var stackSave = () => _emscripten_stack_get_current();

  var warnOnce = (text) => {
      warnOnce.shown ||= {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        if (ENVIRONMENT_IS_NODE) text = 'warning: ' + text;
        err(text);
      }
    };



  var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();


    /**
   * heapOrArray is either a regular array, or a JavaScript typed array view.
   * @param {number} idx
   * @param {number=} maxBytesToRead
   * @param {boolean=} ignoreNul
   * @return {number}
   */
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
      var maxIdx = idx + maxBytesToRead;
      if (ignoreNul) return maxIdx;
      // TextDecoder needs to know the byte length in advance, it doesn't stop on
      // null terminator by itself.
      // As a tiny code save trick, compare idx against maxIdx using a negation,
      // so that maxBytesToRead=undefined/NaN means Infinity.
      while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
      return idx;
    };


    /**
   * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
   * array that contains uint8 values, returns a copy of that string as a
   * Javascript String object.
   * heapOrArray is either a regular array, or a JavaScript typed array view.
   * @param {number=} idx
   * @param {number=} maxBytesToRead
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {

      var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);

      // When using conditional TextDecoder, skip it for short strings as the overhead of the native call is not worth it.
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = '';
      while (idx < endPtr) {
        // For UTF8 byte structure, see:
        // http://en.wikipedia.org/wiki/UTF-8#Description
        // https://www.ietf.org/rfc/rfc2279.txt
        // https://tools.ietf.org/html/rfc3629
        var u0 = heapOrArray[idx++];
        if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 0xF0) == 0xE0) {
          u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
        } else {
          if ((u0 & 0xF8) != 0xF0) warnOnce(`Invalid UTF-8 leading byte ${ptrToString(u0)} encountered when deserializing a UTF-8 string in wasm memory to a JS string!`);
          u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
        }

        if (u0 < 0x10000) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 0x10000;
          str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
        }
      }
      return str;
    };

  /** @type {!Uint8Array} */
  var HEAPU8;

    /**
   * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
   * emscripten HEAP, returns a copy of that string as a Javascript String object.
   *
   * @param {number} ptr
   * @param {number=} maxBytesToRead - An optional length that specifies the
   *   maximum number of bytes to read. You can omit this parameter to scan the
   *   string until the first 0 byte. If maxBytesToRead is passed, and the string
   *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
   *   string will cut short at that byte index.
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => {
      assert(typeof ptr == 'number', `UTF8ToString expects a number (got ${typeof ptr})`);
      return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : '';
    };
  var ___assert_fail = (condition, filename, line, func) =>
      abort(`Assertion failed: ${UTF8ToString(condition)}, at: ` + [filename ? UTF8ToString(filename) : 'unknown filename', line, func ? UTF8ToString(func) : 'unknown function']);

  var wasmTableMirror = [];


  var getWasmTableEntry = (funcPtr) => {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        /** @suppress {checkTypes} */
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      /** @suppress {checkTypes} */
      assert(wasmTable.get(funcPtr) == func, 'table mirror is out of date');
      return func;
    };
  var ___call_sighandler = (fp, sig) => getWasmTableEntry(fp)(sig);

  var PATH = {
  isAbs:(path) => path.charAt(0) === '/',
  splitPath:(filename) => {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },
  normalizeArray:(parts, allowAboveRoot) => {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },
  normalize:(path) => {
        var isAbsolute = PATH.isAbs(path),
            trailingSlash = path.slice(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter((p) => !!p), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },
  dirname:(path) => {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.slice(0, -1);
        }
        return root + dir;
      },
  basename:(path) => path && path.match(/([^\/]+|\/)\/*$/)[1],
join:(...paths) => PATH.normalize(paths.join('/')),
join2:(l, r) => PATH.normalize(l + '/' + r),
};

var initRandomFill = () => {
    // This block is not needed on v19+ since crypto.getRandomValues is builtin
    if (ENVIRONMENT_IS_NODE) {
      var nodeCrypto = require('node:crypto');
      return (view) => (nodeCrypto.randomFillSync(view), 0);
    }

    return (view) => (crypto.getRandomValues(view), 0);
  };
var randomFill = (view) => (randomFill = initRandomFill())(view);



var PATH_FS = {
resolve:(...args) => {
      var resolvedPath = '',
        resolvedAbsolute = false;
      for (var i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path = (i >= 0) ? args[i] : FS.cwd();
        // Skip empty and invalid entries
        if (typeof path != 'string') {
          throw new TypeError('Arguments to path.resolve must be strings');
        } else if (!path) {
          return ''; // an invalid portion invalidates the whole thing
        }
        resolvedPath = path + '/' + resolvedPath;
        resolvedAbsolute = PATH.isAbs(path);
      }
      // At this point the path should be resolved to a full absolute path, but
      // handle relative paths to be safe (might happen when process.cwd() fails)
      resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter((p) => !!p), !resolvedAbsolute).join('/');
      return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
    },
relative:(from, to) => {
      from = PATH_FS.resolve(from).slice(1);
      to = PATH_FS.resolve(to).slice(1);
      function trim(arr) {
        var start = 0;
        for (; start < arr.length; start++) {
          if (arr[start] !== '') break;
        }
        var end = arr.length - 1;
        for (; end >= 0; end--) {
          if (arr[end] !== '') break;
        }
        if (start > end) return [];
        return arr.slice(start, end - start + 1);
      }
      var fromParts = trim(from.split('/'));
      var toParts = trim(to.split('/'));
      var length = Math.min(fromParts.length, toParts.length);
      var samePartsLength = length;
      for (var i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i;
          break;
        }
      }
      var outputParts = [];
      for (var i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..');
      }
      outputParts = outputParts.concat(toParts.slice(samePartsLength));
      return outputParts.join('/');
    },
};



var FS_stdin_getChar_buffer = [];

var lengthBytesUTF8 = (str) => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
      // unit, not a Unicode code point of the character! So decode
      // UTF16->UTF32->UTF8.
      // See http://unicode.org/faq/utf_bom.html#utf16-3
      var c = str.charCodeAt(i); // possibly a lead surrogate
      if (c <= 0x7F) {
        len++;
      } else if (c <= 0x7FF) {
        len += 2;
      } else if (c >= 0xD800 && c <= 0xDFFF) {
        len += 4; ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };

var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    assert(typeof str === 'string', `stringToUTF8Array expects a string (got ${typeof str})`);
    // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
    // undefined and false each don't write out any bytes.
    if (!(maxBytesToWrite > 0))
      return 0;

    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
    for (var i = 0; i < str.length; ++i) {
      // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
      // and https://www.ietf.org/rfc/rfc2279.txt
      // and https://tools.ietf.org/html/rfc3629
      var u = str.codePointAt(i);
      if (u <= 0x7F) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 0x7FF) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 0xC0 | (u >> 6);
        heap[outIdx++] = 0x80 | (u & 63);
      } else if (u <= 0xFFFF) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 0xE0 | (u >> 12);
        heap[outIdx++] = 0x80 | ((u >> 6) & 63);
        heap[outIdx++] = 0x80 | (u & 63);
      } else {
        if (outIdx + 3 >= endIdx) break;
        if (u > 0x10FFFF) warnOnce(`Invalid Unicode code point ${ptrToString(u)} encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).`);
        heap[outIdx++] = 0xF0 | (u >> 18);
        heap[outIdx++] = 0x80 | ((u >> 12) & 63);
        heap[outIdx++] = 0x80 | ((u >> 6) & 63);
        heap[outIdx++] = 0x80 | (u & 63);
        // Gotcha: if codePoint is over 0xFFFF, it is represented as a surrogate pair in UTF-16.
        // We need to manually skip over the second code unit for correct iteration.
        i++;
      }
    }
    // Null-terminate the pointer to the buffer.
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
/** @type {function(string, boolean=, number=)} */
  var intArrayFromString = (stringy, dontAddNull, length) => {
      var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
      var u8array = new Array(len);
      var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
      if (dontAddNull) u8array.length = numBytesWritten;
      return u8array;
    };
  var FS_stdin_getChar = () => {
      if (!FS_stdin_getChar_buffer.length) {
        var result = null;
        if (ENVIRONMENT_IS_NODE) {
          // we will read data by chunks of BUFSIZE
          var BUFSIZE = 256;
          var buf = Buffer.alloc(BUFSIZE);
          var bytesRead = 0;

          // For some reason we must suppress a closure warning here, even though
          // fd definitely exists on process.stdin, and is even the proper way to
          // get the fd of stdin,
          // https://github.com/nodejs/help/issues/2136#issuecomment-523649904
          // This started to happen after moving this logic out of library_tty.js,
          // so it is related to the surrounding code in some unclear manner.
          /** @suppress {missingProperties} */
          var fd = process.stdin.fd;

          try {
            bytesRead = fs.readSync(fd, buf, 0, BUFSIZE);
          } catch(e) {
            // Cross-platform differences: on Windows, reading EOF throws an
            // exception, but on other OSes, reading EOF returns 0. Uniformize
            // behavior by treating the EOF exception to return 0.
            if (e.toString().includes('EOF')) bytesRead = 0;
            else throw e;
          }

          if (bytesRead > 0) {
            result = buf.slice(0, bytesRead).toString('utf-8');
          }
        } else
        if (globalThis.window?.prompt) {
          // Browser.
          result = window.prompt('Input: ');  // returns null on cancel
          if (result !== null) {
            result += '\n';
          }
        } else
        {}
        if (!result) {
          return null;
        }
        FS_stdin_getChar_buffer = intArrayFromString(result, true);
      }
      return FS_stdin_getChar_buffer.shift();
    };
  var TTY = {
  ttys:[],
  init() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process.stdin.setEncoding('utf8');
        // }
      },
  shutdown() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process.stdin.pause();
        // }
      },
  register(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },
  stream_ops:{
  open(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(43);
          }
          stream.tty = tty;
          stream.seekable = false;
        },
  close(stream) {
          // flush any pending line data
          stream.tty.ops.fsync(stream.tty);
        },
  fsync(stream) {
          stream.tty.ops.fsync(stream.tty);
        },
  read(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(60);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(29);
            }
            if (result === undefined && !bytesRead) {
              throw new FS.ErrnoError(6);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.atime = Date.now();
          }
          return bytesRead;
        },
  write(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(60);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
          if (length) {
            stream.node.mtime = stream.node.ctime = Date.now();
          }
          return i;
        },
  },
  default_tty_ops:{
  get_char(tty) {
          return FS_stdin_getChar();
        },
  put_char(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },
  fsync(tty) {
          if (tty.output?.length > 0) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  ioctl_tcgets(tty) {
          // typical setting
          return {
            c_iflag: 25856,
            c_oflag: 5,
            c_cflag: 191,
            c_lflag: 35387,
            c_cc: [
              0x03, 0x1c, 0x7f, 0x15, 0x04, 0x00, 0x01, 0x00, 0x11, 0x13, 0x1a, 0x00,
              0x12, 0x0f, 0x17, 0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ]
          };
        },
  ioctl_tcsets(tty, optional_actions, data) {
          // currently just ignore
          return 0;
        },
  ioctl_tiocgwinsz(tty) {
          return [24, 80];
        },
  },
  default_tty1_ops:{
  put_char(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },
  fsync(tty) {
          if (tty.output?.length > 0) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  },
  };


  var mmapAlloc = (size) => {
      abort('internal error: mmapAlloc called but `emscripten_builtin_memalign` native symbol not exported');
    };

  var MEMFS = {
  ops_table:null,
  mount(mount) {
        return MEMFS.createNode(null, '/', 16895, 0);
      },
  createNode(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // not supported
          throw new FS.ErrnoError(63);
        }
        MEMFS.ops_table ||= {
          dir: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              lookup: MEMFS.node_ops.lookup,
              mknod: MEMFS.node_ops.mknod,
              rename: MEMFS.node_ops.rename,
              unlink: MEMFS.node_ops.unlink,
              rmdir: MEMFS.node_ops.rmdir,
              readdir: MEMFS.node_ops.readdir,
              symlink: MEMFS.node_ops.symlink
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek
            }
          },
          file: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek,
              read: MEMFS.stream_ops.read,
              write: MEMFS.stream_ops.write,
              mmap: MEMFS.stream_ops.mmap,
              msync: MEMFS.stream_ops.msync
            }
          },
          link: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              readlink: MEMFS.node_ops.readlink
            },
            stream: {}
          },
          chrdev: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: FS.chrdev_stream_ops
          }
        };
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          // The actual number of bytes used in the typed array, as opposed to
          // contents.length which gives the whole capacity.
          node.usedBytes = 0;
          // The byte data of the file is stored in a typed array.
          // Note: typed arrays are not resizable like normal JS arrays are, so
          // there is a small penalty involved for appending file writes that
          // continuously grow a file similar to std::vector capacity vs used.
          node.contents = MEMFS.emptyFileContents ??= new Uint8Array(0);
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.atime = node.mtime = node.ctime = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
          parent.atime = parent.mtime = parent.ctime = node.atime;
        }
        return node;
      },
  getFileDataAsTypedArray(node) {
        assert(FS.isFile(node.mode), 'getFileDataAsTypedArray called on non-file');
        return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
      },
  expandFileStorage(node, newCapacity) {
        var prevCapacity = node.contents.length;
        if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
        // Don't expand strictly to the given requested limit if it's only a very
        // small increase, but instead geometrically grow capacity.
        // For small filesizes (<1MB), perform size*2 geometric increase, but for
        // large sizes, do a much more conservative size*1.125 increase to avoid
        // overshooting the allocation cap by a very large margin.
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) >>> 0);
        if (prevCapacity) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
        var oldContents = MEMFS.getFileDataAsTypedArray(node);
        node.contents = new Uint8Array(newCapacity); // Allocate new storage.
        node.contents.set(oldContents);
      },
  resizeFileStorage(node, newSize) {
        if (node.usedBytes == newSize) return;
        var oldContents = node.contents;
        node.contents = new Uint8Array(newSize); // Allocate new storage.
        node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
        node.usedBytes = newSize;
      },
  node_ops:{
  getattr(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.atime);
          attr.mtime = new Date(node.mtime);
          attr.ctime = new Date(node.ctime);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },
  setattr(node, attr) {
          for (const key of ['mode', 'atime', 'mtime', 'ctime']) {
            if (attr[key] != null) {
              node[key] = attr[key];
            }
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },
  lookup(parent, name) {
          throw new FS.ErrnoError(44);
        },
  mknod(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },
  rename(old_node, new_dir, new_name) {
          var new_node;
          try {
            new_node = FS.lookupNode(new_dir, new_name);
          } catch (e) {}
          if (new_node) {
            if (FS.isDir(old_node.mode)) {
              // if we're overwriting a directory at new_name, make sure it's empty.
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(55);
              }
            }
            FS.hashRemoveNode(new_node);
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          new_dir.contents[new_name] = old_node;
          old_node.name = new_name;
          new_dir.ctime = new_dir.mtime = old_node.parent.ctime = old_node.parent.mtime = Date.now();
        },
  unlink(parent, name) {
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  rmdir(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(55);
          }
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  readdir(node) {
          return ['.', '..', ...Object.keys(node.contents)];
        },
  symlink(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 0o777 | 40960, 0);
          node.link = oldpath;
          return node;
        },
  readlink(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(28);
          }
          return node.link;
        },
  },
  stream_ops:{
  read(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          buffer.set(contents.subarray(position, position + size), offset);
          return size;
        },
  write(stream, buffer, offset, length, position, canOwn) {
          assert(buffer.subarray, 'FS.write expects a TypedArray');
          // If the buffer is located in main memory (HEAP), and if
          // memory can grow, we can't hold on to references of the
          // memory buffer, as they may get invalidated. That means we
          // need to copy its contents.
          if (buffer.buffer === HEAP8.buffer) {
            canOwn = false;
          }

          if (!length) return 0;
          var node = stream.node;
          node.mtime = node.ctime = Date.now();

          if (canOwn) {
            assert(!position, 'canOwn must imply no weird position inside the file');
            node.contents = buffer.subarray(offset, offset + length);
            node.usedBytes = length;
          } else if (!node.usedBytes && !position) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
            node.contents = buffer.slice(offset, offset + length);
            node.usedBytes = length;
          } else {
            MEMFS.expandFileStorage(node, position+length);
            // Use typed array write which is available.
            node.contents.set(buffer.subarray(offset, offset + length), position);
            node.usedBytes = Math.max(node.usedBytes, position + length);
          }
          return length;
        },
  llseek(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {
            position += stream.position;
          } else if (whence === 2) {
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(28);
          }
          return position;
        },
  mmap(stream, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(43);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if (!(flags & 2) && contents.buffer === HEAP8.buffer) {
            // We can't emulate MAP_SHARED when the file is not backed by the
            // buffer we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            allocated = true;
            ptr = mmapAlloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(48);
            }
            if (contents) {
              // Try to avoid unnecessary slices.
              if (position > 0 || position + length < contents.length) {
                if (contents.subarray) {
                  contents = contents.subarray(position, position + length);
                } else {
                  contents = Array.prototype.slice.call(contents, position, position + length);
                }
              }
              HEAP8.set(contents, ptr);
            }
          }
          return { ptr, allocated };
        },
  msync(stream, buffer, offset, length, mmapFlags) {
          MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        },
  },
  };

  var FS_modeStringToFlags = (str) => {
      if (typeof str != 'string') return str;
      var flagModes = {
        'r': 0,
        'r+': 2,
        'w': 512 | 64 | 1,
        'w+': 512 | 64 | 2,
        'a': 1024 | 64 | 1,
        'a+': 1024 | 64 | 2,
      };
      var flags = flagModes[str];
      if (typeof flags == 'undefined') {
        throw new Error(`Unknown file open mode: ${str}`);
      }
      return flags;
    };

  var FS_fileDataToTypedArray = (data) => {
      if (typeof data == 'string') {
        data = intArrayFromString(data, true);
      }
      if (!data.subarray) {
        data = new Uint8Array(data);
      }
      return data;
    };

  var FS_getMode = (canRead, canWrite) => {
      var mode = 0;
      if (canRead) mode |= 292 | 73;
      if (canWrite) mode |= 146;
      return mode;
    };




  var strError = (errno) => UTF8ToString(_strerror(errno));

  var ERRNO_CODES = {
      'EPERM': 63,
      'ENOENT': 44,
      'ESRCH': 71,
      'EINTR': 27,
      'EIO': 29,
      'ENXIO': 60,
      'E2BIG': 1,
      'ENOEXEC': 45,
      'EBADF': 8,
      'ECHILD': 12,
      'EAGAIN': 6,
      'EWOULDBLOCK': 6,
      'ENOMEM': 48,
      'EACCES': 2,
      'EFAULT': 21,
      'ENOTBLK': 105,
      'EBUSY': 10,
      'EEXIST': 20,
      'EXDEV': 75,
      'ENODEV': 43,
      'ENOTDIR': 54,
      'EISDIR': 31,
      'EINVAL': 28,
      'ENFILE': 41,
      'EMFILE': 33,
      'ENOTTY': 59,
      'ETXTBSY': 74,
      'EFBIG': 22,
      'ENOSPC': 51,
      'ESPIPE': 70,
      'EROFS': 69,
      'EMLINK': 34,
      'EPIPE': 64,
      'EDOM': 18,
      'ERANGE': 68,
      'ENOMSG': 49,
      'EIDRM': 24,
      'ECHRNG': 106,
      'EL2NSYNC': 156,
      'EL3HLT': 107,
      'EL3RST': 108,
      'ELNRNG': 109,
      'EUNATCH': 110,
      'ENOCSI': 111,
      'EL2HLT': 112,
      'EDEADLK': 16,
      'ENOLCK': 46,
      'EBADE': 113,
      'EBADR': 114,
      'EXFULL': 115,
      'ENOANO': 104,
      'EBADRQC': 103,
      'EBADSLT': 102,
      'EDEADLOCK': 16,
      'EBFONT': 101,
      'ENOSTR': 100,
      'ENODATA': 116,
      'ETIME': 117,
      'ENOSR': 118,
      'ENONET': 119,
      'ENOPKG': 120,
      'EREMOTE': 121,
      'ENOLINK': 47,
      'EADV': 122,
      'ESRMNT': 123,
      'ECOMM': 124,
      'EPROTO': 65,
      'EMULTIHOP': 36,
      'EDOTDOT': 125,
      'EBADMSG': 9,
      'ENOTUNIQ': 126,
      'EBADFD': 127,
      'EREMCHG': 128,
      'ELIBACC': 129,
      'ELIBBAD': 130,
      'ELIBSCN': 131,
      'ELIBMAX': 132,
      'ELIBEXEC': 133,
      'ENOSYS': 52,
      'ENOTEMPTY': 55,
      'ENAMETOOLONG': 37,
      'ELOOP': 32,
      'EOPNOTSUPP': 138,
      'EPFNOSUPPORT': 139,
      'ECONNRESET': 15,
      'ENOBUFS': 42,
      'EAFNOSUPPORT': 5,
      'EPROTOTYPE': 67,
      'ENOTSOCK': 57,
      'ENOPROTOOPT': 50,
      'ESHUTDOWN': 140,
      'ECONNREFUSED': 14,
      'EADDRINUSE': 3,
      'ECONNABORTED': 13,
      'ENETUNREACH': 40,
      'ENETDOWN': 38,
      'ETIMEDOUT': 73,
      'EHOSTDOWN': 142,
      'EHOSTUNREACH': 23,
      'EINPROGRESS': 26,
      'EALREADY': 7,
      'EDESTADDRREQ': 17,
      'EMSGSIZE': 35,
      'EPROTONOSUPPORT': 66,
      'ESOCKTNOSUPPORT': 137,
      'EADDRNOTAVAIL': 4,
      'ENETRESET': 39,
      'EISCONN': 30,
      'ENOTCONN': 53,
      'ETOOMANYREFS': 141,
      'EUSERS': 136,
      'EDQUOT': 19,
      'ESTALE': 72,
      'ENOTSUP': 138,
      'ENOMEDIUM': 148,
      'EILSEQ': 25,
      'EOVERFLOW': 61,
      'ECANCELED': 11,
      'ENOTRECOVERABLE': 56,
      'EOWNERDEAD': 62,
      'ESTRPIPE': 135,
    };

  var asyncLoad = async (url) => {
      var arrayBuffer = await readAsync(url);
      assert(arrayBuffer, `Loading data file "${url}" failed (no arrayBuffer).`);
      return new Uint8Array(arrayBuffer);
    };


  var FS_createDataFile = (...args) => FS.createDataFile(...args);

  var getUniqueRunDependency = (id) => {
      var orig = id;
      while (1) {
        if (!runDependencyTracking[id]) return id;
        id = orig + Math.random();
      }
    };

  var dependenciesPromise = null;
  var resolveRunDependencies = async () => dependenciesPromise;
  var runDependencies = 0;


  var dependenciesPromiseResolve = null;

  var runDependencyTracking = {
  };

  var runDependencyWatcher = null;
  var removeRunDependency = (id) => {
      runDependencies--;

      Module['monitorRunDependencies']?.(runDependencies);

      assert(id, 'removeRunDependency requires an ID');
      assert(runDependencyTracking[id]);
      delete runDependencyTracking[id];
      if (!runDependencies) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        dependenciesPromiseResolve();
      }
    };




  var addRunDependency = (id) => {
      if (!runDependencies) {
        dependenciesPromise = new Promise((resolve) => dependenciesPromiseResolve = resolve);
      }
      runDependencies++;

      Module['monitorRunDependencies']?.(runDependencies);

      assert(id, 'addRunDependency requires an ID')
      assert(!runDependencyTracking[id]);
      runDependencyTracking[id] = 1;
      if (!runDependencyWatcher && globalThis.setInterval) {
        // Check for missing dependencies every few seconds
        runDependencyWatcher = setInterval(() => {
          if (ABORT) {
            clearInterval(runDependencyWatcher);
            runDependencyWatcher = null;
            return;
          }
          var shown = false;
          for (var dep in runDependencyTracking) {
            if (!shown) {
              shown = true;
              err('still waiting on run dependencies:');
            }
            err(`dependency: ${dep}`);
          }
          if (shown) {
            err('(end of list)');
          }
        }, 10000);
        // Prevent this timer from keeping the runtime alive if nothing
        // else is.
        runDependencyWatcher.unref?.()
      }
    };


  var preloadPlugins = [];
  var FS_handledByPreloadPlugin = async (byteArray, fullname) => {
      // Ensure plugins are ready.
      if (typeof Browser != 'undefined') Browser.init();

      for (var plugin of preloadPlugins) {
        if (plugin['canHandle'](fullname)) {
          assert(plugin['handle'].constructor.name === 'AsyncFunction', 'Filesystem plugin handlers must be async functions (See #24914)')
          return plugin['handle'](byteArray, fullname);
        }
      }
      // If no plugin handled this file then return the original/unmodified
      // byteArray.
      return byteArray;
    };
  var FS_preloadFile = async (parent, name, url, canRead, canWrite, dontCreateFile, canOwn, preFinish) => {
      // TODO we should allow people to just pass in a complete filename instead
      // of parent and name being that we just join them anyways
      var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
      var dep = getUniqueRunDependency(`cp ${fullname}`); // might have several active requests for the same fullname
      addRunDependency(dep);

      try {
        var byteArray = url;
        if (typeof url == 'string') {
          byteArray = await asyncLoad(url);
        }

        byteArray = await FS_handledByPreloadPlugin(byteArray, fullname);
        preFinish?.();
        if (!dontCreateFile) {
          FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
        }
      } finally {
        removeRunDependency(dep);
      }
    };
  var FS_createPreloadedFile = (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) => {
      FS_preloadFile(parent, name, url, canRead, canWrite, dontCreateFile, canOwn, preFinish).then(onload).catch(onerror);
    };

  var FS = {
  root:null,
  mounts:[],
  devices:{
  },
  streams:[],
  nextInode:1,
  nameTable:null,
  currentPath:"/",
  initialized:false,
  ignorePermissions:true,
  filesystems:null,
  syncFSRequests:0,
  ErrnoError:class extends Error {
        name = 'ErrnoError';
        // We set the `name` property to be able to identify `FS.ErrnoError`
        // - the `name` is a standard ECMA-262 property of error objects. Kind of good to have it anyway.
        // - when using PROXYFS, an error can come from an underlying FS
        // as different FS objects have their own FS.ErrnoError each,
        // the test `err instanceof FS.ErrnoError` won't detect an error coming from another filesystem, causing bugs.
        // we'll use the reliable test `err.name == "ErrnoError"` instead
        constructor(errno) {
          super(runtimeInitialized ? strError(errno) : '');
          this.errno = errno;
          for (var key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === errno) {
              this.code = key;
              break;
            }
          }
        }
      },
  FSStream:class {
        shared = {};
        get object() {
          return this.node;
        }
        set object(val) {
          this.node = val;
        }
        get isRead() {
          return (this.flags & 2097155) !== 1;
        }
        get isWrite() {
          return (this.flags & 2097155) !== 0;
        }
        get isAppend() {
          return (this.flags & 1024);
        }
        get flags() {
          return this.shared.flags;
        }
        set flags(val) {
          this.shared.flags = val;
        }
        get position() {
          return this.shared.position;
        }
        set position(val) {
          this.shared.position = val;
        }
      },
  FSNode:class {
        node_ops = {};
        stream_ops = {};
        readMode = 292 | 73;
        writeMode = 146;
        mounted = null;
        constructor(parent, name, mode, rdev) {
          if (!parent) {
            parent = this;  // root node sets parent to itself
          }
          this.parent = parent;
          this.mount = parent.mount;
          this.id = FS.nextInode++;
          this.name = name;
          this.mode = mode;
          this.rdev = rdev;
          this.atime = this.mtime = this.ctime = Date.now();
        }
        get read() {
          return (this.mode & this.readMode) === this.readMode;
        }
        set read(val) {
          val ? this.mode |= this.readMode : this.mode &= ~this.readMode;
        }
        get write() {
          return (this.mode & this.writeMode) === this.writeMode;
        }
        set write(val) {
          val ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
        }
        get isFolder() {
          return FS.isDir(this.mode);
        }
        get isDevice() {
          return FS.isChrdev(this.mode);
        }
        // The per-inode readiness wait-queue. The node carries a Set of listener
        // entries {cb}; producers (SOCKFS, PIPEFS) call notifyListeners on a
        // readiness transition, and poll()/epoll consume it. It lives on the node
        // (not the fd) so dup'd fds share one queue. Only nodes that derive real
        // readiness (sockets, pipes, and an epoll's own node) ever use this -
        // always-ready types (regular files, ttys) never register or notify.
        addListener(cb, exclusive = false) {
          var entry = {cb, exclusive};
          var listeners = (this.listeners ??= new Set());
          listeners.add(entry);
          return {listeners, entry};
        }
        notifyListeners(flags) {
          // Iterates the set without copying, which is safe ONLY under a
          // load-bearing contract that every internal listener must honour:
          //   1. A listener must not run user code synchronously (a poll waiter only
          //      resolves a Promise; an epoll registration only re-lists +
          //      re-notifies; the epoll callback only schedules a tick). User code
          //      runs on a later tick, never inside this loop.
          //   2. A listener may delete entries only from ITS OWN waiter, never from
          //      a sibling node's set that may be mid-iteration. (Deleting an entry
          //      of the set being iterated here is fine - a Set tolerates removal of
          //      a not-yet-visited entry mid-iteration; mutating a *different* node's
          //      set is fine because that set is not being iterated.)
          // Violating either gives silently skipped wakeups that are near-impossible
          // to reproduce. Any new producer/listener must preserve it.
          if (!this.listeners) return;
          // Fire every non-exclusive listener. Among EPOLLEXCLUSIVE registrations
          // (one fd watched by several epolls) wake only one, rotating round-robin
          // per node, to avoid a thundering herd. (Only epoll registrations are ever
          // exclusive; poll waiters and a node's own consumers are not.)
          var excl;
          for (var entry of this.listeners) {
            if (entry.exclusive) (excl ||= []).push(entry);
            else entry.cb(flags);
          }
          if (excl) {
            var i = (this.exclTurn || 0) % excl.length;
            this.exclTurn = i + 1;
            excl[i].cb(flags);
          }
        }
      },
  lookupPath(path, opts = {}) {
        if (!path) {
          throw new FS.ErrnoError(44);
        }
        opts.follow_mount ??= true

        if (!PATH.isAbs(path)) {
          path = FS.cwd() + '/' + path;
        }

        // limit max consecutive symlinks to SYMLOOP_MAX.
        linkloop: for (var nlinks = 0; nlinks < 40; nlinks++) {
          // split the absolute path
          var parts = path.split('/').filter((p) => !!p);

          // start at the root
          var current = FS.root;
          var current_path = '/';

          for (var i = 0; i < parts.length; i++) {
            var islast = (i === parts.length-1);
            if (islast && opts.parent) {
              // stop resolving
              break;
            }

            if (parts[i] === '.') {
              continue;
            }

            if (parts[i] === '..') {
              current_path = PATH.dirname(current_path);
              if (FS.isRoot(current)) {
                path = current_path + '/' + parts.slice(i + 1).join('/');
                // We're making progress here, don't let many consecutive ..'s
                // lead to ELOOP
                nlinks--;
                continue linkloop;
              } else {
                current = current.parent;
              }
              continue;
            }

            current_path = PATH.join2(current_path, parts[i]);
            try {
              current = FS.lookupNode(current, parts[i]);
            } catch (e) {
              // if noent_okay is true, suppress a ENOENT in the last component
              // and return an object with an undefined node. This is needed for
              // resolving symlinks in the path when creating a file.
              if ((e?.errno === 44) && islast && opts.noent_okay) {
                return { path: current_path };
              }
              throw e;
            }

            // jump to the mount's root node if this is a mountpoint
            if (FS.isMountpoint(current) && (!islast || opts.follow_mount)) {
              current = current.mounted.root;
            }

            // by default, lookupPath will not follow a symlink if it is the final path component.
            // setting opts.follow = true will override this behavior.
            if (FS.isLink(current.mode) && (!islast || opts.follow)) {
              if (!current.node_ops.readlink) {
                throw new FS.ErrnoError(52);
              }
              var link = current.node_ops.readlink(current);
              if (!PATH.isAbs(link)) {
                link = PATH.dirname(current_path) + '/' + link;
              }
              path = link + '/' + parts.slice(i + 1).join('/');
              continue linkloop;
            }
          }
          return { path: current_path, node: current };
        }
        throw new FS.ErrnoError(32);
      },
  getPath(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? `${mount}/${path}` : mount + path;
          }
          path = path ? `${node.name}/${path}` : node.name;
          node = node.parent;
        }
      },
  hashName(parentid, name) {
        var hash = 0;

        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },
  hashAddNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },
  hashRemoveNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },
  lookupNode(parent, name) {
        var errCode = FS.mayLookup(parent);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },
  createNode(parent, name, mode, rdev) {
        assert(typeof parent == 'object')
        var node = new FS.FSNode(parent, name, mode, rdev);

        FS.hashAddNode(node);

        return node;
      },
  destroyNode(node) {
        FS.hashRemoveNode(node);
      },
  isRoot(node) {
        return node === node.parent;
      },
  isMountpoint(node) {
        return !!node.mounted;
      },
  isFile(mode) {
        return (mode & 61440) === 32768;
      },
  isDir(mode) {
        return (mode & 61440) === 16384;
      },
  isLink(mode) {
        return (mode & 61440) === 40960;
      },
  isChrdev(mode) {
        return (mode & 61440) === 8192;
      },
  isBlkdev(mode) {
        return (mode & 61440) === 24576;
      },
  isFIFO(mode) {
        return (mode & 61440) === 4096;
      },
  isSocket(mode) {
        return (mode & 49152) === 49152;
      },
  flagsToPermissionString(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },
  nodePermissions(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.includes('r') && !(node.mode & 292)) {
          return 2;
        }
        if (perms.includes('w') && !(node.mode & 146)) {
          return 2;
        }
        if (perms.includes('x') && !(node.mode & 73)) {
          return 2;
        }
        return 0;
      },
  mayLookup(dir) {
        if (!FS.isDir(dir.mode)) return 54;
        var errCode = FS.nodePermissions(dir, 'x');
        if (errCode) return errCode;
        if (!dir.node_ops.lookup) return 2;
        return 0;
      },
  mayCreate(dir, name) {
        if (!FS.isDir(dir.mode)) {
          return 54;
        }
        try {
          var node = FS.lookupNode(dir, name);
          return 20;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },
  mayDelete(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var errCode = FS.nodePermissions(dir, 'wx');
        if (errCode) {
          return errCode;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 54;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 10;
          }
        } else if (FS.isDir(node.mode)) {
          return 31;
        }
        return 0;
      },
  mayOpen(node, flags) {
        if (!node) {
          return 44;
        }
        if (FS.isLink(node.mode)) {
          return 32;
        }
        var mode = FS.flagsToPermissionString(flags);
        if (FS.isDir(node.mode)) {
          // opening for write
          // TODO: check for O_SEARCH? (== search for dir only)
          if (mode !== 'r' || (flags & (512 | 64))) {
            return 31;
          }
        }
        return FS.nodePermissions(node, mode);
      },
  checkOpExists(op, err) {
        if (!op) {
          throw new FS.ErrnoError(err);
        }
        return op;
      },
  MAX_OPEN_FDS:4096,
  nextfd() {
        for (var fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(33);
      },
  getStreamChecked(fd) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        return stream;
      },
  getStream:(fd) => FS.streams[fd],
  createStream(stream, fd = -1) {
        assert(fd >= -1);

        // clone it, so we can return an instance of FSStream
        stream = Object.assign(new FS.FSStream(), stream);
        if (fd == -1) {
          fd = FS.nextfd();
        }
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },
  closeStream(fd) {
        FS.streams[fd] = null;
      },
  dupStream(origStream, fd = -1) {
        var stream = FS.createStream(origStream, fd);
        stream.stream_ops?.dup?.(stream);
        return stream;
      },
  doSetAttr(stream, node, attr) {
        var setattr = stream?.stream_ops.setattr;
        var arg = setattr ? stream : node;
        setattr ??= node.node_ops.setattr;
        FS.checkOpExists(setattr, 63)
        try {
          setattr(arg, attr);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new FS.ErrnoError(22);
          }
          throw e;
        }
      },
  chrdev_stream_ops:{
  open(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          stream.stream_ops.open?.(stream);
        },
  llseek() {
          throw new FS.ErrnoError(70);
        },
  },
  major:(dev) => ((dev) >> 8),
  minor:(dev) => ((dev) & 0xff),
  makedev:(ma, mi) => ((ma) << 8 | (mi)),
  registerDevice(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },
  getDevice:(dev) => FS.devices[dev],
  getMounts(mount) {
        var mounts = [];
        var check = [mount];

        while (check.length) {
          var m = check.pop();

          mounts.push(m);

          check.push(...m.mounts);
        }

        return mounts;
      },
  syncfs(populate, callback) {
        if (typeof populate == 'function') {
          callback = populate;
          populate = false;
        }

        FS.syncFSRequests++;

        if (FS.syncFSRequests > 1) {
          err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
        }

        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;

        function doCallback(errCode) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(errCode);
        }

        function done(errCode) {
          if (errCode) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(errCode);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };

        // sync all mounts
        for (var mount of mounts) {
          if (mount.type.syncfs) {
            mount.type.syncfs(mount, populate, done);
          } else {
            done(null);
          }
        }
      },
  mount(type, opts, mountpoint) {
        if (typeof type == 'string') {
          // The filesystem was not included, and instead we have an error
          // message stored in the variable.
          throw type;
        }
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;

        if (root && FS.root) {
          throw new FS.ErrnoError(10);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });

          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;

          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(10);
          }

          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(54);
          }
        }

        var mount = {
          type,
          opts,
          mountpoint,
          mounts: []
        };

        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;

        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;

          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }

        return mountRoot;
      },
  unmount(mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });

        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(28);
        }

        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);

        for (var [hash, current] of Object.entries(FS.nameTable)) {
          while (current) {
            var next = current.name_next;

            if (mounts.includes(current.mount)) {
              FS.destroyNode(current);
            }

            current = next;
          }
        }

        // no longer a mountpoint
        node.mounted = null;

        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },
  lookup(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },
  mknod(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name) {
          throw new FS.ErrnoError(28);
        }
        if (name === '.' || name === '..') {
          throw new FS.ErrnoError(20);
        }
        var errCode = FS.mayCreate(parent, name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },
  statfs(path) {
        return FS.statfsNode(FS.lookupPath(path, {follow: true}).node);
      },
  statfsStream(stream) {
        // We keep a separate statfsStream function because noderawfs overrides
        // it. In noderawfs, stream.node is sometimes null. Instead, we need to
        // look at stream.path.
        return FS.statfsNode(stream.node);
      },
  statfsNode(node) {
        // NOTE: None of the defaults here are true. We're just returning safe and
        //       sane values. Currently nodefs and rawfs replace these defaults,
        //       other file systems leave them alone.
        var rtn = {
          bsize: 4096,
          frsize: 4096,
          blocks: 1e6,
          bfree: 5e5,
          bavail: 5e5,
          files: FS.nextInode,
          ffree: FS.nextInode - 1,
          fsid: 42,
          flags: 2,
          namelen: 255,
        };

        if (node.node_ops.statfs) {
          Object.assign(rtn, node.node_ops.statfs(node.mount.opts.root));
        }
        return rtn;
      },
  create(path, mode = 0o666) {
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },
  mkdir(path, mode = 0o777) {
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },
  mkdirTree(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var dir of dirs) {
          if (!dir) continue;
          if (d || PATH.isAbs(path)) d += '/';
          d += dir;
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 20) throw e;
          }
        }
      },
  mkdev(path, mode, dev) {
        if (typeof dev == 'undefined') {
          dev = mode;
          mode = 0o666;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },
  symlink(oldpath, newpath) {
        if (!PATH_FS.resolve(oldpath)) {
          throw new FS.ErrnoError(44);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var newname = PATH.basename(newpath);
        var errCode = FS.mayCreate(parent, newname);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },
  link(oldpath, newpath, flags) {
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var newname = PATH.basename(newpath);
        var errCode = FS.mayCreate(parent, newname);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        // Hardlinks are only supported by filesystem backends that provide a
        // `link` node op (e.g. NODERAWFS backed by the host). NODEFS omits it:
        // a host hardlink cannot be confined to the mount root.
        if (!parent.node_ops.link) {
          throw new FS.ErrnoError(34);
        }
        return parent.node_ops.link(parent, newname, oldpath, flags);
      },
  rename(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;

        // let the errors from non existent directories percolate up
        lookup = FS.lookupPath(old_path, { parent: true });
        old_dir = lookup.node;
        lookup = FS.lookupPath(new_path, { parent: true });
        new_dir = lookup.node;

        if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(75);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH_FS.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(28);
        }
        // new path should not be an ancestor of the old path
        relative = PATH_FS.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(55);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var errCode = FS.mayDelete(old_dir, old_name, isdir);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        errCode = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(10);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          errCode = FS.nodePermissions(old_dir, 'w');
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
          // update old node (we do this here to avoid each backend
          // needing to)
          old_node.parent = new_dir;
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
      },
  rmdir(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, true);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
      },
  readdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        var readdir = FS.checkOpExists(node.node_ops.readdir, 54);
        return readdir(node);
      },
  unlink(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, false);
        if (errCode) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
      },
  readlink(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(44);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(28);
        }
        return link.node_ops.readlink(link);
      },
  stat(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        var getattr = FS.checkOpExists(node.node_ops.getattr, 63);
        return getattr(node);
      },
  fstat(fd) {
        var stream = FS.getStreamChecked(fd);
        var node = stream.node;
        var getattr = stream.stream_ops.getattr;
        var arg = getattr ? stream : node;
        getattr ??= node.node_ops.getattr;
        FS.checkOpExists(getattr, 63)
        return getattr(arg);
      },
  lstat(path) {
        return FS.stat(path, true);
      },
  doChmod(stream, node, mode, dontFollow) {
        FS.doSetAttr(stream, node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          ctime: Date.now(),
          dontFollow
        });
      },
  chmod(path, mode, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doChmod(null, node, mode, dontFollow);
      },
  lchmod(path, mode) {
        FS.chmod(path, mode, true);
      },
  fchmod(fd, mode) {
        var stream = FS.getStreamChecked(fd);
        FS.doChmod(stream, stream.node, mode, false);
      },
  doChown(stream, node, dontFollow) {
        FS.doSetAttr(stream, node, {
          timestamp: Date.now(),
          dontFollow
          // we ignore the uid / gid for now
        });
      },
  chown(path, uid, gid, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doChown(null, node, dontFollow);
      },
  lchown(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },
  fchown(fd, uid, gid) {
        var stream = FS.getStreamChecked(fd);
        FS.doChown(stream, stream.node, false);
      },
  doTruncate(stream, node, len) {
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(28);
        }
        var errCode = FS.nodePermissions(node, 'w');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.doSetAttr(stream, node, {
          size: len,
          timestamp: Date.now()
        });
      },
  truncate(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(28);
        }
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doTruncate(null, node, len);
      },
  ftruncate(fd, len) {
        var stream = FS.getStreamChecked(fd);
        if (len < 0 || (stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(28);
        }
        FS.doTruncate(stream, stream.node, len);
      },
  utime(path, atime, mtime, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        FS.doSetAttr(null, lookup.node, {
          atime: atime,
          mtime: mtime,
          dontFollow
        });
      },
  open(path, flags, mode = 0o666) {
        if (path === '') {
          throw new FS.ErrnoError(44);
        }
        flags = FS_modeStringToFlags(flags);
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        var isDirPath;
        if (typeof path == 'object') {
          node = path;
        } else {
          isDirPath = path.endsWith('/');
          // noent_okay makes it so that if the final component of the path
          // doesn't exist, lookupPath returns `node: undefined`. `path` will be
          // updated to point to the target of all symlinks.
          var lookup = FS.lookupPath(path, {
            follow: !(flags & 131072),
            noent_okay: true
          });
          node = lookup.node;
          path = lookup.path;
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(20);
            }
          } else if (isDirPath) {
            throw new FS.ErrnoError(31);
          } else {
            // node doesn't exist, try to create it
            // Ignore the permission bits here to ensure we can `open` this new
            // file below. We use chmod below to apply the permissions once the
            // file is open.
            node = FS.mknod(path, mode | 0o777, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(54);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var errCode = FS.mayOpen(node, flags);
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // do truncation if necessary
        if ((flags & 512) && !created) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512 | 131072);

        // register the stream with the filesystem
        var stream = FS.createStream({
          node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        });
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (created) {
          FS.chmod(node, mode & 0o777);
        }
        return stream;
      },
  close(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        // The fd is going away: wake anything waiting on it (poll/epoll) with
        // POLLNVAL so a blocking wait unblocks and an epoll registration is evicted
        // on its next derive. Only sockets/pipes/epoll ever carry a wait-queue, so
        // for every other stream (incl. nodeless noderawfs stdio) this is a no-op.
        stream.node?.notifyListeners(32);
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },
  isClosed(stream) {
        return stream.fd === null;
      },
  llseek(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(70);
        }
        if (whence != 0 && whence != 1 && whence != 2) {
          throw new FS.ErrnoError(28);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },
  read(stream, buffer, offset, length, position) {
        assert(offset >= 0);
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(28);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },
  write(stream, buffer, offset, length, position, canOwn) {
        assert(offset >= 0);
        assert(buffer.subarray, 'FS.write expects a TypedArray');
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(28);
        }
        if (stream.seekable && stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        return bytesWritten;
      },
  mmap(stream, length, position, prot, flags) {
        // User requests writing to file (prot & PROT_WRITE != 0).
        // Checking if we have permissions to write to the file unless
        // MAP_PRIVATE flag is set. According to POSIX spec it is possible
        // to write to file opened in read-only mode with MAP_PRIVATE flag,
        // as all modifications will be visible only in the memory of
        // the current process.
        if ((prot & 2)
            && !(flags & 2)
            && (stream.flags & 2097155) !== 2) {
          throw new FS.ErrnoError(2);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(2);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(43);
        }
        if (!length) {
          throw new FS.ErrnoError(28);
        }
        return stream.stream_ops.mmap(stream, length, position, prot, flags);
      },
  msync(stream, buffer, offset, length, mmapFlags) {
        assert(offset >= 0);
        if (!stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },
  ioctl(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(59);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },
  readFile(path, opts = {}) {
        opts.flags = opts.flags ?? 0;
        opts.encoding = opts.encoding ?? 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          abort(`Invalid encoding type "${opts.encoding}"`);
        }
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          buf = UTF8ArrayToString(buf);
        }
        FS.close(stream);
        return buf;
      },
  writeFile(path, data, opts = {}) {
        opts.flags = opts.flags ?? 577;
        var stream = FS.open(path, opts.flags, opts.mode);
        data = FS_fileDataToTypedArray(data);
        FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        FS.close(stream);
      },
  cwd:() => FS.currentPath,
  chdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(44);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(54);
        }
        var errCode = FS.nodePermissions(lookup.node, 'x');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.currentPath = lookup.path;
      },
  createDefaultDirectories() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },
  createDefaultDevices() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: () => 0,
          write: (stream, buffer, offset, length, pos) => length,
          llseek: () => 0,
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using err() rather than out()
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        // use a buffer to avoid overhead of individual crypto calls per byte
        var randomBuffer = new Uint8Array(1024), randomLeft = 0;
        var randomByte = () => {
          if (!randomLeft) {
            randomFill(randomBuffer);
            randomLeft = randomBuffer.byteLength;
          }
          return randomBuffer[--randomLeft];
        };
        FS.createDevice('/dev', 'random', randomByte);
        FS.createDevice('/dev', 'urandom', randomByte);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },
  createSpecialDirectories() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the
        // name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        var proc_self = FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount() {
            var node = FS.createNode(proc_self, 'fd', 16895, 73);
            node.stream_ops = {
              llseek: MEMFS.stream_ops.llseek,
            };
            node.node_ops = {
              lookup(parent, name) {
                var fd = +name;
                var stream = FS.getStreamChecked(fd);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: () => stream.path },
                  id: fd + 1,
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              },
              readdir() {
                return Array.from(FS.streams.entries())
                  .filter(([k, v]) => v)
                  .map(([k, v]) => k.toString());
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },
  createStandardStreams(input, output, error) {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops

        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (input) {
          FS.createDevice('/dev', 'stdin', input);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (output) {
          FS.createDevice('/dev', 'stdout', null, output);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (error) {
          FS.createDevice('/dev', 'stderr', null, error);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }

        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 0);
        var stdout = FS.open('/dev/stdout', 1);
        var stderr = FS.open('/dev/stderr', 1);
        assert(stdin.fd === 0, `invalid handle for stdin (${stdin.fd})`);
        assert(stdout.fd === 1, `invalid handle for stdout (${stdout.fd})`);
        assert(stderr.fd === 2, `invalid handle for stderr (${stderr.fd})`);
      },
  staticInit() {
        FS.nameTable = new Array(4096);

        FS.mount(MEMFS, {}, '/');

        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();

        FS.filesystems = {
          'MEMFS': MEMFS,
        };
      },
  init(input, output, error) {
        assert(!FS.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.initialized = true;

        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        input ??= Module['stdin'];
        output ??= Module['stdout'];
        error ??= Module['stderr'];

        FS.createStandardStreams(input, output, error);
      },
  quit() {
        FS.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        _fflush(0);
        // close all of our streams
        for (var stream of FS.streams) {
          if (stream) {
            FS.close(stream);
          }
        }
      },
  findObject(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (!ret.exists) {
          return null;
        }
        return ret.object;
      },
  analyzePath(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },
  createPath(parent, path, canRead, canWrite) {
        parent = typeof parent == 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            if (e.errno != 20) throw e;
          }
          parent = current;
        }
        return current;
      },
  createFile(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(canRead, canWrite);
        return FS.create(path, mode);
      },
  createDataFile(parent, name, data, canRead, canWrite, canOwn) {
        var path = name;
        if (parent) {
          parent = typeof parent == 'string' ? parent : FS.getPath(parent);
          path = name ? PATH.join2(parent, name) : parent;
        }
        var mode = FS_getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          data = FS_fileDataToTypedArray(data);
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 577);
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
      },
  createDevice(parent, name, input, output) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(!!input, !!output);
        FS.createDevice.major ??= 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open(stream) {
            stream.seekable = false;
          },
          close(stream) {
            // flush any pending line data
            if (output?.buffer?.length) {
              output(10);
            }
          },
          read(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
              if (result === undefined && !bytesRead) {
                throw new FS.ErrnoError(6);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.atime = Date.now();
            }
            return bytesRead;
          },
          write(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
            }
            if (length) {
              stream.node.mtime = stream.node.ctime = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },
  forceLoadFile(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        if (globalThis.XMLHttpRequest) {
          abort('Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.');
        } else { // Command-line.
          try {
            obj.contents = readBinary(obj.url);
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
        }
      },
  createLazyFile(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array).
        // Actual getting is abstracted away for eventual reuse.
        class LazyUint8Array {
          lengthKnown = false;
          chunks = []; // Loaded chunks. Index is the chunk number
          get(idx) {
            if (idx > this.length-1 || idx < 0) {
              return undefined;
            }
            var chunkOffset = idx % this.chunkSize;
            var chunkNum = (idx / this.chunkSize)|0;
            return this.getter(chunkNum)[chunkOffset];
          }
          setDataGetter(getter) {
            this.getter = getter;
          }
          cacheLength() {
            // Find length
            var xhr = new XMLHttpRequest();
            xhr.open('HEAD', url, false);
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) abort(`Couldn't load ${url}. Status: ${xhr.status}`);
            var datalength = Number(xhr.getResponseHeader('Content-length'));
            var header;
            var hasByteServing = (header = xhr.getResponseHeader('Accept-Ranges')) && header === 'bytes';
            var usesGzip = (header = xhr.getResponseHeader('Content-Encoding')) && header === 'gzip';

            var chunkSize = 1024*1024; // Chunk size in bytes

            if (!hasByteServing) chunkSize = datalength;

            // Function to get a range from the remote URL.
            var doXHR = (from, to) => {
              if (from > to) abort(`invalid range (${from}, ${to}) or no bytes requested!`);
              if (to > datalength-1) abort(`only ${datalength} bytes available! programmer error!`);

              // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
              var xhr = new XMLHttpRequest();
              xhr.open('GET', url, false);
              if (datalength !== chunkSize) xhr.setRequestHeader('Range', `bytes=${from}-${to}`);

              // Some hints to the browser that we want binary data.
              xhr.responseType = 'arraybuffer';
              if (xhr.overrideMimeType) {
                xhr.overrideMimeType('text/plain; charset=x-user-defined');
              }

              xhr.send(null);
              if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) abort(`Couldn't load ${url}. Status: ${xhr.status}`);
              if (xhr.response !== undefined) {
                return new Uint8Array(/** @type{Array<number>} */(xhr.response || []));
              }
              return intArrayFromString(xhr.responseText ?? '', true);
            };
            var lazyArray = this;
            lazyArray.setDataGetter((chunkNum) => {
              var start = chunkNum * chunkSize;
              var end = (chunkNum+1) * chunkSize - 1; // including this byte
              end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') {
                lazyArray.chunks[chunkNum] = doXHR(start, end);
              }
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') abort('doXHR failed!');
              return lazyArray.chunks[chunkNum];
            });

            if (usesGzip || !datalength) {
              // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
              chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
              datalength = this.getter(0).length;
              chunkSize = datalength;
              out('LazyFiles on gzip forces download of the whole file when length is accessed');
            }

            this._length = datalength;
            this._chunkSize = chunkSize;
            this.lengthKnown = true;
          }
          get length() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._length;
          }
          get chunkSize() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._chunkSize;
          }
        }

        if (globalThis.XMLHttpRequest) {
          if (!ENVIRONMENT_IS_WORKER) abort('Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc');
          var lazyArray = new LazyUint8Array();
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }

        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        for (const [key, fn] of Object.entries(node.stream_ops)) {
          stream_ops[key] = (...args) => {
            FS.forceLoadFile(node);
            return fn(...args);
          };
        }
        function writeChunks(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        }
        // use a custom read function
        stream_ops.read = (stream, buffer, offset, length, position) => {
          FS.forceLoadFile(node);
          return writeChunks(stream, buffer, offset, length, position)
        };
        // use a custom mmap function
        stream_ops.mmap = (stream, length, position, prot, flags) => {
          FS.forceLoadFile(node);
          var ptr = mmapAlloc(length);
          if (!ptr) {
            throw new FS.ErrnoError(48);
          }
          writeChunks(stream, HEAP8, ptr, length, position);
          return { ptr, allocated: true };
        };
        node.stream_ops = stream_ops;
        return node;
      },
  };





  /** not-@type {!BigInt64Array} */
  var HEAP64;
  var SYSCALLS = {
  currentUmask:18,
  calculateAt(dirfd, path, allowEmpty) {
        if (PATH.isAbs(path)) {
          return path;
        }
        // relative path
        var dir;
        if (dirfd === -100) {
          dir = FS.cwd();
        } else {
          var dirstream = SYSCALLS.getStreamFromFD(dirfd);
          dir = dirstream.path;
        }
        if (path.length == 0) {
          if (!allowEmpty) {
            throw new FS.ErrnoError(44);;
          }
          return dir;
        }
        return dir + '/' + path;
      },
  writeStat(buf, stat) {
        HEAPU32[((buf)>>2)] = stat.dev;
        HEAPU32[(((buf)+(4))>>2)] = stat.mode;
        HEAPU32[(((buf)+(8))>>2)] = stat.nlink;
        HEAPU32[(((buf)+(12))>>2)] = stat.uid;
        HEAPU32[(((buf)+(16))>>2)] = stat.gid;
        HEAPU32[(((buf)+(20))>>2)] = stat.rdev;
        HEAP64[(((buf)+(24))>>3)] = BigInt(stat.size);
        HEAP32[(((buf)+(32))>>2)] = 4096;
        HEAP32[(((buf)+(36))>>2)] = stat.blocks;
        var atime = stat.atime.getTime();
        var mtime = stat.mtime.getTime();
        var ctime = stat.ctime.getTime();
        HEAP64[(((buf)+(40))>>3)] = BigInt(Math.floor(atime / 1000));
        HEAPU32[(((buf)+(48))>>2)] = (atime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(56))>>3)] = BigInt(Math.floor(mtime / 1000));
        HEAPU32[(((buf)+(64))>>2)] = (mtime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(72))>>3)] = BigInt(Math.floor(ctime / 1000));
        HEAPU32[(((buf)+(80))>>2)] = (ctime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(88))>>3)] = BigInt(stat.ino);
        return 0;
      },
  writeStatFs(buf, stats) {
        HEAPU32[(((buf)+(4))>>2)] = stats.bsize;
        HEAPU32[(((buf)+(60))>>2)] = stats.bsize;
        HEAP64[(((buf)+(8))>>3)] = BigInt(stats.blocks);
        HEAP64[(((buf)+(16))>>3)] = BigInt(stats.bfree);
        HEAP64[(((buf)+(24))>>3)] = BigInt(stats.bavail);
        HEAP64[(((buf)+(32))>>3)] = BigInt(stats.files);
        HEAP64[(((buf)+(40))>>3)] = BigInt(stats.ffree);
        HEAPU32[(((buf)+(48))>>2)] = stats.fsid;
        HEAPU32[(((buf)+(64))>>2)] = stats.flags;  // ST_NOSUID
        HEAPU32[(((buf)+(56))>>2)] = stats.namelen;
      },
  doMsync(addr, stream, len, flags, offset) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(43);
        }
        if (flags & 2) {
          // MAP_PRIVATE calls need not to be synced back to underlying fs
          return 0;
        }
        var buffer = HEAPU8.subarray(addr, addr + len);
        FS.msync(stream, buffer, offset, len, flags);
      },
  getStreamFromFD(fd) {
        var stream = FS.getStreamChecked(fd);
        return stream;
      },
  varargs:undefined,
  getStr(ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      },
  };
  function ___syscall_fstat64(fd, buf) {
  try {

      return SYSCALLS.writeStat(buf, FS.fstat(fd));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }




  var stringToUTF8 = (str, outPtr, maxBytesToWrite) => {
      assert(typeof maxBytesToWrite == 'number', 'stringToUTF8 requires a third parameter that specifies the length of the output buffer');
      return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
    };
  function ___syscall_getcwd(buf, size) {
  try {

      if (!size) return -28;
      var cwd = FS.cwd();
      var cwdLengthInBytes = lengthBytesUTF8(cwd) + 1;
      if (size < cwdLengthInBytes) return -68;
      stringToUTF8(cwd, buf, size);
      return cwdLengthInBytes;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }


  function ___syscall_lstat64(path, buf) {
  try {

      path = SYSCALLS.getStr(path);
      return SYSCALLS.writeStat(buf, FS.lstat(path));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }


  function ___syscall_newfstatat(dirfd, path, buf, flags) {
  try {

      path = SYSCALLS.getStr(path);
      var nofollow = flags & 256;
      var allowEmpty = flags & 4096;
      flags = flags & (~6400);
      assert(!flags, `unknown flags in __syscall_newfstatat: ${flags}`);
      path = SYSCALLS.calculateAt(dirfd, path, allowEmpty);
      return SYSCALLS.writeStat(buf, nofollow ? FS.lstat(path) : FS.stat(path));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }


  var syscallGetVarargI = () => {
      assert(SYSCALLS.varargs != undefined);
      // the `+` prepended here is necessary to convince the JSCompiler that varargs is indeed a number.
      var ret = HEAP32[((+SYSCALLS.varargs)>>2)];
      SYSCALLS.varargs += 4;
      return ret;
    };

  function ___syscall_openat(dirfd, path, flags, varargs) {
  SYSCALLS.varargs = varargs;
  try {

      path = SYSCALLS.getStr(path);
      path = SYSCALLS.calculateAt(dirfd, path);
      var mode = varargs ? syscallGetVarargI() : 0;
      if (flags & 64) {
        mode &= ~SYSCALLS.currentUmask;
      }
      return FS.open(path, flags, mode).fd;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }


  function ___syscall_stat64(path, buf) {
  try {

      path = SYSCALLS.getStr(path);
      return SYSCALLS.writeStat(buf, FS.stat(path));
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return -e.errno;
  }
  }


  function ___wbg_flushInput_61b4a84bc8955703() {
          globalThis.RogueHost.flushInput();
      }

  function ___wbg_outcome_2cfb290db6eb2825(arg0, arg1, arg2) {
          globalThis.RogueHost.outcome(arg0, arg1 >>> 0, arg2 >>> 0);
      }

  function ___wbg_present_1f2fedfc793733b8(arg0, arg1) {
          globalThis.RogueHost.present(arg0 >>> 0, arg1 >>> 0);
      }

  function ___wbg_readEvent_301bd8e7f56f46db() {
          const ret = globalThis.RogueHost.readEvent();
          return ret;
      }

  function ___wbg_store_3bb7af17e4e409d3(arg0, arg1) {
          globalThis.RogueHost.store(arg0 >>> 0, arg1 >>> 0);
      }

  function ___wbindgen_init_externref_table() {
          const table = ___wbindgen_externrefs;
          const offset = table.grow(4);
          table.set(0, undefined);
          table.set(offset + 0, undefined);
          table.set(offset + 1, null);
          table.set(offset + 2, true);
          table.set(offset + 3, false);
      }

  var __abort_js = () =>
      abort('native code called abort()');

  var runtimeKeepaliveCounter = 0;
  var __emscripten_runtime_keepalive_clear = () => {
      noExitRuntime = false;
      runtimeKeepaliveCounter = 0;
    };

  var __emscripten_throw_longjmp = () => {
      throw new EmscriptenSjLj;
    };

  var isLeapYear = (year) => year%4 === 0 && (year%100 !== 0 || year%400 === 0);

  var MONTH_DAYS_LEAP_CUMULATIVE = [0,31,60,91,121,152,182,213,244,274,305,335];

  var MONTH_DAYS_REGULAR_CUMULATIVE = [0,31,59,90,120,151,181,212,243,273,304,334];
  var ydayFromDate = (date) => {
      var leap = isLeapYear(date.getFullYear());
      var monthDaysCumulative = (leap ? MONTH_DAYS_LEAP_CUMULATIVE : MONTH_DAYS_REGULAR_CUMULATIVE);
      var yday = monthDaysCumulative[date.getMonth()] + date.getDate() - 1; // -1 since it's days since Jan 1

      return yday;
    };

  var INT53_MAX = 9007199254740992;

  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);

  function __localtime_js(time, tmPtr) {
    time = bigintToI53Checked(time);


      var date = new Date(time*1000);
      if (isNaN(date.getTime())) {
        return 1;
      }
      HEAP32[((tmPtr)>>2)] = date.getSeconds();
      HEAP32[(((tmPtr)+(4))>>2)] = date.getMinutes();
      HEAP32[(((tmPtr)+(8))>>2)] = date.getHours();
      HEAP32[(((tmPtr)+(12))>>2)] = date.getDate();
      HEAP32[(((tmPtr)+(16))>>2)] = date.getMonth();
      HEAP32[(((tmPtr)+(20))>>2)] = date.getFullYear()-1900;
      HEAP32[(((tmPtr)+(24))>>2)] = date.getDay();

      var yday = ydayFromDate(date)|0;
      HEAP32[(((tmPtr)+(28))>>2)] = yday;
      HEAP32[(((tmPtr)+(36))>>2)] = -(date.getTimezoneOffset() * 60);

      // Attention: DST is in December in South, and some regions don't have DST at all.
      var start = new Date(date.getFullYear(), 0, 1);
      var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
      var winterOffset = start.getTimezoneOffset();
      var dst = (summerOffset != winterOffset && date.getTimezoneOffset() == Math.min(winterOffset, summerOffset))|0;
      HEAP32[(((tmPtr)+(32))>>2)] = dst;
      return 0;
    ;
  }

  var timers = {
  };

  var clearTimers = () => {
      for (var t of Object.values(timers)) {
        clearTimeout(t.id);
      }
    };

  var handleException = (e) => {
      // Certain exception types we do not treat as errors since they are used for
      // internal control flow.
      // 1. ExitStatus, which is thrown by exit()
      // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
      //    that wish to return to JS event loop.
      if (e instanceof ExitStatus || e == 'unwind') {
        return EXITSTATUS;
      }
      checkStackCookie();
      if (e instanceof WebAssembly.RuntimeError) {
        if (_emscripten_stack_get_current() <= 0) {
          err('Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 4194304)');
        }
      }
      quit_(1, e);
    };


  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  var _proc_exit = (code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        Module['onExit']?.(code);
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    };


  /** @param {boolean|number=} implicit */
  var exitJS = (status, implicit) => {
      EXITSTATUS = status;

      checkUnflushedContent();

      // if exit() was called explicitly, warn the user if the runtime isn't actually being shut down
      if (keepRuntimeAlive() && !implicit) {
        var msg = `program exited (with status: ${status}), but keepRuntimeAlive() is set (counter=${runtimeKeepaliveCounter}) due to an async operation, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)`;
        err(msg);
      }

      _proc_exit(status);
    };
  var _exit = exitJS;


  var maybeExit = () => {
      if (!keepRuntimeAlive()) {
        try {
          _exit(EXITSTATUS);
        } catch (e) {
          handleException(e);
        }
      }
    };
  var callUserCallback = (func) => {
      if (ABORT) {
        err('user callback triggered after runtime exited or application aborted.  Ignoring.');
        return;
      }
      try {
        return func();
      } catch (e) {
        handleException(e);
      } finally {
        maybeExit();
      }
    };


  var _emscripten_get_now = () => performance.now();
  var __setitimer_js = (which, timeout_ms) => {
      // First, clear any existing timer.
      if (timers[which]) {
        clearTimeout(timers[which].id);
        delete timers[which];
      }

      // A timeout of zero simply cancels the current timeout so we have nothing
      // more to do.
      if (!timeout_ms) return 0;

      var id = setTimeout(() => {
        assert(which in timers);
        delete timers[which];
        callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
      }, timeout_ms);
      timers[which] = { id, timeout_ms };
      return 0;
    };




  var __tzset_js = (timezone, daylight, std_name, dst_name) => {
      // TODO: Use (malleable) environment variables instead of system settings.
      var currentYear = new Date().getFullYear();
      var winter = new Date(currentYear, 0, 1);
      var summer = new Date(currentYear, 6, 1);
      var winterOffset = winter.getTimezoneOffset();
      var summerOffset = summer.getTimezoneOffset();

      // Local standard timezone offset. Local standard time is not adjusted for
      // daylight savings.  This code uses the fact that getTimezoneOffset returns
      // a greater value during Standard Time versus Daylight Saving Time (DST).
      // Thus it determines the expected output during Standard Time, and it
      // compares whether the output of the given date the same (Standard) or less
      // (DST).
      var stdTimezoneOffset = Math.max(winterOffset, summerOffset);

      // timezone is specified as seconds west of UTC ("The external variable
      // `timezone` shall be set to the difference, in seconds, between
      // Coordinated Universal Time (UTC) and local standard time."), the same
      // as returned by stdTimezoneOffset.
      // See http://pubs.opengroup.org/onlinepubs/009695399/functions/tzset.html
      HEAPU32[((timezone)>>2)] = stdTimezoneOffset * 60;

      HEAP32[((daylight)>>2)] = Number(winterOffset != summerOffset);

      var extractZone = (timezoneOffset) => {
        // Why inverse sign?
        // Read here https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
        var sign = timezoneOffset >= 0 ? '-' : '+';

        var absOffset = Math.abs(timezoneOffset)
        var hours = String(Math.floor(absOffset / 60)).padStart(2, '0');
        var minutes = String(absOffset % 60).padStart(2, '0');

        return `UTC${sign}${hours}${minutes}`;
      }

      var winterName = extractZone(winterOffset);
      var summerName = extractZone(summerOffset);
      assert(winterName);
      assert(summerName);
      assert(lengthBytesUTF8(winterName) <= 16, `timezone name truncated to fit in TZNAME_MAX (${winterName})`);
      assert(lengthBytesUTF8(summerName) <= 16, `timezone name truncated to fit in TZNAME_MAX (${summerName})`);
      if (summerOffset < winterOffset) {
        // Northern hemisphere
        stringToUTF8(winterName, std_name, 17);
        stringToUTF8(summerName, dst_name, 17);
      } else {
        stringToUTF8(winterName, dst_name, 17);
        stringToUTF8(summerName, std_name, 17);
      }
    };

  var _emscripten_date_now = () => Date.now();


  var getHeapMax = () =>
      // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
      // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
      // for any code that deals with heap sizes, which would require special
      // casing all heap size related code to treat 0 specially.
      2147483648;

  var alignMemory = (size, alignment) => {
      assert(alignment, 'alignment argument is required');
      return Math.ceil(size / alignment) * alignment;
    };

  var growMemory = (size) => {
      var oldHeapSize = wasmMemory.buffer.byteLength;
      var pages = ((size - oldHeapSize + 65535) / 65536) | 0;
      try {
        // round size grow request up to wasm page size (fixed 64KB per spec)
        wasmMemory.grow(pages); // .grow() takes a delta compared to the previous size
        updateMemoryViews();
        return 1 /*success*/;
      } catch(e) {
        err(`growMemory: Attempted to grow heap from ${oldHeapSize} bytes to ${size} bytes, but got error: ${e}`);
      }
      // implicit 0 return to save code size (caller will cast 'undefined' into 0
      // anyhow)
    };

  var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
      requestedSize >>>= 0;
      // With multithreaded builds, races can happen (another thread might increase the size
      // in between), so return a failure, and let the caller retry.
      assert(requestedSize > oldSize);

      // Memory resize rules:
      // 1.  Always increase heap size to at least the requested size, rounded up
      //     to next page multiple.
      // 2a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap
      //     geometrically: increase the heap size according to
      //     MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%), At most
      //     overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
      // 2b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap
      //     linearly: increase the heap size by at least
      //     MEMORY_GROWTH_LINEAR_STEP bytes.
      // 3.  Max size for the heap is capped at 2048MB-WASM_PAGE_SIZE, or by
      //     MAXIMUM_MEMORY, or by ASAN limit, depending on which is smallest
      // 4.  If we were unable to allocate as much memory, it may be due to
      //     over-eager decision to excessively reserve due to (3) above.
      //     Hence if an allocation fails, cut down on the amount of excess
      //     growth, in an attempt to succeed to perform a smaller allocation.

      // A limit is set for how much we can grow. We should not exceed that
      // (the wasm binary specifies it, so if we tried, we'd fail anyhow).
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        err(`Cannot enlarge memory, requested ${requestedSize} bytes, but the limit is ${maxHeapSize} bytes!`);
        return false;
      }

      // Loop through potential heap size increases. If we attempt a too eager
      // reservation that fails, cut down on the attempted size and reserve a
      // smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown); // ensure geometric growth
        // but limit overreserving (default to capping at +96MB overgrowth at most)
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296 );

        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));

        var replacement = growMemory(newSize);
        if (replacement) {

          return true;
        }
      }
      err(`Failed to grow the heap from ${oldSize} bytes to ${newSize} bytes, not enough memory!`);
      return false;
    };

  var ENV = {
  };

  var getExecutableName = () => thisProgram;
  var getEnvStrings = () => {
      if (!getEnvStrings.strings) {
        // Default values.
        var lang = (globalThis.navigator?.language ?? 'C').replace('-', '_') + '.UTF-8';
        var env = {
          'USER': 'web_user',
          'LOGNAME': 'web_user',
          'PATH': '/',
          'PWD': '/',
          'HOME': '/home/web_user',
          'LANG': lang,
          '_': getExecutableName()
        };
        // Apply the user-provided values, if any.
        for (var x in ENV) {
          // x is a key in ENV; if ENV[x] is undefined, that means it was
          // explicitly set to be so. We allow user code to do that to
          // force variables with default values to remain unset.
          if (ENV[x] === undefined) delete env[x];
          else env[x] = ENV[x];
        }
        var strings = [];
        for (var x in env) {
          strings.push(`${x}=${env[x]}`);
        }
        getEnvStrings.strings = strings;
      }
      return getEnvStrings.strings;
    };


  var _environ_get = (__environ, environ_buf) => {
      var bufSize = 0;
      var envp = 0;
      for (var string of getEnvStrings()) {
        var ptr = environ_buf + bufSize;
        HEAPU32[(((__environ)+(envp))>>2)] = ptr;
        bufSize += stringToUTF8(string, ptr, Infinity) + 1;
        envp += 4;
      }
      return 0;
    };



  var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
      var strings = getEnvStrings();
      HEAPU32[((penviron_count)>>2)] = strings.length;
      var bufSize = 0;
      for (var string of strings) {
        bufSize += lengthBytesUTF8(string) + 1;
      }
      HEAPU32[((penviron_buf_size)>>2)] = bufSize;
      return 0;
    };

  function _fd_close(fd) {
  try {

      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }



  /** @param {number=} offset */
  var doReadv = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        try {
          var curr = FS.read(stream, HEAP8, ptr, len, offset);
        } catch (e) {
          // On a non-blocking stream a subsequent read may would-block after we
          // already gathered data. POSIX readv is a single gather-read: return
          // what we have rather than failing the whole call.
          if (ret > 0 && e instanceof FS.ErrnoError &&
              (e.errno == 6 || e.errno == 6)) {
            break;
          }
          throw e;
        }
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) break; // nothing more to read
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };


  function _fd_read(fd, iov, iovcnt, pnum) {
  try {

      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doReadv(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }




  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);


  try {

      if (isNaN(offset)) return 22;
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.llseek(stream, offset, whence);
      HEAP64[((newOffset)>>3)] = BigInt(stream.position);
      if (stream.getdents && !offset && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  ;
  }



  /** @param {number=} offset */
  var doWritev = (stream, iov, iovcnt, offset) => {
      // Gather all iovecs into one contiguous buffer and issue a single
      // FS.write, matching POSIX writev's single gather-write semantics (as
      // __syscall_sendmsg already does). Per-iovec writes fragment a stream
      // socket send into multiple segments, breaking stream byte semantics.
      if (iovcnt == 1) {
        // Single iovec: write directly from HEAP8, no gather buffer needed.
        return FS.write(stream, HEAP8, HEAPU32[((iov)>>2)], HEAPU32[(((iov)+(4))>>2)], offset);
      }
      var total = 0;
      for (var i = 0, p = iov; i < iovcnt; i++, p += 8) {
        total += HEAPU32[(((p)+(4))>>2)];
      }
      var view = new Uint8Array(total);
      var voff = 0;
      for (var i = 0; i < iovcnt; i++, iov += 8) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        view.set(HEAPU8.subarray(ptr, ptr + len), voff);
        voff += len;
      }
      return FS.write(stream, view, 0, total, offset);
    };


  function _fd_write(fd, iov, iovcnt, pnum) {
  try {

      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doWritev(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }




  var onInits = [];
  var addOnInit = (cb) => onInits.push(cb);
  var initBindgen = () => {

          ___wbindgen_start();

          /* @ts-self-types="./game.d.ts" */

      };

  var getCFunc = (ident) => {
      var func = Module['_' + ident]; // closure exported function
      assert(func, `Cannot call unknown function ${ident}, make sure it is exported`);
      return func;
    };

  var writeArrayToMemory = (array, buffer) => {
      assert(array.length >= 0, 'writeArrayToMemory array must have a length (should be an array or typed array)')
      HEAP8.set(array, buffer);
    };



  var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
  var stringToUTF8OnStack = (str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    };





    /**
   * @param {string|null=} returnType
   * @param {Array=} argTypes
   * @param {Array=} args
   * @param {Object=} opts
   */
  var ccall = (ident, returnType, argTypes, args, opts) => {
      // For fast lookup of conversion functions
      var toC = {
        'string': (str) => {
          var ret = 0;
          if (str !== null && str !== undefined && str !== 0) { // null string
            ret = stringToUTF8OnStack(str);
          }
          return ret;
        },
        'array': (arr) => {
          var ret = stackAlloc(arr.length);
          writeArrayToMemory(arr, ret);
          return ret;
        }
      };

      function convertReturnValue(ret) {
        if (returnType === 'string') {
          return UTF8ToString(ret);
        }
        if (returnType === 'boolean') return Boolean(ret);
        return ret;
      }

      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      assert(returnType !== 'array', 'return type should not be "array"');
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (!stack) stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func(...cArgs);
      function onDone(ret) {
        if (stack) stackRestore(stack);
        return convertReturnValue(ret);
      }

      ret = onDone(ret);
      return ret;
    };




  FS.createPreloadedFile = FS_createPreloadedFile;
  FS.preloadFile = FS_preloadFile;
  FS.staticInit();;
addOnInit(initBindgen);;
// End JS library code

// include: postlibrary.js
// This file is included after the automatically-generated JS library code
// but before the wasm module is created.

{

  // Begin ATMODULES hooks
  if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];

if (Module['print']) out = Module['print'];
if (Module['printErr']) err = Module['printErr'];
  // End ATMODULES hooks

  checkIncomingModuleAPI();

  if (Module['arguments']) programArgs = Module['arguments'];
  if (Module['thisProgram']) thisProgram = Module['thisProgram'];

  // Assertions on removed incoming Module JS APIs.
  assert(typeof Module['memoryInitializerPrefixURL'] == 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['pthreadMainPrefixURL'] == 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['cdInitializerPrefixURL'] == 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['filePackagePrefixURL'] == 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['read'] == 'undefined', 'Module.read option was removed');
  assert(typeof Module['readAsync'] == 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
  assert(typeof Module['readBinary'] == 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
  assert(typeof Module['setWindowTitle'] == 'undefined', 'Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)');
  assert(typeof Module['TOTAL_MEMORY'] == 'undefined', 'Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY');
  assert(typeof Module['ENVIRONMENT'] == 'undefined', 'Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)');
  assert(typeof Module['STACK_SIZE'] == 'undefined', 'STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time')
  // If memory is defined in wasm, the user can't provide it, or set INITIAL_MEMORY
  assert(typeof Module['wasmMemory'] == 'undefined', 'Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally');
  assert(typeof Module['INITIAL_MEMORY'] == 'undefined', 'Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically');

  var preInit = Module['preInit'];
  if (preInit) {
    if (typeof preInit == 'function') Module['preInit'] = preInit = [preInit];
    // Written as a loop so that preInit functions that themselves add more
    // preInit functions.  Is this actually needed?
    while (preInit.length > 0) {
      preInit.shift()();
    }
  }
  consumedModuleProp('preInit');
}

// Begin runtime exports
  Module['ccall'] = ccall;
  Module['UTF8ToString'] = UTF8ToString;
  Module['FS'] = FS;
  var missingLibrarySymbols = [
  'writeI53ToI64',
  'writeI53ToI64Clamped',
  'writeI53ToI64Signaling',
  'writeI53ToU64Clamped',
  'writeI53ToU64Signaling',
  'readI53FromI64',
  'readI53FromU64',
  'convertI32PairToI53',
  'convertI32PairToI53Checked',
  'convertU32PairToI53',
  'getTempRet0',
  'setTempRet0',
  'createNamedFunction',
  'zeroMemory',
  'withStackSave',
  'inetPton4',
  'inetNtop4',
  'inetPton6',
  'inetNtop6',
  'readSockaddr',
  'writeSockaddr',
  'readEmAsmArgs',
  'jstoi_q',
  'autoResumeAudioContext',
  'getDynCaller',
  'dynCall',
  'runtimeKeepalivePush',
  'runtimeKeepalivePop',
  'asmjsMangle',
  'HandleAllocator',
  'addOnPostCtor',
  'addOnPreMain',
  'addOnExit',
  'STACK_SIZE',
  'STACK_ALIGN',
  'POINTER_SIZE',
  'ASSERTIONS',
  'cwrap',
  'convertJsFunctionToWasm',
  'getEmptyTableSlot',
  'updateTableMap',
  'getFunctionAddress',
  'addFunction',
  'removeFunction',
  'setValue',
  'getValue',
  'intArrayToString',
  'AsciiToString',
  'stringToAscii',
  'UTF16ToString',
  'stringToUTF16',
  'lengthBytesUTF16',
  'UTF32ToString',
  'stringToUTF32',
  'lengthBytesUTF32',
  'stringToNewUTF8',
  'registerKeyEventCallback',
  'maybeCStringToJsString',
  'findEventTarget',
  'getBoundingClientRect',
  'fillMouseEventData',
  'registerMouseEventCallback',
  'registerWheelEventCallback',
  'registerUiEventCallback',
  'registerFocusEventCallback',
  'fillDeviceOrientationEventData',
  'registerDeviceOrientationEventCallback',
  'fillDeviceMotionEventData',
  'registerDeviceMotionEventCallback',
  'screenOrientation',
  'fillOrientationChangeEventData',
  'registerOrientationChangeEventCallback',
  'fillFullscreenChangeEventData',
  'registerFullscreenChangeEventCallback',
  'callCanvasResizedCallback',
  'JSEvents_requestFullscreen',
  'JSEvents_resizeCanvasForFullscreen',
  'registerRestoreOldStyle',
  'hideEverythingExceptGivenElement',
  'restoreHiddenElements',
  'setLetterbox',
  'currentFullscreenStrategy',
  'softFullscreenResizeWebGLRenderTarget',
  'doRequestFullscreen',
  'fillPointerlockChangeEventData',
  'registerPointerlockChangeEventCallback',
  'registerPointerlockErrorEventCallback',
  'requestPointerLock',
  'fillVisibilityChangeEventData',
  'registerVisibilityChangeEventCallback',
  'registerTouchEventCallback',
  'fillGamepadEventData',
  'registerGamepadEventCallback',
  'registerBeforeUnloadEventCallback',
  'fillBatteryEventData',
  'registerBatteryEventCallback',
  'setCanvasElementSize',
  'getCanvasElementSize',
  'jsStackTrace',
  'getCallstack',
  'convertPCtoSourceLocation',
  'checkWasiClock',
  'wasiRightsToMuslOFlags',
  'wasiOFlagsToMuslOFlags',
  'safeSetTimeout',
  'setImmediateWrapped',
  'safeRequestAnimationFrame',
  'clearImmediateWrapped',
  'registerPostMainLoop',
  'registerPreMainLoop',
  'getPromise',
  'makePromise',
  'addPromise',
  'idsToPromises',
  'makePromiseCallback',
  'Browser_asyncPrepareDataCounter',
  'arraySum',
  'addDays',
  'getSocketFromFD',
  'getSocketAddress',
  'FS_mkdirTree',
  '_setNetworkCallback',
  'heapObjectForWebGLType',
  'toTypedArrayIndex',
  'webgl_enable_ANGLE_instanced_arrays',
  'webgl_enable_OES_vertex_array_object',
  'webgl_enable_WEBGL_draw_buffers',
  'webgl_enable_WEBGL_multi_draw',
  'webgl_enable_EXT_polygon_offset_clamp',
  'webgl_enable_EXT_clip_control',
  'webgl_enable_WEBGL_polygon_mode',
  'emscriptenWebGLGet',
  'computeUnpackAlignedImageSize',
  'colorChannelsInGlTextureFormat',
  'emscriptenWebGLGetTexPixelData',
  'emscriptenWebGLGetUniform',
  'webglGetProgramUniformLocation',
  'webglGetUniformLocation',
  'webglPrepareUniformLocationsBeforeFirstUse',
  'webglGetLeftBracePos',
  'emscriptenWebGLGetVertexAttrib',
  '__glGetActiveAttribOrUniform',
  'writeGLArray',
  'registerWebGlEventCallback',
  'runAndAbortIfError',
  'writeStringToMemory',
  'writeAsciiToMemory',
  'allocateUTF8',
  'allocateUTF8OnStack',
  'stackTrace',
  'getNativeTypeSize',
];
missingLibrarySymbols.forEach(missingLibrarySymbol)

  var unexportedSymbols = [
  'run',
  'out',
  'err',
  'callMain',
  'abort',
  'wasmExports',
  'writeStackCookie',
  'checkStackCookie',
  'INT53_MAX',
  'INT53_MIN',
  'bigintToI53Checked',
  'HEAP8',
  'HEAP16',
  'HEAPU16',
  'HEAP32',
  'HEAPU32',
  'HEAPF32',
  'HEAPF64',
  'HEAP64',
  'HEAPU64',
  'stackSave',
  'stackRestore',
  'stackAlloc',
  'ptrToString',
  'exitJS',
  'getHeapMax',
  'growMemory',
  'ENV',
  'ERRNO_CODES',
  'strError',
  'DNS',
  'Protocols',
  'Sockets',
  'timers',
  'warnOnce',
  'readEmAsmArgsArray',
  'getExecutableName',
  'handleException',
  'keepRuntimeAlive',
  'callUserCallback',
  'maybeExit',
  'asyncLoad',
  'alignMemory',
  'mmapAlloc',
  'wasmTable',
  'wasmMemory',
  'getUniqueRunDependency',
  'noExitRuntime',
  'addRunDependency',
  'removeRunDependency',
  'addOnPreRun',
  'addOnInit',
  'addOnPostRun',
  'freeTableIndexes',
  'functionsInTableMap',
  'PATH',
  'PATH_FS',
  'UTF8Decoder',
  'UTF8ArrayToString',
  'stringToUTF8Array',
  'stringToUTF8',
  'lengthBytesUTF8',
  'intArrayFromString',
  'UTF16Decoder',
  'stringToUTF8OnStack',
  'writeArrayToMemory',
  'JSEvents',
  'specialHTMLTargets',
  'findCanvasEventTarget',
  'restoreOldWindowedStyle',
  'UNWIND_CACHE',
  'ExitStatus',
  'getEnvStrings',
  'doReadv',
  'doWritev',
  'initRandomFill',
  'randomFill',
  'emSetImmediate',
  'emClearImmediate_deps',
  'emClearImmediate',
  'promiseMap',
  'Browser',
  'requestFullscreen',
  'setCanvasSize',
  'getUserMedia',
  'createContext',
  'getPreloadedImageData__data',
  'wget',
  'MONTH_DAYS_REGULAR',
  'MONTH_DAYS_LEAP',
  'MONTH_DAYS_REGULAR_CUMULATIVE',
  'MONTH_DAYS_LEAP_CUMULATIVE',
  'isLeapYear',
  'ydayFromDate',
  'SYSCALLS',
  'preloadPlugins',
  'FS_createPreloadedFile',
  'FS_preloadFile',
  'FS_modeStringToFlags',
  'FS_getMode',
  'FS_fileDataToTypedArray',
  'FS_stdin_getChar_buffer',
  'FS_stdin_getChar',
  'FS_unlink',
  'FS_createPath',
  'FS_createDevice',
  'FS_readFile',
  'FS_root',
  'FS_mounts',
  'FS_devices',
  'FS_streams',
  'FS_nextInode',
  'FS_nameTable',
  'FS_currentPath',
  'FS_initialized',
  'FS_ignorePermissions',
  'FS_filesystems',
  'FS_syncFSRequests',
  'FS_lookupPath',
  'FS_getPath',
  'FS_hashName',
  'FS_hashAddNode',
  'FS_hashRemoveNode',
  'FS_lookupNode',
  'FS_createNode',
  'FS_destroyNode',
  'FS_isRoot',
  'FS_isMountpoint',
  'FS_isFile',
  'FS_isDir',
  'FS_isLink',
  'FS_isChrdev',
  'FS_isBlkdev',
  'FS_isFIFO',
  'FS_isSocket',
  'FS_flagsToPermissionString',
  'FS_nodePermissions',
  'FS_mayLookup',
  'FS_mayCreate',
  'FS_mayDelete',
  'FS_mayOpen',
  'FS_checkOpExists',
  'FS_nextfd',
  'FS_getStreamChecked',
  'FS_getStream',
  'FS_createStream',
  'FS_closeStream',
  'FS_dupStream',
  'FS_doSetAttr',
  'FS_chrdev_stream_ops',
  'FS_major',
  'FS_minor',
  'FS_makedev',
  'FS_registerDevice',
  'FS_getDevice',
  'FS_getMounts',
  'FS_syncfs',
  'FS_mount',
  'FS_unmount',
  'FS_lookup',
  'FS_mknod',
  'FS_statfs',
  'FS_statfsStream',
  'FS_statfsNode',
  'FS_create',
  'FS_mkdir',
  'FS_mkdev',
  'FS_symlink',
  'FS_link',
  'FS_rename',
  'FS_rmdir',
  'FS_readdir',
  'FS_readlink',
  'FS_stat',
  'FS_fstat',
  'FS_lstat',
  'FS_doChmod',
  'FS_chmod',
  'FS_lchmod',
  'FS_fchmod',
  'FS_doChown',
  'FS_chown',
  'FS_lchown',
  'FS_fchown',
  'FS_doTruncate',
  'FS_truncate',
  'FS_ftruncate',
  'FS_utime',
  'FS_open',
  'FS_close',
  'FS_isClosed',
  'FS_llseek',
  'FS_read',
  'FS_write',
  'FS_mmap',
  'FS_msync',
  'FS_ioctl',
  'FS_writeFile',
  'FS_cwd',
  'FS_chdir',
  'FS_createDefaultDirectories',
  'FS_createDefaultDevices',
  'FS_createSpecialDirectories',
  'FS_createStandardStreams',
  'FS_staticInit',
  'FS_init',
  'FS_quit',
  'FS_findObject',
  'FS_analyzePath',
  'FS_createFile',
  'FS_createDataFile',
  'FS_forceLoadFile',
  'FS_createLazyFile',
  'MEMFS',
  'TTY',
  'PIPEFS',
  'SOCKFS',
  'tempFixedLengthArray',
  'miniTempWebGLFloatBuffers',
  'miniTempWebGLIntBuffers',
  'GL',
  'AL',
  'GLUT',
  'EGL',
  'GLEW',
  'IDBStore',
  'SDL',
  'SDL_gfx',
  'print',
  'printErr',
  'jstoi_s',
  'initBindgen',
];
unexportedSymbols.forEach(unexportedRuntimeSymbol);

  // End runtime exports
  // Begin JS library exports
  // End JS library exports

// end include: postlibrary.js

function checkIncomingModuleAPI() {
  ignoredModuleProp('fetchSettings');
  ignoredModuleProp('logReadFiles');
  ignoredModuleProp('loadSplitModule');
  ignoredModuleProp('onMalloc');
  ignoredModuleProp('onRealloc');
  ignoredModuleProp('onFree');
  ignoredModuleProp('onSbrkGrow');
  ignoredModuleProp('onCOSCacheHit');
  ignoredModuleProp('onCOSCacheMiss');
  ignoredModuleProp('onCOSStore');
  ignoredModuleProp('GL_MAX_TEXTURE_IMAGE_UNITS');
  ignoredModuleProp('SDL_canPlayWithWebAudio');
  ignoredModuleProp('SDL_numSimultaneouslyQueuedBuffers');
  ignoredModuleProp('freePreloadedMediaOnUse');
  ignoredModuleProp('preinitializedWebGLContext');
  ignoredModuleProp('keyboardListeningElement');
  ignoredModuleProp('doNotCaptureKeyboard');
  ignoredModuleProp('extraStackTrace');
  ignoredModuleProp('preloadPlugins');
  ignoredModuleProp('preMainLoop');
  ignoredModuleProp('postMainLoop');
  ignoredModuleProp('forcedAspectRatio');
  ignoredModuleProp('mainScriptUrlOrBlob');
  ignoredModuleProp('onFullScreen');
  ignoredModuleProp('INITIAL_MEMORY');
  ignoredModuleProp('wasmMemory');
  ignoredModuleProp('wasmBinary');
}

// Imports from the Wasm binary.
var _wear = Module['_wear'] = makeInvalidEarlyAccess('_wear');
var _get_item = Module['_get_item'] = makeInvalidEarlyAccess('_get_item');
var _rg_addmsg = Module['_rg_addmsg'] = makeInvalidEarlyAccess('_rg_addmsg');
var _endmsg = Module['_endmsg'] = makeInvalidEarlyAccess('_endmsg');
var _rg_msg = Module['_rg_msg'] = makeInvalidEarlyAccess('_rg_msg');
var _spread = Module['_spread'] = makeInvalidEarlyAccess('_spread');
var _do_daemons = Module['_do_daemons'] = makeInvalidEarlyAccess('_do_daemons');
var _do_fuses = Module['_do_fuses'] = makeInvalidEarlyAccess('_do_fuses');
var _rg_core_tick_complete = Module['_rg_core_tick_complete'] = makeInvalidEarlyAccess('_rg_core_tick_complete');
var _inv_name = Module['_inv_name'] = makeInvalidEarlyAccess('_inv_name');
var _take_off = Module['_take_off'] = makeInvalidEarlyAccess('_take_off');
var _dropcheck = Module['_dropcheck'] = makeInvalidEarlyAccess('_dropcheck');
var _waste_time = Module['_waste_time'] = makeInvalidEarlyAccess('_waste_time');
var _runners = Module['_runners'] = makeInvalidEarlyAccess('_runners');
var _do_chase = Module['_do_chase'] = makeInvalidEarlyAccess('_do_chase');
var _move_monst = Module['_move_monst'] = makeInvalidEarlyAccess('_move_monst');
var _dist_cp = Module['_dist_cp'] = makeInvalidEarlyAccess('_dist_cp');
var _rnd = Module['_rnd'] = makeInvalidEarlyAccess('_rnd');
var _sign = Module['_sign'] = makeInvalidEarlyAccess('_sign');
var _fire_bolt = Module['_fire_bolt'] = makeInvalidEarlyAccess('_fire_bolt');
var _chase = Module['_chase'] = makeInvalidEarlyAccess('_chase');
var _attack = Module['_attack'] = makeInvalidEarlyAccess('_attack');
var __detach = Module['__detach'] = makeInvalidEarlyAccess('__detach');
var __attach = Module['__attach'] = makeInvalidEarlyAccess('__attach');
var _find_dest = Module['_find_dest'] = makeInvalidEarlyAccess('_find_dest');
var _relocate = Module['_relocate'] = makeInvalidEarlyAccess('_relocate');
var _mvaddch = Module['_mvaddch'] = makeInvalidEarlyAccess('_mvaddch');
var _mvinch = Module['_mvinch'] = makeInvalidEarlyAccess('_mvinch');
var _move = Module['_move'] = makeInvalidEarlyAccess('_move');
var _see_monst = Module['_see_monst'] = makeInvalidEarlyAccess('_see_monst');
var _addch = Module['_addch'] = makeInvalidEarlyAccess('_addch');
var _standout = Module['_standout'] = makeInvalidEarlyAccess('_standout');
var _standend = Module['_standend'] = makeInvalidEarlyAccess('_standend');
var _roomin = Module['_roomin'] = makeInvalidEarlyAccess('_roomin');
var _set_oldch = Module['_set_oldch'] = makeInvalidEarlyAccess('_set_oldch');
var _step_ok = Module['_step_ok'] = makeInvalidEarlyAccess('_step_ok');
var _rndmove = Module['_rndmove'] = makeInvalidEarlyAccess('_rndmove');
var _dist = Module['_dist'] = makeInvalidEarlyAccess('_dist');
var _runto = Module['_runto'] = makeInvalidEarlyAccess('_runto');
var _diag_ok = Module['_diag_ok'] = makeInvalidEarlyAccess('_diag_ok');
var _cansee = Module['_cansee'] = makeInvalidEarlyAccess('_cansee');
var _command = Module['_command'] = makeInvalidEarlyAccess('_command');
var _rg_core_exit = Module['_rg_core_exit'] = makeInvalidEarlyAccess('_rg_core_exit');
var _look = Module['_look'] = makeInvalidEarlyAccess('_look');
var _status = Module['_status'] = makeInvalidEarlyAccess('_status');
var _refresh = Module['_refresh'] = makeInvalidEarlyAccess('_refresh');
var _readchar = Module['_readchar'] = makeInvalidEarlyAccess('_readchar');
var _pick_up = Module['_pick_up'] = makeInvalidEarlyAccess('_pick_up');
var _shell = Module['_shell'] = makeInvalidEarlyAccess('_shell');
var _do_move = Module['_do_move'] = makeInvalidEarlyAccess('_do_move');
var _do_run = Module['_do_run'] = makeInvalidEarlyAccess('_do_run');
var _get_dir = Module['_get_dir'] = makeInvalidEarlyAccess('_get_dir');
var _rg_ui_line = Module['_rg_ui_line'] = makeInvalidEarlyAccess('_rg_ui_line');
var _missile = Module['_missile'] = makeInvalidEarlyAccess('_missile');
var _rg_ui_clear = Module['_rg_ui_clear'] = makeInvalidEarlyAccess('_rg_ui_clear');
var _quaff = Module['_quaff'] = makeInvalidEarlyAccess('_quaff');
var _quit = Module['_quit'] = makeInvalidEarlyAccess('_quit');
var _rg_inventory_browser = Module['_rg_inventory_browser'] = makeInvalidEarlyAccess('_rg_inventory_browser');
var _picky_inven = Module['_picky_inven'] = makeInvalidEarlyAccess('_picky_inven');
var _drop = Module['_drop'] = makeInvalidEarlyAccess('_drop');
var _read_scroll = Module['_read_scroll'] = makeInvalidEarlyAccess('_read_scroll');
var _eat = Module['_eat'] = makeInvalidEarlyAccess('_eat');
var _wield = Module['_wield'] = makeInvalidEarlyAccess('_wield');
var _ring_on = Module['_ring_on'] = makeInvalidEarlyAccess('_ring_on');
var _ring_off = Module['_ring_off'] = makeInvalidEarlyAccess('_ring_off');
var _option = Module['_option'] = makeInvalidEarlyAccess('_option');
var _call = Module['_call'] = makeInvalidEarlyAccess('_call');
var _new_level = Module['_new_level'] = makeInvalidEarlyAccess('_new_level');
var _u_level = Module['_u_level'] = makeInvalidEarlyAccess('_u_level');
var _help = Module['_help'] = makeInvalidEarlyAccess('_help');
var _identify = Module['_identify'] = makeInvalidEarlyAccess('_identify');
var _search = Module['_search'] = makeInvalidEarlyAccess('_search');
var _do_zap = Module['_do_zap'] = makeInvalidEarlyAccess('_do_zap');
var _discovered = Module['_discovered'] = makeInvalidEarlyAccess('_discovered');
var _clearok = Module['_clearok'] = makeInvalidEarlyAccess('_clearok');
var _wrefresh = Module['_wrefresh'] = makeInvalidEarlyAccess('_wrefresh');
var _save_game = Module['_save_game'] = makeInvalidEarlyAccess('_save_game');
var _current = Module['_current'] = makeInvalidEarlyAccess('_current');
var _unctrl = Module['_unctrl'] = makeInvalidEarlyAccess('_unctrl');
var _teleport = Module['_teleport'] = makeInvalidEarlyAccess('_teleport');
var _rg_semantic_register_term = Module['_rg_semantic_register_term'] = makeInvalidEarlyAccess('_rg_semantic_register_term');
var _illcom = Module['_illcom'] = makeInvalidEarlyAccess('_illcom');
var _rg_command_state_get = Module['_rg_command_state_get'] = makeInvalidEarlyAccess('_rg_command_state_get');
var _rg_command_state_set = Module['_rg_command_state_set'] = makeInvalidEarlyAccess('_rg_command_state_set');
var _wclear = Module['_wclear'] = makeInvalidEarlyAccess('_wclear');
var _wmove = Module['_wmove'] = makeInvalidEarlyAccess('_wmove');
var _waddstr = Module['_waddstr'] = makeInvalidEarlyAccess('_waddstr');
var _rg_wait_for = Module['_rg_wait_for'] = makeInvalidEarlyAccess('_rg_wait_for');
var _touchwin = Module['_touchwin'] = makeInvalidEarlyAccess('_touchwin');
var _d_level = Module['_d_level'] = makeInvalidEarlyAccess('_d_level');
var _total_winner = Module['_total_winner'] = makeInvalidEarlyAccess('_total_winner');
var _levit_check = Module['_levit_check'] = makeInvalidEarlyAccess('_levit_check');
var _get_str = Module['_get_str'] = makeInvalidEarlyAccess('_get_str');
var _free = Module['_free'] = makeInvalidEarlyAccess('_free');
var _strlen = Module['_strlen'] = makeInvalidEarlyAccess('_strlen');
var _malloc = Module['_malloc'] = makeInvalidEarlyAccess('_malloc');
var _d_slot = Module['_d_slot'] = makeInvalidEarlyAccess('_d_slot');
var _find_slot = Module['_find_slot'] = makeInvalidEarlyAccess('_find_slot');
var _start_daemon = Module['_start_daemon'] = makeInvalidEarlyAccess('_start_daemon');
var _kill_daemon = Module['_kill_daemon'] = makeInvalidEarlyAccess('_kill_daemon');
var _turn_see = Module['_turn_see'] = makeInvalidEarlyAccess('_turn_see');
var _land = Module['_land'] = makeInvalidEarlyAccess('_land');
var _visuals = Module['_visuals'] = makeInvalidEarlyAccess('_visuals');
var _come_down = Module['_come_down'] = makeInvalidEarlyAccess('_come_down');
var _nohaste = Module['_nohaste'] = makeInvalidEarlyAccess('_nohaste');
var _sight = Module['_sight'] = makeInvalidEarlyAccess('_sight');
var _unsee = Module['_unsee'] = makeInvalidEarlyAccess('_unsee');
var _unconfuse = Module['_unconfuse'] = makeInvalidEarlyAccess('_unconfuse');
var _rollwand = Module['_rollwand'] = makeInvalidEarlyAccess('_rollwand');
var _swander = Module['_swander'] = makeInvalidEarlyAccess('_swander');
var _stomach = Module['_stomach'] = makeInvalidEarlyAccess('_stomach');
var _doctor = Module['_doctor'] = makeInvalidEarlyAccess('_doctor');
var _rg_core_abort = Module['_rg_core_abort'] = makeInvalidEarlyAccess('_rg_core_abort');
var _fuse = Module['_fuse'] = makeInvalidEarlyAccess('_fuse');
var _lengthen = Module['_lengthen'] = makeInvalidEarlyAccess('_lengthen');
var _extinguish = Module['_extinguish'] = makeInvalidEarlyAccess('_extinguish');
var _roll = Module['_roll'] = makeInvalidEarlyAccess('_roll');
var _wanderer = Module['_wanderer'] = makeInvalidEarlyAccess('_wanderer');
var _choose_str = Module['_choose_str'] = makeInvalidEarlyAccess('_choose_str');
var _enter_room = Module['_enter_room'] = makeInvalidEarlyAccess('_enter_room');
var _death = Module['_death'] = makeInvalidEarlyAccess('_death');
var _ring_eat = Module['_ring_eat'] = makeInvalidEarlyAccess('_ring_eat');
var _rnd_thing = Module['_rnd_thing'] = makeInvalidEarlyAccess('_rnd_thing');
var _fight = Module['_fight'] = makeInvalidEarlyAccess('_fight');
var _set_mname = Module['_set_mname'] = makeInvalidEarlyAccess('_set_mname');
var _roll_em = Module['_roll_em'] = makeInvalidEarlyAccess('_roll_em');
var _hit = Module['_hit'] = makeInvalidEarlyAccess('_hit');
var _pick_color = Module['_pick_color'] = makeInvalidEarlyAccess('_pick_color');
var _killed = Module['_killed'] = makeInvalidEarlyAccess('_killed');
var _miss = Module['_miss'] = makeInvalidEarlyAccess('_miss');
var _rg_semantic_monster = Module['_rg_semantic_monster'] = makeInvalidEarlyAccess('_rg_semantic_monster');
var _inch = Module['_inch'] = makeInvalidEarlyAccess('_inch');
var _thunk = Module['_thunk'] = makeInvalidEarlyAccess('_thunk');
var _rg_semantic_combatant = Module['_rg_semantic_combatant'] = makeInvalidEarlyAccess('_rg_semantic_combatant');
var _rg_semantic_combat_verb = Module['_rg_semantic_combat_verb'] = makeInvalidEarlyAccess('_rg_semantic_combat_verb');
var _fallpos = Module['_fallpos'] = makeInvalidEarlyAccess('_fallpos');
var _new_item = Module['_new_item'] = makeInvalidEarlyAccess('_new_item');
var _save = Module['_save'] = makeInvalidEarlyAccess('_save');
var _remove_mon = Module['_remove_mon'] = makeInvalidEarlyAccess('_remove_mon');
var _check_level = Module['_check_level'] = makeInvalidEarlyAccess('_check_level');
var _flush_type = Module['_flush_type'] = makeInvalidEarlyAccess('_flush_type');
var _bounce = Module['_bounce'] = makeInvalidEarlyAccess('_bounce');
var _rust_armor = Module['_rust_armor'] = makeInvalidEarlyAccess('_rust_armor');
var _chg_str = Module['_chg_str'] = makeInvalidEarlyAccess('_chg_str');
var _is_magic = Module['_is_magic'] = makeInvalidEarlyAccess('_is_magic');
var _leave_pack = Module['_leave_pack'] = makeInvalidEarlyAccess('_leave_pack');
var _discard = Module['_discard'] = makeInvalidEarlyAccess('_discard');
var _fall = Module['_fall'] = makeInvalidEarlyAccess('_fall');
var _swing = Module['_swing'] = makeInvalidEarlyAccess('_swing');
var _prname = Module['_prname'] = makeInvalidEarlyAccess('_prname');
var _init_player = Module['_init_player'] = makeInvalidEarlyAccess('_init_player');
var _add_pack = Module['_add_pack'] = makeInvalidEarlyAccess('_add_pack');
var _init_weapon = Module['_init_weapon'] = makeInvalidEarlyAccess('_init_weapon');
var _init_colors = Module['_init_colors'] = makeInvalidEarlyAccess('_init_colors');
var _init_names = Module['_init_names'] = makeInvalidEarlyAccess('_init_names');
var _init_stones = Module['_init_stones'] = makeInvalidEarlyAccess('_init_stones');
var _init_materials = Module['_init_materials'] = makeInvalidEarlyAccess('_init_materials');
var _sumprobs = Module['_sumprobs'] = makeInvalidEarlyAccess('_sumprobs');
var _init_probs = Module['_init_probs'] = makeInvalidEarlyAccess('_init_probs');
var _clrtoeol = Module['_clrtoeol'] = makeInvalidEarlyAccess('_clrtoeol');
var _rg_message_clear = Module['_rg_message_clear'] = makeInvalidEarlyAccess('_rg_message_clear');
var _rg_message_prepare = Module['_rg_message_prepare'] = makeInvalidEarlyAccess('_rg_message_prepare');
var _rg_message_push = Module['_rg_message_push'] = makeInvalidEarlyAccess('_rg_message_push');
var _mvaddstr = Module['_mvaddstr'] = makeInvalidEarlyAccess('_mvaddstr');
var _rg_host_message_requires_acknowledgement = Module['_rg_host_message_requires_acknowledgement'] = makeInvalidEarlyAccess('_rg_host_message_requires_acknowledgement');
var _md_readchar = Module['_md_readchar'] = makeInvalidEarlyAccess('_md_readchar');
var _rg_message_discard = Module['_rg_message_discard'] = makeInvalidEarlyAccess('_rg_message_discard');
var _rg_message_flush = Module['_rg_message_flush'] = makeInvalidEarlyAccess('_rg_message_flush');
var _rg_semantic_copy = Module['_rg_semantic_copy'] = makeInvalidEarlyAccess('_rg_semantic_copy');
var _rg_message_state_export = Module['_rg_message_state_export'] = makeInvalidEarlyAccess('_rg_message_state_export');
var _rg_message_state_validate = Module['_rg_message_state_validate'] = makeInvalidEarlyAccess('_rg_message_state_validate');
var _rg_message_state_import = Module['_rg_message_state_import'] = makeInvalidEarlyAccess('_rg_message_state_import');
var _rg_status_publish = Module['_rg_status_publish'] = makeInvalidEarlyAccess('_rg_status_publish');
var _printw = Module['_printw'] = makeInvalidEarlyAccess('_printw');
var _rg_status_state_get = Module['_rg_status_state_get'] = makeInvalidEarlyAccess('_rg_status_state_get');
var _rg_status_state_set = Module['_rg_status_state_set'] = makeInvalidEarlyAccess('_rg_status_state_set');
var _wait_for = Module['_wait_for'] = makeInvalidEarlyAccess('_wait_for');
var _show_win = Module['_show_win'] = makeInvalidEarlyAccess('_show_win');
var __free_list = Module['__free_list'] = makeInvalidEarlyAccess('__free_list');
var _init_check = Module['_init_check'] = makeInvalidEarlyAccess('_init_check');
var _open_score = Module['_open_score'] = makeInvalidEarlyAccess('_open_score');
var _setup = Module['_setup'] = makeInvalidEarlyAccess('_setup');
var _getltchars = Module['_getltchars'] = makeInvalidEarlyAccess('_getltchars');
var _resetltchars = Module['_resetltchars'] = makeInvalidEarlyAccess('_resetltchars');
var _playltchars = Module['_playltchars'] = makeInvalidEarlyAccess('_playltchars');
var _start_score = Module['_start_score'] = makeInvalidEarlyAccess('_start_score');
var _is_symlink = Module['_is_symlink'] = makeInvalidEarlyAccess('_is_symlink');
var _too_much = Module['_too_much'] = makeInvalidEarlyAccess('_too_much');
var _author = Module['_author'] = makeInvalidEarlyAccess('_author');
var _lock_sc = Module['_lock_sc'] = makeInvalidEarlyAccess('_lock_sc');
var _unlock_sc = Module['_unlock_sc'] = makeInvalidEarlyAccess('_unlock_sc');
var _rg_knowledge_flush_input = Module['_rg_knowledge_flush_input'] = makeInvalidEarlyAccess('_rg_knowledge_flush_input');
var _endit = Module['_endit'] = makeInvalidEarlyAccess('_endit');
var _endwin = Module['_endwin'] = makeInvalidEarlyAccess('_endwin');
var _fatal = Module['_fatal'] = makeInvalidEarlyAccess('_fatal');
var _my_exit = Module['_my_exit'] = makeInvalidEarlyAccess('_my_exit');
var _rg_random_next = Module['_rg_random_next'] = makeInvalidEarlyAccess('_rg_random_next');
var _tstp = Module['_tstp'] = makeInvalidEarlyAccess('_tstp');
var _playit = Module['_playit'] = makeInvalidEarlyAccess('_playit');
var _baudrate = Module['_baudrate'] = makeInvalidEarlyAccess('_baudrate');
var _md_hasclreol = Module['_md_hasclreol'] = makeInvalidEarlyAccess('_md_hasclreol');
var _rg_core_was_restored = Module['_rg_core_was_restored'] = makeInvalidEarlyAccess('_rg_core_was_restored');
var _rg_host_checkpoint = Module['_rg_host_checkpoint'] = makeInvalidEarlyAccess('_rg_host_checkpoint');
var _rg_core_set_outcome = Module['_rg_core_set_outcome'] = makeInvalidEarlyAccess('_rg_core_set_outcome');
var _leave = Module['_leave'] = makeInvalidEarlyAccess('_leave');
var _clear = Module['_clear'] = makeInvalidEarlyAccess('_clear');
var _mvprintw = Module['_mvprintw'] = makeInvalidEarlyAccess('_mvprintw');
var _rg_capture_arguments = Module['_rg_capture_arguments'] = makeInvalidEarlyAccess('_rg_capture_arguments');
var _score = Module['_score'] = makeInvalidEarlyAccess('_score');
var _isendwin = Module['_isendwin'] = makeInvalidEarlyAccess('_isendwin');
var _mvcur = Module['_mvcur'] = makeInvalidEarlyAccess('_mvcur');
var _rg_console_putchar = Module['_rg_console_putchar'] = makeInvalidEarlyAccess('_rg_console_putchar');
var _md_init = Module['_md_init'] = makeInvalidEarlyAccess('_md_init');
var _md_onsignal_default = Module['_md_onsignal_default'] = makeInvalidEarlyAccess('_md_onsignal_default');
var _md_onsignal_exit = Module['_md_onsignal_exit'] = makeInvalidEarlyAccess('_md_onsignal_exit');
var _md_onsignal_autosave = Module['_md_onsignal_autosave'] = makeInvalidEarlyAccess('_md_onsignal_autosave');
var _md_ignoreallsignals = Module['_md_ignoreallsignals'] = makeInvalidEarlyAccess('_md_ignoreallsignals');
var _md_tstphold = Module['_md_tstphold'] = makeInvalidEarlyAccess('_md_tstphold');
var _md_tstpresume = Module['_md_tstpresume'] = makeInvalidEarlyAccess('_md_tstpresume');
var _md_tstpsignal = Module['_md_tstpsignal'] = makeInvalidEarlyAccess('_md_tstpsignal');
var _md_start_checkout_timer = Module['_md_start_checkout_timer'] = makeInvalidEarlyAccess('_md_start_checkout_timer');
var _md_stop_checkout_timer = Module['_md_stop_checkout_timer'] = makeInvalidEarlyAccess('_md_stop_checkout_timer');
var _md_putchar = Module['_md_putchar'] = makeInvalidEarlyAccess('_md_putchar');
var _md_raw_standout = Module['_md_raw_standout'] = makeInvalidEarlyAccess('_md_raw_standout');
var _md_raw_standend = Module['_md_raw_standend'] = makeInvalidEarlyAccess('_md_raw_standend');
var _md_unlink_open_file = Module['_md_unlink_open_file'] = makeInvalidEarlyAccess('_md_unlink_open_file');
var _md_unlink = Module['_md_unlink'] = makeInvalidEarlyAccess('_md_unlink');
var _md_chmod = Module['_md_chmod'] = makeInvalidEarlyAccess('_md_chmod');
var _md_normaluser = Module['_md_normaluser'] = makeInvalidEarlyAccess('_md_normaluser');
var _md_getuid = Module['_md_getuid'] = makeInvalidEarlyAccess('_md_getuid');
var _md_getpid = Module['_md_getpid'] = makeInvalidEarlyAccess('_md_getpid');
var _md_getusername = Module['_md_getusername'] = makeInvalidEarlyAccess('_md_getusername');
var _rg_core_player_name = Module['_rg_core_player_name'] = makeInvalidEarlyAccess('_rg_core_player_name');
var _md_gethomedir = Module['_md_gethomedir'] = makeInvalidEarlyAccess('_md_gethomedir');
var _md_sleep = Module['_md_sleep'] = makeInvalidEarlyAccess('_md_sleep');
var _md_getshell = Module['_md_getshell'] = makeInvalidEarlyAccess('_md_getshell');
var _md_shellescape = Module['_md_shellescape'] = makeInvalidEarlyAccess('_md_shellescape');
var _md_getrealname = Module['_md_getrealname'] = makeInvalidEarlyAccess('_md_getrealname');
var _md_crypt = Module['_md_crypt'] = makeInvalidEarlyAccess('_md_crypt');
var _md_getpass = Module['_md_getpass'] = makeInvalidEarlyAccess('_md_getpass');
var _wgetnstr = Module['_wgetnstr'] = makeInvalidEarlyAccess('_wgetnstr');
var _md_erasechar = Module['_md_erasechar'] = makeInvalidEarlyAccess('_md_erasechar');
var _erasechar = Module['_erasechar'] = makeInvalidEarlyAccess('_erasechar');
var _md_killchar = Module['_md_killchar'] = makeInvalidEarlyAccess('_md_killchar');
var _killchar = Module['_killchar'] = makeInvalidEarlyAccess('_killchar');
var _md_dsuspchar = Module['_md_dsuspchar'] = makeInvalidEarlyAccess('_md_dsuspchar');
var _md_setdsuspchar = Module['_md_setdsuspchar'] = makeInvalidEarlyAccess('_md_setdsuspchar');
var _md_suspchar = Module['_md_suspchar'] = makeInvalidEarlyAccess('_md_suspchar');
var _md_setsuspchar = Module['_md_setsuspchar'] = makeInvalidEarlyAccess('_md_setsuspchar');
var _getch = Module['_getch'] = makeInvalidEarlyAccess('_getch');
var _md_loadav = Module['_md_loadav'] = makeInvalidEarlyAccess('_md_loadav');
var _md_issymlink = Module['_md_issymlink'] = makeInvalidEarlyAccess('_md_issymlink');
var _erase_lamp = Module['_erase_lamp'] = makeInvalidEarlyAccess('_erase_lamp');
var _wake_monster = Module['_wake_monster'] = makeInvalidEarlyAccess('_wake_monster');
var _trip_ch = Module['_trip_ch'] = makeInvalidEarlyAccess('_trip_ch');
var _show_floor = Module['_show_floor'] = makeInvalidEarlyAccess('_show_floor');
var _find_obj = Module['_find_obj'] = makeInvalidEarlyAccess('_find_obj');
var _add_str = Module['_add_str'] = makeInvalidEarlyAccess('_add_str');
var _add_haste = Module['_add_haste'] = makeInvalidEarlyAccess('_add_haste');
var _aggravate = Module['_aggravate'] = makeInvalidEarlyAccess('_aggravate');
var _vowelstr = Module['_vowelstr'] = makeInvalidEarlyAccess('_vowelstr');
var _is_current = Module['_is_current'] = makeInvalidEarlyAccess('_is_current');
var _reset_last = Module['_reset_last'] = makeInvalidEarlyAccess('_reset_last');
var _rg_direction_state_get = Module['_rg_direction_state_get'] = makeInvalidEarlyAccess('_rg_direction_state_get');
var _rg_direction_state_set = Module['_rg_direction_state_set'] = makeInvalidEarlyAccess('_rg_direction_state_set');
var _call_it = Module['_call_it'] = makeInvalidEarlyAccess('_call_it');
var _randmonster = Module['_randmonster'] = makeInvalidEarlyAccess('_randmonster');
var _new_monster = Module['_new_monster'] = makeInvalidEarlyAccess('_new_monster');
var _exp_add = Module['_exp_add'] = makeInvalidEarlyAccess('_exp_add');
var _find_floor = Module['_find_floor'] = makeInvalidEarlyAccess('_find_floor');
var _give_pack = Module['_give_pack'] = makeInvalidEarlyAccess('_give_pack');
var _new_thing = Module['_new_thing'] = makeInvalidEarlyAccess('_new_thing');
var _save_throw = Module['_save_throw'] = makeInvalidEarlyAccess('_save_throw');
var _leaveok = Module['_leaveok'] = makeInvalidEarlyAccess('_leaveok');
var _be_trapped = Module['_be_trapped'] = makeInvalidEarlyAccess('_be_trapped');
var _floor_at = Module['_floor_at'] = makeInvalidEarlyAccess('_floor_at');
var _leave_room = Module['_leave_room'] = makeInvalidEarlyAccess('_leave_room');
var _turn_ok = Module['_turn_ok'] = makeInvalidEarlyAccess('_turn_ok');
var _turnref = Module['_turnref'] = makeInvalidEarlyAccess('_turnref');
var _door_open = Module['_door_open'] = makeInvalidEarlyAccess('_door_open');
var _do_rooms = Module['_do_rooms'] = makeInvalidEarlyAccess('_do_rooms');
var _do_passages = Module['_do_passages'] = makeInvalidEarlyAccess('_do_passages');
var _put_things = Module['_put_things'] = makeInvalidEarlyAccess('_put_things');
var _rnd_room = Module['_rnd_room'] = makeInvalidEarlyAccess('_rnd_room');
var _treas_room = Module['_treas_room'] = makeInvalidEarlyAccess('_treas_room');
var _put_bool = Module['_put_bool'] = makeInvalidEarlyAccess('_put_bool');
var _get_bool = Module['_get_bool'] = makeInvalidEarlyAccess('_get_bool');
var _waddch = Module['_waddch'] = makeInvalidEarlyAccess('_waddch');
var _get_sf = Module['_get_sf'] = makeInvalidEarlyAccess('_get_sf');
var _put_inv_t = Module['_put_inv_t'] = makeInvalidEarlyAccess('_put_inv_t');
var _get_inv_t = Module['_get_inv_t'] = makeInvalidEarlyAccess('_get_inv_t');
var _mvwprintw = Module['_mvwprintw'] = makeInvalidEarlyAccess('_mvwprintw');
var _put_str = Module['_put_str'] = makeInvalidEarlyAccess('_put_str');
var _rg_ui_printf = Module['_rg_ui_printf'] = makeInvalidEarlyAccess('_rg_ui_printf');
var _rg_host_text_mode = Module['_rg_host_text_mode'] = makeInvalidEarlyAccess('_rg_host_text_mode');
var _strucpy = Module['_strucpy'] = makeInvalidEarlyAccess('_strucpy');
var _wclrtoeol = Module['_wclrtoeol'] = makeInvalidEarlyAccess('_wclrtoeol');
var _rg_host_player_name = Module['_rg_host_player_name'] = makeInvalidEarlyAccess('_rg_host_player_name');
var _wprintw = Module['_wprintw'] = makeInvalidEarlyAccess('_wprintw');
var _pr_optname = Module['_pr_optname'] = makeInvalidEarlyAccess('_pr_optname');
var _parse_opts = Module['_parse_opts'] = makeInvalidEarlyAccess('_parse_opts');
var _pack_room = Module['_pack_room'] = makeInvalidEarlyAccess('_pack_room');
var _rg_semantic_pickup_item = Module['_rg_semantic_pickup_item'] = makeInvalidEarlyAccess('_rg_semantic_pickup_item');
var _move_msg = Module['_move_msg'] = makeInvalidEarlyAccess('_move_msg');
var _pack_char = Module['_pack_char'] = makeInvalidEarlyAccess('_pack_char');
var _inventory = Module['_inventory'] = makeInvalidEarlyAccess('_inventory');
var _add_line = Module['_add_line'] = makeInvalidEarlyAccess('_add_line');
var _end_line = Module['_end_line'] = makeInvalidEarlyAccess('_end_line');
var _money = Module['_money'] = makeInvalidEarlyAccess('_money');
var _rg_host_inventory_browser_enabled = Module['_rg_host_inventory_browser_enabled'] = makeInvalidEarlyAccess('_rg_host_inventory_browser_enabled');
var _floor_ch = Module['_floor_ch'] = makeInvalidEarlyAccess('_floor_ch');
var _conn = Module['_conn'] = makeInvalidEarlyAccess('_conn');
var _numpass = Module['_numpass'] = makeInvalidEarlyAccess('_numpass');
var _door = Module['_door'] = makeInvalidEarlyAccess('_door');
var _putpass = Module['_putpass'] = makeInvalidEarlyAccess('_putpass');
var _passnum = Module['_passnum'] = makeInvalidEarlyAccess('_passnum');
var _do_pot = Module['_do_pot'] = makeInvalidEarlyAccess('_do_pot');
var _seen_stairs = Module['_seen_stairs'] = makeInvalidEarlyAccess('_seen_stairs');
var _invis_on = Module['_invis_on'] = makeInvalidEarlyAccess('_invis_on');
var _rg_semantic_register_message = Module['_rg_semantic_register_message'] = makeInvalidEarlyAccess('_rg_semantic_register_message');
var _raise_level = Module['_raise_level'] = makeInvalidEarlyAccess('_raise_level');
var _gethand = Module['_gethand'] = makeInvalidEarlyAccess('_gethand');
var _ring_num = Module['_ring_num'] = makeInvalidEarlyAccess('_ring_num');
var _num = Module['_num'] = makeInvalidEarlyAccess('_num');
var _rg_console_printf = Module['_rg_console_printf'] = makeInvalidEarlyAccess('_rg_console_printf');
var _delwin = Module['_delwin'] = makeInvalidEarlyAccess('_delwin');
var _rd_score = Module['_rd_score'] = makeInvalidEarlyAccess('_rd_score');
var _rg_semantic_death = Module['_rg_semantic_death'] = makeInvalidEarlyAccess('_rg_semantic_death');
var _wr_score = Module['_wr_score'] = makeInvalidEarlyAccess('_wr_score');
var _rg_message_arguments = Module['_rg_message_arguments'] = makeInvalidEarlyAccess('_rg_message_arguments');
var _killname = Module['_killname'] = makeInvalidEarlyAccess('_killname');
var _addstr = Module['_addstr'] = makeInvalidEarlyAccess('_addstr');
var _fflush = makeInvalidEarlyAccess('_fflush');
var _rg_console_fgets = Module['_rg_console_fgets'] = makeInvalidEarlyAccess('_rg_console_fgets');
var _center = Module['_center'] = makeInvalidEarlyAccess('_center');
var _death_monst = Module['_death_monst'] = makeInvalidEarlyAccess('_death_monst');
var _draw_room = Module['_draw_room'] = makeInvalidEarlyAccess('_draw_room');
var _do_maze = Module['_do_maze'] = makeInvalidEarlyAccess('_do_maze');
var _dig = Module['_dig'] = makeInvalidEarlyAccess('_dig');
var _vert = Module['_vert'] = makeInvalidEarlyAccess('_vert');
var _horiz = Module['_horiz'] = makeInvalidEarlyAccess('_horiz');
var _accnt_maze = Module['_accnt_maze'] = makeInvalidEarlyAccess('_accnt_maze');
var _rnd_pos = Module['_rnd_pos'] = makeInvalidEarlyAccess('_rnd_pos');
var _rg_host_message = Module['_rg_host_message'] = makeInvalidEarlyAccess('_rg_host_message');
var _encwrite = Module['_encwrite'] = makeInvalidEarlyAccess('_encwrite');
var _encread = Module['_encread'] = makeInvalidEarlyAccess('_encread');
var _whatis = Module['_whatis'] = makeInvalidEarlyAccess('_whatis');
var _uncurse = Module['_uncurse'] = makeInvalidEarlyAccess('_uncurse');
var _rs_write = Module['_rs_write'] = makeInvalidEarlyAccess('_rs_write');
var _rs_read = Module['_rs_read'] = makeInvalidEarlyAccess('_rs_read');
var _rs_write_int = Module['_rs_write_int'] = makeInvalidEarlyAccess('_rs_write_int');
var _rs_read_int = Module['_rs_read_int'] = makeInvalidEarlyAccess('_rs_read_int');
var _rs_write_char = Module['_rs_write_char'] = makeInvalidEarlyAccess('_rs_write_char');
var _rs_read_char = Module['_rs_read_char'] = makeInvalidEarlyAccess('_rs_read_char');
var _rs_write_chars = Module['_rs_write_chars'] = makeInvalidEarlyAccess('_rs_write_chars');
var _rs_read_chars = Module['_rs_read_chars'] = makeInvalidEarlyAccess('_rs_read_chars');
var _rs_write_ints = Module['_rs_write_ints'] = makeInvalidEarlyAccess('_rs_write_ints');
var _rs_read_ints = Module['_rs_read_ints'] = makeInvalidEarlyAccess('_rs_read_ints');
var _rs_write_boolean = Module['_rs_write_boolean'] = makeInvalidEarlyAccess('_rs_write_boolean');
var _rs_read_boolean = Module['_rs_read_boolean'] = makeInvalidEarlyAccess('_rs_read_boolean');
var _rs_write_booleans = Module['_rs_write_booleans'] = makeInvalidEarlyAccess('_rs_write_booleans');
var _rs_read_booleans = Module['_rs_read_booleans'] = makeInvalidEarlyAccess('_rs_read_booleans');
var _rs_write_short = Module['_rs_write_short'] = makeInvalidEarlyAccess('_rs_write_short');
var _rs_read_short = Module['_rs_read_short'] = makeInvalidEarlyAccess('_rs_read_short');
var _rs_write_shorts = Module['_rs_write_shorts'] = makeInvalidEarlyAccess('_rs_write_shorts');
var _rs_read_shorts = Module['_rs_read_shorts'] = makeInvalidEarlyAccess('_rs_read_shorts');
var _rs_write_ushort = Module['_rs_write_ushort'] = makeInvalidEarlyAccess('_rs_write_ushort');
var _rs_read_ushort = Module['_rs_read_ushort'] = makeInvalidEarlyAccess('_rs_read_ushort');
var _rs_write_uint = Module['_rs_write_uint'] = makeInvalidEarlyAccess('_rs_write_uint');
var _rs_read_uint = Module['_rs_read_uint'] = makeInvalidEarlyAccess('_rs_read_uint');
var _rs_write_marker = Module['_rs_write_marker'] = makeInvalidEarlyAccess('_rs_write_marker');
var _rs_read_marker = Module['_rs_read_marker'] = makeInvalidEarlyAccess('_rs_read_marker');
var _rs_write_string = Module['_rs_write_string'] = makeInvalidEarlyAccess('_rs_write_string');
var _rs_read_string = Module['_rs_read_string'] = makeInvalidEarlyAccess('_rs_read_string');
var _rs_read_new_string = Module['_rs_read_new_string'] = makeInvalidEarlyAccess('_rs_read_new_string');
var _rs_write_strings = Module['_rs_write_strings'] = makeInvalidEarlyAccess('_rs_write_strings');
var _rs_read_strings = Module['_rs_read_strings'] = makeInvalidEarlyAccess('_rs_read_strings');
var _rs_read_new_strings = Module['_rs_read_new_strings'] = makeInvalidEarlyAccess('_rs_read_new_strings');
var _rs_write_string_index = Module['_rs_write_string_index'] = makeInvalidEarlyAccess('_rs_write_string_index');
var _rs_read_string_index = Module['_rs_read_string_index'] = makeInvalidEarlyAccess('_rs_read_string_index');
var _rs_write_str_t = Module['_rs_write_str_t'] = makeInvalidEarlyAccess('_rs_write_str_t');
var _rs_read_str_t = Module['_rs_read_str_t'] = makeInvalidEarlyAccess('_rs_read_str_t');
var _rs_write_coord = Module['_rs_write_coord'] = makeInvalidEarlyAccess('_rs_write_coord');
var _rs_read_coord = Module['_rs_read_coord'] = makeInvalidEarlyAccess('_rs_read_coord');
var _rs_write_window = Module['_rs_write_window'] = makeInvalidEarlyAccess('_rs_write_window');
var _mvwinch = Module['_mvwinch'] = makeInvalidEarlyAccess('_mvwinch');
var _rs_read_window = Module['_rs_read_window'] = makeInvalidEarlyAccess('_rs_read_window');
var _mvwaddch = Module['_mvwaddch'] = makeInvalidEarlyAccess('_mvwaddch');
var _get_list_item = Module['_get_list_item'] = makeInvalidEarlyAccess('_get_list_item');
var _find_list_ptr = Module['_find_list_ptr'] = makeInvalidEarlyAccess('_find_list_ptr');
var _list_size = Module['_list_size'] = makeInvalidEarlyAccess('_list_size');
var _rs_write_stats = Module['_rs_write_stats'] = makeInvalidEarlyAccess('_rs_write_stats');
var _rs_read_stats = Module['_rs_read_stats'] = makeInvalidEarlyAccess('_rs_read_stats');
var _rs_write_stone_index = Module['_rs_write_stone_index'] = makeInvalidEarlyAccess('_rs_write_stone_index');
var _rs_read_stone_index = Module['_rs_read_stone_index'] = makeInvalidEarlyAccess('_rs_read_stone_index');
var _rs_write_scrolls = Module['_rs_write_scrolls'] = makeInvalidEarlyAccess('_rs_write_scrolls');
var _rs_read_scrolls = Module['_rs_read_scrolls'] = makeInvalidEarlyAccess('_rs_read_scrolls');
var _rs_write_potions = Module['_rs_write_potions'] = makeInvalidEarlyAccess('_rs_write_potions');
var _rs_read_potions = Module['_rs_read_potions'] = makeInvalidEarlyAccess('_rs_read_potions');
var _rs_write_rings = Module['_rs_write_rings'] = makeInvalidEarlyAccess('_rs_write_rings');
var _rs_read_rings = Module['_rs_read_rings'] = makeInvalidEarlyAccess('_rs_read_rings');
var _rs_write_sticks = Module['_rs_write_sticks'] = makeInvalidEarlyAccess('_rs_write_sticks');
var _rs_read_sticks = Module['_rs_read_sticks'] = makeInvalidEarlyAccess('_rs_read_sticks');
var _rs_write_daemons = Module['_rs_write_daemons'] = makeInvalidEarlyAccess('_rs_write_daemons');
var _rs_read_daemons = Module['_rs_read_daemons'] = makeInvalidEarlyAccess('_rs_read_daemons');
var _rs_write_obj_info = Module['_rs_write_obj_info'] = makeInvalidEarlyAccess('_rs_write_obj_info');
var _rs_read_obj_info = Module['_rs_read_obj_info'] = makeInvalidEarlyAccess('_rs_read_obj_info');
var _rs_write_room = Module['_rs_write_room'] = makeInvalidEarlyAccess('_rs_write_room');
var _rs_read_room = Module['_rs_read_room'] = makeInvalidEarlyAccess('_rs_read_room');
var _rs_write_rooms = Module['_rs_write_rooms'] = makeInvalidEarlyAccess('_rs_write_rooms');
var _rs_read_rooms = Module['_rs_read_rooms'] = makeInvalidEarlyAccess('_rs_read_rooms');
var _rs_write_room_reference = Module['_rs_write_room_reference'] = makeInvalidEarlyAccess('_rs_write_room_reference');
var _rs_read_room_reference = Module['_rs_read_room_reference'] = makeInvalidEarlyAccess('_rs_read_room_reference');
var _rs_write_monsters = Module['_rs_write_monsters'] = makeInvalidEarlyAccess('_rs_write_monsters');
var _rs_read_monsters = Module['_rs_read_monsters'] = makeInvalidEarlyAccess('_rs_read_monsters');
var _rs_write_object = Module['_rs_write_object'] = makeInvalidEarlyAccess('_rs_write_object');
var _rs_read_object = Module['_rs_read_object'] = makeInvalidEarlyAccess('_rs_read_object');
var _rs_write_object_list = Module['_rs_write_object_list'] = makeInvalidEarlyAccess('_rs_write_object_list');
var _rs_read_object_list = Module['_rs_read_object_list'] = makeInvalidEarlyAccess('_rs_read_object_list');
var _rs_write_object_reference = Module['_rs_write_object_reference'] = makeInvalidEarlyAccess('_rs_write_object_reference');
var _rs_read_object_reference = Module['_rs_read_object_reference'] = makeInvalidEarlyAccess('_rs_read_object_reference');
var _find_room_coord = Module['_find_room_coord'] = makeInvalidEarlyAccess('_find_room_coord');
var _find_thing_coord = Module['_find_thing_coord'] = makeInvalidEarlyAccess('_find_thing_coord');
var _find_object_coord = Module['_find_object_coord'] = makeInvalidEarlyAccess('_find_object_coord');
var _rs_write_thing = Module['_rs_write_thing'] = makeInvalidEarlyAccess('_rs_write_thing');
var _rs_read_thing = Module['_rs_read_thing'] = makeInvalidEarlyAccess('_rs_read_thing');
var _rs_fix_thing = Module['_rs_fix_thing'] = makeInvalidEarlyAccess('_rs_fix_thing');
var _rs_write_thing_list = Module['_rs_write_thing_list'] = makeInvalidEarlyAccess('_rs_write_thing_list');
var _rs_read_thing_list = Module['_rs_read_thing_list'] = makeInvalidEarlyAccess('_rs_read_thing_list');
var _rs_fix_thing_list = Module['_rs_fix_thing_list'] = makeInvalidEarlyAccess('_rs_fix_thing_list');
var _rs_write_thing_reference = Module['_rs_write_thing_reference'] = makeInvalidEarlyAccess('_rs_write_thing_reference');
var _rs_read_thing_reference = Module['_rs_read_thing_reference'] = makeInvalidEarlyAccess('_rs_read_thing_reference');
var _rs_write_thing_references = Module['_rs_write_thing_references'] = makeInvalidEarlyAccess('_rs_write_thing_references');
var _rs_read_thing_references = Module['_rs_read_thing_references'] = makeInvalidEarlyAccess('_rs_read_thing_references');
var _rs_write_places = Module['_rs_write_places'] = makeInvalidEarlyAccess('_rs_write_places');
var _rs_read_places = Module['_rs_read_places'] = makeInvalidEarlyAccess('_rs_read_places');
var _rs_save_file = Module['_rs_save_file'] = makeInvalidEarlyAccess('_rs_save_file');
var _rs_restore_file = Module['_rs_restore_file'] = makeInvalidEarlyAccess('_rs_restore_file');
var _rg_state_save_bytes = Module['_rg_state_save_bytes'] = makeInvalidEarlyAccess('_rg_state_save_bytes');
var _rg_state_load_bytes = Module['_rg_state_load_bytes'] = makeInvalidEarlyAccess('_rg_state_load_bytes');
var _fix_stick = Module['_fix_stick'] = makeInvalidEarlyAccess('_fix_stick');
var _drain = Module['_drain'] = makeInvalidEarlyAccess('_drain');
var _do_motion = Module['_do_motion'] = makeInvalidEarlyAccess('_do_motion');
var _hit_monster = Module['_hit_monster'] = makeInvalidEarlyAccess('_hit_monster');
var _rg_host_map_effect = Module['_rg_host_map_effect'] = makeInvalidEarlyAccess('_rg_host_map_effect');
var _charge_str = Module['_charge_str'] = makeInvalidEarlyAccess('_charge_str');
var _rg_semantic_item = Module['_rg_semantic_item'] = makeInvalidEarlyAccess('_rg_semantic_item');
var _nameit = Module['_nameit'] = makeInvalidEarlyAccess('_nameit');
var _nullstr = Module['_nullstr'] = makeInvalidEarlyAccess('_nullstr');
var _pick_one = Module['_pick_one'] = makeInvalidEarlyAccess('_pick_one');
var _rg_menu_state_get = Module['_rg_menu_state_get'] = makeInvalidEarlyAccess('_rg_menu_state_get');
var _rg_menu_state_set = Module['_rg_menu_state_set'] = makeInvalidEarlyAccess('_rg_menu_state_set');
var _print_disc = Module['_print_disc'] = makeInvalidEarlyAccess('_print_disc');
var _nothing = Module['_nothing'] = makeInvalidEarlyAccess('_nothing');
var _newwin = Module['_newwin'] = makeInvalidEarlyAccess('_newwin');
var _subwin = Module['_subwin'] = makeInvalidEarlyAccess('_subwin');
var _mvwin = Module['_mvwin'] = makeInvalidEarlyAccess('_mvwin');
var _werase = Module['_werase'] = makeInvalidEarlyAccess('_werase');
var _set_order = Module['_set_order'] = makeInvalidEarlyAccess('_set_order');
var _type_name = Module['_type_name'] = makeInvalidEarlyAccess('_type_name');
var _set_know = Module['_set_know'] = makeInvalidEarlyAccess('_set_know');
var _xntohl = Module['_xntohl'] = makeInvalidEarlyAccess('_xntohl');
var _xhtonl = Module['_xhtonl'] = makeInvalidEarlyAccess('_xhtonl');
var _xcrypt = Module['_xcrypt'] = makeInvalidEarlyAccess('_xcrypt');
var _rg_core_turn = Module['_rg_core_turn'] = makeInvalidEarlyAccess('_rg_core_turn');
var _rg_core_set_turn = Module['_rg_core_set_turn'] = makeInvalidEarlyAccess('_rg_core_set_turn');
var _rg_core_pending = Module['_rg_core_pending'] = makeInvalidEarlyAccess('_rg_core_pending');
var _rg_knowledge_present = Module['_rg_knowledge_present'] = makeInvalidEarlyAccess('_rg_knowledge_present');
var _rg_host_outcome = Module['_rg_host_outcome'] = makeInvalidEarlyAccess('_rg_host_outcome');
var _rg_core_start = Module['_rg_core_start'] = makeInvalidEarlyAccess('_rg_core_start');
var _initscr = Module['_initscr'] = makeInvalidEarlyAccess('_initscr');
var _rg_host_restore_data = Module['_rg_host_restore_data'] = makeInvalidEarlyAccess('_rg_host_restore_data');
var _rg_core_load_bytes = Module['_rg_core_load_bytes'] = makeInvalidEarlyAccess('_rg_core_load_bytes');
var _rg_core_runtime_export = Module['_rg_core_runtime_export'] = makeInvalidEarlyAccess('_rg_core_runtime_export');
var _rg_core_runtime_validate = Module['_rg_core_runtime_validate'] = makeInvalidEarlyAccess('_rg_core_runtime_validate');
var _rg_core_runtime_import = Module['_rg_core_runtime_import'] = makeInvalidEarlyAccess('_rg_core_runtime_import');
var _rg_core_inspect = Module['_rg_core_inspect'] = makeInvalidEarlyAccess('_rg_core_inspect');
var _rg_knowledge_cells = Module['_rg_knowledge_cells'] = makeInvalidEarlyAccess('_rg_knowledge_cells');
var _rg_console_getchar = Module['_rg_console_getchar'] = makeInvalidEarlyAccess('_rg_console_getchar');
var _erase = Module['_erase'] = makeInvalidEarlyAccess('_erase');
var _mvwaddstr = Module['_mvwaddstr'] = makeInvalidEarlyAccess('_mvwaddstr');
var _winch = Module['_winch'] = makeInvalidEarlyAccess('_winch');
var _wstandout = Module['_wstandout'] = makeInvalidEarlyAccess('_wstandout');
var _wstandend = Module['_wstandend'] = makeInvalidEarlyAccess('_wstandend');
var _rg_knowledge_view = Module['_rg_knowledge_view'] = makeInvalidEarlyAccess('_rg_knowledge_view');
var _rg_semantic_map_terrain = Module['_rg_semantic_map_terrain'] = makeInvalidEarlyAccess('_rg_semantic_map_terrain');
var _rg_host_present = Module['_rg_host_present'] = makeInvalidEarlyAccess('_rg_host_present');
var _idlok = Module['_idlok'] = makeInvalidEarlyAccess('_idlok');
var _keypad = Module['_keypad'] = makeInvalidEarlyAccess('_keypad');
var _raw = Module['_raw'] = makeInvalidEarlyAccess('_raw');
var _noecho = Module['_noecho'] = makeInvalidEarlyAccess('_noecho');
var _rg_host_read_key = Module['_rg_host_read_key'] = makeInvalidEarlyAccess('_rg_host_read_key');
var _wgetch = Module['_wgetch'] = makeInvalidEarlyAccess('_wgetch');
var _rg_host_flush_input = Module['_rg_host_flush_input'] = makeInvalidEarlyAccess('_rg_host_flush_input');
var _rg_knowledge_export = Module['_rg_knowledge_export'] = makeInvalidEarlyAccess('_rg_knowledge_export');
var _rg_knowledge_validate = Module['_rg_knowledge_validate'] = makeInvalidEarlyAccess('_rg_knowledge_validate');
var _rg_knowledge_import = Module['_rg_knowledge_import'] = makeInvalidEarlyAccess('_rg_knowledge_import');
var _rg_semantic_argument = Module['_rg_semantic_argument'] = makeInvalidEarlyAccess('_rg_semantic_argument');
var ___trunctfdf2 = Module['___trunctfdf2'] = makeInvalidEarlyAccess('___trunctfdf2');
var _rg_host_ui = Module['_rg_host_ui'] = makeInvalidEarlyAccess('_rg_host_ui');
var _rg_core_save_bytes = Module['_rg_core_save_bytes'] = makeInvalidEarlyAccess('_rg_core_save_bytes');
var _rg_core_save_free = Module['_rg_core_save_free'] = makeInvalidEarlyAccess('_rg_core_save_free');
var _rg_host_map_terrain = Module['_rg_host_map_terrain'] = makeInvalidEarlyAccess('_rg_host_map_terrain');
var _rg_semantic_category = Module['_rg_semantic_category'] = makeInvalidEarlyAccess('_rg_semantic_category');
var _memcmp = makeInvalidEarlyAccess('_memcmp');
var _rg_run = Module['_rg_run'] = makeInvalidEarlyAccess('_rg_run');
var _rg_snapshot_json = Module['_rg_snapshot_json'] = makeInvalidEarlyAccess('_rg_snapshot_json');
var _rg_string_free = Module['_rg_string_free'] = makeInvalidEarlyAccess('_rg_string_free');
var _rg_validate_envelope = Module['_rg_validate_envelope'] = makeInvalidEarlyAccess('_rg_validate_envelope');
var ___lshrti3 = Module['___lshrti3'] = makeInvalidEarlyAccess('___lshrti3');
var ___multi3 = Module['___multi3'] = makeInvalidEarlyAccess('___multi3');
var ___powidf2 = Module['___powidf2'] = makeInvalidEarlyAccess('___powidf2');
var _round = Module['_round'] = makeInvalidEarlyAccess('_round');
var ___ashlti3 = Module['___ashlti3'] = makeInvalidEarlyAccess('___ashlti3');
var ___udivti3 = Module['___udivti3'] = makeInvalidEarlyAccess('___udivti3');
var ___divti3 = Module['___divti3'] = makeInvalidEarlyAccess('___divti3');
var _fmod = Module['_fmod'] = makeInvalidEarlyAccess('_fmod');
var _fmodf = Module['_fmodf'] = makeInvalidEarlyAccess('_fmodf');
var ___modti3 = Module['___modti3'] = makeInvalidEarlyAccess('___modti3');
var ___umodti3 = Module['___umodti3'] = makeInvalidEarlyAccess('___umodti3');
var _rust_eh_personality = Module['_rust_eh_personality'] = makeInvalidEarlyAccess('_rust_eh_personality');
var ___truncsfhf2 = Module['___truncsfhf2'] = makeInvalidEarlyAccess('___truncsfhf2');
var ___extendhfsf2 = Module['___extendhfsf2'] = makeInvalidEarlyAccess('___extendhfsf2');
var ___muloti4 = Module['___muloti4'] = makeInvalidEarlyAccess('___muloti4');
var _fmaf128 = Module['_fmaf128'] = makeInvalidEarlyAccess('_fmaf128');
var _sqrtf128 = Module['_sqrtf128'] = makeInvalidEarlyAccess('_sqrtf128');
var _sqrtf16 = Module['_sqrtf16'] = makeInvalidEarlyAccess('_sqrtf16');
var _fmodf128 = Module['_fmodf128'] = makeInvalidEarlyAccess('_fmodf128');
var _fmodf16 = Module['_fmodf16'] = makeInvalidEarlyAccess('_fmodf16');
var _ceilf128 = Module['_ceilf128'] = makeInvalidEarlyAccess('_ceilf128');
var _ceilf16 = Module['_ceilf16'] = makeInvalidEarlyAccess('_ceilf16');
var _floorf128 = Module['_floorf128'] = makeInvalidEarlyAccess('_floorf128');
var _floorf16 = Module['_floorf16'] = makeInvalidEarlyAccess('_floorf16');
var _roundf16 = Module['_roundf16'] = makeInvalidEarlyAccess('_roundf16');
var _roundf128 = Module['_roundf128'] = makeInvalidEarlyAccess('_roundf128');
var _rintf128 = Module['_rintf128'] = makeInvalidEarlyAccess('_rintf128');
var _roundevenf128 = Module['_roundevenf128'] = makeInvalidEarlyAccess('_roundevenf128');
var _rintf16 = Module['_rintf16'] = makeInvalidEarlyAccess('_rintf16');
var _roundevenf16 = Module['_roundevenf16'] = makeInvalidEarlyAccess('_roundevenf16');
var _truncf128 = Module['_truncf128'] = makeInvalidEarlyAccess('_truncf128');
var _truncf16 = Module['_truncf16'] = makeInvalidEarlyAccess('_truncf16');
var _fmaximum_numf16 = Module['_fmaximum_numf16'] = makeInvalidEarlyAccess('_fmaximum_numf16');
var _fminimum_numf128 = Module['_fminimum_numf128'] = makeInvalidEarlyAccess('_fminimum_numf128');
var _fmaximum_numf128 = Module['_fmaximum_numf128'] = makeInvalidEarlyAccess('_fmaximum_numf128');
var _fminimum_numf16 = Module['_fminimum_numf16'] = makeInvalidEarlyAccess('_fminimum_numf16');
var _fminimumf128 = Module['_fminimumf128'] = makeInvalidEarlyAccess('_fminimumf128');
var _fminimumf16 = Module['_fminimumf16'] = makeInvalidEarlyAccess('_fminimumf16');
var _fmaximumf128 = Module['_fmaximumf128'] = makeInvalidEarlyAccess('_fmaximumf128');
var _fmaximumf16 = Module['_fmaximumf16'] = makeInvalidEarlyAccess('_fmaximumf16');
var _copysignf16 = Module['_copysignf16'] = makeInvalidEarlyAccess('_copysignf16');
var _copysignf128 = Module['_copysignf128'] = makeInvalidEarlyAccess('_copysignf128');
var _fmaxf128 = Module['_fmaxf128'] = makeInvalidEarlyAccess('_fmaxf128');
var _fminf16 = Module['_fminf16'] = makeInvalidEarlyAccess('_fminf16');
var _fminf128 = Module['_fminf128'] = makeInvalidEarlyAccess('_fminf128');
var _fmaxf16 = Module['_fmaxf16'] = makeInvalidEarlyAccess('_fmaxf16');
var ___floatunsitf = Module['___floatunsitf'] = makeInvalidEarlyAccess('___floatunsitf');
var ___floatunsidf = Module['___floatunsidf'] = makeInvalidEarlyAccess('___floatunsidf');
var ___floatunditf = Module['___floatunditf'] = makeInvalidEarlyAccess('___floatunditf');
var ___eqtf2 = Module['___eqtf2'] = makeInvalidEarlyAccess('___eqtf2');
var ___gehf2 = Module['___gehf2'] = makeInvalidEarlyAccess('___gehf2');
var ___eqhf2 = Module['___eqhf2'] = makeInvalidEarlyAccess('___eqhf2');
var ___nehf2 = Module['___nehf2'] = makeInvalidEarlyAccess('___nehf2');
var ___netf2 = Module['___netf2'] = makeInvalidEarlyAccess('___netf2');
var ___lthf2 = Module['___lthf2'] = makeInvalidEarlyAccess('___lthf2');
var ___lttf2 = Module['___lttf2'] = makeInvalidEarlyAccess('___lttf2');
var ___lehf2 = Module['___lehf2'] = makeInvalidEarlyAccess('___lehf2');
var ___letf2 = Module['___letf2'] = makeInvalidEarlyAccess('___letf2');
var ___gttf2 = Module['___gttf2'] = makeInvalidEarlyAccess('___gttf2');
var ___gthf2 = Module['___gthf2'] = makeInvalidEarlyAccess('___gthf2');
var ___getf2 = Module['___getf2'] = makeInvalidEarlyAccess('___getf2');
var _fdimf = Module['_fdimf'] = makeInvalidEarlyAccess('_fdimf');
var _fdimf16 = Module['_fdimf16'] = makeInvalidEarlyAccess('_fdimf16');
var _fdim = Module['_fdim'] = makeInvalidEarlyAccess('_fdim');
var _fdimf128 = Module['_fdimf128'] = makeInvalidEarlyAccess('_fdimf128');
var ___subtf3 = Module['___subtf3'] = makeInvalidEarlyAccess('___subtf3');
var ___subhf3 = Module['___subhf3'] = makeInvalidEarlyAccess('___subhf3');
var _fabsf16 = Module['_fabsf16'] = makeInvalidEarlyAccess('_fabsf16');
var _fabsf128 = Module['_fabsf128'] = makeInvalidEarlyAccess('_fabsf128');
var ___unordtf2 = Module['___unordtf2'] = makeInvalidEarlyAccess('___unordtf2');
var ___unordhf2 = Module['___unordhf2'] = makeInvalidEarlyAccess('___unordhf2');
var ___floatuntitf = Module['___floatuntitf'] = makeInvalidEarlyAccess('___floatuntitf');
var ___fixunstfdi = Module['___fixunstfdi'] = makeInvalidEarlyAccess('___fixunstfdi');
var ___fixunstfti = Module['___fixunstfti'] = makeInvalidEarlyAccess('___fixunstfti');
var ___fixunstfsi = Module['___fixunstfsi'] = makeInvalidEarlyAccess('___fixunstfsi');
var ___udivmodsi4 = Module['___udivmodsi4'] = makeInvalidEarlyAccess('___udivmodsi4');
var ___eqdf2 = Module['___eqdf2'] = makeInvalidEarlyAccess('___eqdf2');
var _trunc = Module['_trunc'] = makeInvalidEarlyAccess('_trunc');
var ___divtf3 = Module['___divtf3'] = makeInvalidEarlyAccess('___divtf3');
var ___truncdfsf2 = Module['___truncdfsf2'] = makeInvalidEarlyAccess('___truncdfsf2');
var _truncf = Module['_truncf'] = makeInvalidEarlyAccess('_truncf');
var ___umodsi3 = Module['___umodsi3'] = makeInvalidEarlyAccess('___umodsi3');
var ___truncdfhf2 = Module['___truncdfhf2'] = makeInvalidEarlyAccess('___truncdfhf2');
var ___fixunsdfti = Module['___fixunsdfti'] = makeInvalidEarlyAccess('___fixunsdfti');
var ___trunctfhf2 = Module['___trunctfhf2'] = makeInvalidEarlyAccess('___trunctfhf2');
var ___floattitf = Module['___floattitf'] = makeInvalidEarlyAccess('___floattitf');
var ___gedf2 = Module['___gedf2'] = makeInvalidEarlyAccess('___gedf2');
var ___divmoddi4 = Module['___divmoddi4'] = makeInvalidEarlyAccess('___divmoddi4');
var _fmaximum_numf = Module['_fmaximum_numf'] = makeInvalidEarlyAccess('_fmaximum_numf');
var _cbrt = Module['_cbrt'] = makeInvalidEarlyAccess('_cbrt');
var ___moddi3 = Module['___moddi3'] = makeInvalidEarlyAccess('___moddi3');
var ___lshrdi3 = Module['___lshrdi3'] = makeInvalidEarlyAccess('___lshrdi3');
var ___fixdfdi = Module['___fixdfdi'] = makeInvalidEarlyAccess('___fixdfdi');
var ___subdf3 = Module['___subdf3'] = makeInvalidEarlyAccess('___subdf3');
var ___fixunssfdi = Module['___fixunssfdi'] = makeInvalidEarlyAccess('___fixunssfdi');
var _floor = Module['_floor'] = makeInvalidEarlyAccess('_floor');
var ___fixunsdfdi = Module['___fixunsdfdi'] = makeInvalidEarlyAccess('___fixunsdfdi');
var ___rust_i128_add = Module['___rust_i128_add'] = makeInvalidEarlyAccess('___rust_i128_add');
var ___floatuntisf = Module['___floatuntisf'] = makeInvalidEarlyAccess('___floatuntisf');
var ___extendhftf2 = Module['___extendhftf2'] = makeInvalidEarlyAccess('___extendhftf2');
var ___divmodsi4 = Module['___divmodsi4'] = makeInvalidEarlyAccess('___divmodsi4');
var _fmaximum_num = Module['_fmaximum_num'] = makeInvalidEarlyAccess('_fmaximum_num');
var ___ashrdi3 = Module['___ashrdi3'] = makeInvalidEarlyAccess('___ashrdi3');
var ___mulsf3 = Module['___mulsf3'] = makeInvalidEarlyAccess('___mulsf3');
var _fmaximum = Module['_fmaximum'] = makeInvalidEarlyAccess('_fmaximum');
var ___addsf3 = Module['___addsf3'] = makeInvalidEarlyAccess('___addsf3');
var _rint = Module['_rint'] = makeInvalidEarlyAccess('_rint');
var ___udivdi3 = Module['___udivdi3'] = makeInvalidEarlyAccess('___udivdi3');
var ___ashrti3 = Module['___ashrti3'] = makeInvalidEarlyAccess('___ashrti3');
var _memset = Module['_memset'] = makeInvalidEarlyAccess('_memset');
var _cbrtf = Module['_cbrtf'] = makeInvalidEarlyAccess('_cbrtf');
var ___mulodi4 = Module['___mulodi4'] = makeInvalidEarlyAccess('___mulodi4');
var ___fixunsdfsi = Module['___fixunsdfsi'] = makeInvalidEarlyAccess('___fixunsdfsi');
var ___divdi3 = Module['___divdi3'] = makeInvalidEarlyAccess('___divdi3');
var ___fixtfti = Module['___fixtfti'] = makeInvalidEarlyAccess('___fixtfti');
var ___rust_u128_addo = Module['___rust_u128_addo'] = makeInvalidEarlyAccess('___rust_u128_addo');
var ___extendhfdf2 = Module['___extendhfdf2'] = makeInvalidEarlyAccess('___extendhfdf2');
var ___trunctfsf2 = Module['___trunctfsf2'] = makeInvalidEarlyAccess('___trunctfsf2');
var _fminimum_numf = Module['_fminimum_numf'] = makeInvalidEarlyAccess('_fminimum_numf');
var _fminimum = Module['_fminimum'] = makeInvalidEarlyAccess('_fminimum');
var ___adddf3 = Module['___adddf3'] = makeInvalidEarlyAccess('___adddf3');
var ___fixsfdi = Module['___fixsfdi'] = makeInvalidEarlyAccess('___fixsfdi');
var ___rust_i128_sub = Module['___rust_i128_sub'] = makeInvalidEarlyAccess('___rust_i128_sub');
var ___floatsitf = Module['___floatsitf'] = makeInvalidEarlyAccess('___floatsitf');
var ___fixunssfti = Module['___fixunssfti'] = makeInvalidEarlyAccess('___fixunssfti');
var _sqrt = Module['_sqrt'] = makeInvalidEarlyAccess('_sqrt');
var ___bswapsi2 = Module['___bswapsi2'] = makeInvalidEarlyAccess('___bswapsi2');
var ___clzti2 = Module['___clzti2'] = makeInvalidEarlyAccess('___clzti2');
var ___gesf2 = Module['___gesf2'] = makeInvalidEarlyAccess('___gesf2');
var ___floatditf = Module['___floatditf'] = makeInvalidEarlyAccess('___floatditf');
var _fmin = Module['_fmin'] = makeInvalidEarlyAccess('_fmin');
var _fmax = Module['_fmax'] = makeInvalidEarlyAccess('_fmax');
var ___ltdf2 = Module['___ltdf2'] = makeInvalidEarlyAccess('___ltdf2');
var ___nesf2 = Module['___nesf2'] = makeInvalidEarlyAccess('___nesf2');
var ___ashlsi3 = Module['___ashlsi3'] = makeInvalidEarlyAccess('___ashlsi3');
var _ceil = Module['_ceil'] = makeInvalidEarlyAccess('_ceil');
var _sqrtf = Module['_sqrtf'] = makeInvalidEarlyAccess('_sqrtf');
var ___addhf3 = Module['___addhf3'] = makeInvalidEarlyAccess('___addhf3');
var _fminimumf = Module['_fminimumf'] = makeInvalidEarlyAccess('_fminimumf');
var ___ashrsi3 = Module['___ashrsi3'] = makeInvalidEarlyAccess('___ashrsi3');
var _fabsf = Module['_fabsf'] = makeInvalidEarlyAccess('_fabsf');
var ___floatdidf = Module['___floatdidf'] = makeInvalidEarlyAccess('___floatdidf');
var ___gtdf2 = Module['___gtdf2'] = makeInvalidEarlyAccess('___gtdf2');
var ___multf3 = Module['___multf3'] = makeInvalidEarlyAccess('___multf3');
var ___addtf3 = Module['___addtf3'] = makeInvalidEarlyAccess('___addtf3');
var ___fixsfti = Module['___fixsfti'] = makeInvalidEarlyAccess('___fixsfti');
var ___ctzti2 = Module['___ctzti2'] = makeInvalidEarlyAccess('___ctzti2');
var ___subsf3 = Module['___subsf3'] = makeInvalidEarlyAccess('___subsf3');
var ___floatdisf = Module['___floatdisf'] = makeInvalidEarlyAccess('___floatdisf');
var _fminf = Module['_fminf'] = makeInvalidEarlyAccess('_fminf');
var ___udivsi3 = Module['___udivsi3'] = makeInvalidEarlyAccess('___udivsi3');
var ___mulhf3 = Module['___mulhf3'] = makeInvalidEarlyAccess('___mulhf3');
var ___muldi3 = Module['___muldi3'] = makeInvalidEarlyAccess('___muldi3');
var ___extendsftf2 = Module['___extendsftf2'] = makeInvalidEarlyAccess('___extendsftf2');
var ___eqsf2 = Module['___eqsf2'] = makeInvalidEarlyAccess('___eqsf2');
var ___mulosi4 = Module['___mulosi4'] = makeInvalidEarlyAccess('___mulosi4');
var _bcmp = Module['_bcmp'] = makeInvalidEarlyAccess('_bcmp');
var ___rust_u128_subo = Module['___rust_u128_subo'] = makeInvalidEarlyAccess('___rust_u128_subo');
var ___floatsisf = Module['___floatsisf'] = makeInvalidEarlyAccess('___floatsisf');
var ___powitf2 = Module['___powitf2'] = makeInvalidEarlyAccess('___powitf2');
var ___umoddi3 = Module['___umoddi3'] = makeInvalidEarlyAccess('___umoddi3');
var ___fixtfsi = Module['___fixtfsi'] = makeInvalidEarlyAccess('___fixtfsi');
var ___rust_u128_add = Module['___rust_u128_add'] = makeInvalidEarlyAccess('___rust_u128_add');
var _fminimum_num = Module['_fminimum_num'] = makeInvalidEarlyAccess('_fminimum_num');
var ___divmodti4 = Module['___divmodti4'] = makeInvalidEarlyAccess('___divmodti4');
var ___lesf2 = Module['___lesf2'] = makeInvalidEarlyAccess('___lesf2');
var _memmove = Module['_memmove'] = makeInvalidEarlyAccess('_memmove');
var ___fixdfti = Module['___fixdfti'] = makeInvalidEarlyAccess('___fixdfti');
var ___udivmoddi4 = Module['___udivmoddi4'] = makeInvalidEarlyAccess('___udivmoddi4');
var ___floatunsisf = Module['___floatunsisf'] = makeInvalidEarlyAccess('___floatunsisf');
var ___unordsf2 = Module['___unordsf2'] = makeInvalidEarlyAccess('___unordsf2');
var ___rust_u128_mulo = Module['___rust_u128_mulo'] = makeInvalidEarlyAccess('___rust_u128_mulo');
var _fma = Module['_fma'] = makeInvalidEarlyAccess('_fma');
var _rintf = Module['_rintf'] = makeInvalidEarlyAccess('_rintf');
var _copysignf = Module['_copysignf'] = makeInvalidEarlyAccess('_copysignf');
var ___divsf3 = Module['___divsf3'] = makeInvalidEarlyAccess('___divsf3');
var ___ashldi3 = Module['___ashldi3'] = makeInvalidEarlyAccess('___ashldi3');
var _fmaxf = Module['_fmaxf'] = makeInvalidEarlyAccess('_fmaxf');
var ___gnu_f2h_ieee = Module['___gnu_f2h_ieee'] = makeInvalidEarlyAccess('___gnu_f2h_ieee');
var ___fixsfsi = Module['___fixsfsi'] = makeInvalidEarlyAccess('___fixsfsi');
var ___muldf3 = Module['___muldf3'] = makeInvalidEarlyAccess('___muldf3');
var ___fixunssfsi = Module['___fixunssfsi'] = makeInvalidEarlyAccess('___fixunssfsi');
var _memcpy = makeInvalidEarlyAccess('_memcpy');
var ___fixtfdi = Module['___fixtfdi'] = makeInvalidEarlyAccess('___fixtfdi');
var _ceilf = Module['_ceilf'] = makeInvalidEarlyAccess('_ceilf');
var ___extenddftf2 = Module['___extenddftf2'] = makeInvalidEarlyAccess('___extenddftf2');
var ___ctzdi2 = Module['___ctzdi2'] = makeInvalidEarlyAccess('___ctzdi2');
var ___ledf2 = Module['___ledf2'] = makeInvalidEarlyAccess('___ledf2');
var ___lshrsi3 = Module['___lshrsi3'] = makeInvalidEarlyAccess('___lshrsi3');
var ___clzsi2 = Module['___clzsi2'] = makeInvalidEarlyAccess('___clzsi2');
var ___rust_u128_sub = Module['___rust_u128_sub'] = makeInvalidEarlyAccess('___rust_u128_sub');
var ___floattidf = Module['___floattidf'] = makeInvalidEarlyAccess('___floattidf');
var _fmaf = Module['_fmaf'] = makeInvalidEarlyAccess('_fmaf');
var ___extendsfdf2 = Module['___extendsfdf2'] = makeInvalidEarlyAccess('___extendsfdf2');
var ___floatuntidf = Module['___floatuntidf'] = makeInvalidEarlyAccess('___floatuntidf');
var ___nedf2 = Module['___nedf2'] = makeInvalidEarlyAccess('___nedf2');
var ___ltsf2 = Module['___ltsf2'] = makeInvalidEarlyAccess('___ltsf2');
var ___rust_i128_mulo = Module['___rust_i128_mulo'] = makeInvalidEarlyAccess('___rust_i128_mulo');
var _floorf = Module['_floorf'] = makeInvalidEarlyAccess('_floorf');
var ___fixdfsi = Module['___fixdfsi'] = makeInvalidEarlyAccess('___fixdfsi');
var ___floatsidf = Module['___floatsidf'] = makeInvalidEarlyAccess('___floatsidf');
var ___modsi3 = Module['___modsi3'] = makeInvalidEarlyAccess('___modsi3');
var ___powisf2 = Module['___powisf2'] = makeInvalidEarlyAccess('___powisf2');
var ___divsi3 = Module['___divsi3'] = makeInvalidEarlyAccess('___divsi3');
var _roundf = Module['_roundf'] = makeInvalidEarlyAccess('_roundf');
var ___divdf3 = Module['___divdf3'] = makeInvalidEarlyAccess('___divdf3');
var ___floatundisf = Module['___floatundisf'] = makeInvalidEarlyAccess('___floatundisf');
var _fabs = Module['_fabs'] = makeInvalidEarlyAccess('_fabs');
var ___rust_i128_subo = Module['___rust_i128_subo'] = makeInvalidEarlyAccess('___rust_i128_subo');
var _fmaximumf = Module['_fmaximumf'] = makeInvalidEarlyAccess('_fmaximumf');
var ___floattisf = Module['___floattisf'] = makeInvalidEarlyAccess('___floattisf');
var ___ctzsi2 = Module['___ctzsi2'] = makeInvalidEarlyAccess('___ctzsi2');
var _roundeven = Module['_roundeven'] = makeInvalidEarlyAccess('_roundeven');
var ___gtsf2 = Module['___gtsf2'] = makeInvalidEarlyAccess('___gtsf2');
var ___rust_i128_addo = Module['___rust_i128_addo'] = makeInvalidEarlyAccess('___rust_i128_addo');
var _roundevenf = Module['_roundevenf'] = makeInvalidEarlyAccess('_roundevenf');
var ___floatundidf = Module['___floatundidf'] = makeInvalidEarlyAccess('___floatundidf');
var ___bswapdi2 = Module['___bswapdi2'] = makeInvalidEarlyAccess('___bswapdi2');
var ___clzdi2 = Module['___clzdi2'] = makeInvalidEarlyAccess('___clzdi2');
var ___gnu_h2f_ieee = Module['___gnu_h2f_ieee'] = makeInvalidEarlyAccess('___gnu_h2f_ieee');
var ___unorddf2 = Module['___unorddf2'] = makeInvalidEarlyAccess('___unorddf2');
var ___bswapti2 = Module['___bswapti2'] = makeInvalidEarlyAccess('___bswapti2');
var ___udivmodti4 = Module['___udivmodti4'] = makeInvalidEarlyAccess('___udivmodti4');
var _copysign = Module['_copysign'] = makeInvalidEarlyAccess('_copysign');
var _emscripten_stack_get_end = makeInvalidEarlyAccess('_emscripten_stack_get_end');
var _emscripten_stack_get_base = makeInvalidEarlyAccess('_emscripten_stack_get_base');
var _htonl = makeInvalidEarlyAccess('_htonl');
var _htons = makeInvalidEarlyAccess('_htons');
var _ntohs = makeInvalidEarlyAccess('_ntohs');
var __emscripten_timeout = makeInvalidEarlyAccess('__emscripten_timeout');
var _strerror = makeInvalidEarlyAccess('_strerror');
var _setThrew = makeInvalidEarlyAccess('_setThrew');
var _emscripten_stack_init = makeInvalidEarlyAccess('_emscripten_stack_init');
var _emscripten_stack_get_free = makeInvalidEarlyAccess('_emscripten_stack_get_free');
var __emscripten_stack_restore = makeInvalidEarlyAccess('__emscripten_stack_restore');
var __emscripten_stack_alloc = makeInvalidEarlyAccess('__emscripten_stack_alloc');
var _emscripten_stack_get_current = makeInvalidEarlyAccess('_emscripten_stack_get_current');
var ___wbindgen_start = Module['___wbindgen_start'] = makeInvalidEarlyAccess('___wbindgen_start');
var memory = makeInvalidEarlyAccess('memory');
var _release = Module['_release'] = makeInvalidEarlyAccess('_release');
var _encstr = Module['_encstr'] = makeInvalidEarlyAccess('_encstr');
var _statlist = Module['_statlist'] = makeInvalidEarlyAccess('_statlist');
var _version = Module['_version'] = makeInvalidEarlyAccess('_version');
var _amulet = Module['_amulet'] = makeInvalidEarlyAccess('_amulet');
var _door_stop = Module['_door_stop'] = makeInvalidEarlyAccess('_door_stop');
var _fight_flush = Module['_fight_flush'] = makeInvalidEarlyAccess('_fight_flush');
var _firstmove = Module['_firstmove'] = makeInvalidEarlyAccess('_firstmove');
var _got_ltc = Module['_got_ltc'] = makeInvalidEarlyAccess('_got_ltc');
var _has_hit = Module['_has_hit'] = makeInvalidEarlyAccess('_has_hit');
var _in_shell = Module['_in_shell'] = makeInvalidEarlyAccess('_in_shell');
var _inv_describe = Module['_inv_describe'] = makeInvalidEarlyAccess('_inv_describe');
var _jump = Module['_jump'] = makeInvalidEarlyAccess('_jump');
var _kamikaze = Module['_kamikaze'] = makeInvalidEarlyAccess('_kamikaze');
var _lower_msg = Module['_lower_msg'] = makeInvalidEarlyAccess('_lower_msg');
var _move_on = Module['_move_on'] = makeInvalidEarlyAccess('_move_on');
var _msg_esc = Module['_msg_esc'] = makeInvalidEarlyAccess('_msg_esc');
var _passgo = Module['_passgo'] = makeInvalidEarlyAccess('_passgo');
var _playing = Module['_playing'] = makeInvalidEarlyAccess('_playing');
var _q_comm = Module['_q_comm'] = makeInvalidEarlyAccess('_q_comm');
var _running = Module['_running'] = makeInvalidEarlyAccess('_running');
var _save_msg = Module['_save_msg'] = makeInvalidEarlyAccess('_save_msg');
var _see_floor = Module['_see_floor'] = makeInvalidEarlyAccess('_see_floor');
var _stat_msg = Module['_stat_msg'] = makeInvalidEarlyAccess('_stat_msg');
var _terse = Module['_terse'] = makeInvalidEarlyAccess('_terse');
var _to_death = Module['_to_death'] = makeInvalidEarlyAccess('_to_death');
var _tombstone = Module['_tombstone'] = makeInvalidEarlyAccess('_tombstone');
var _pack_used = Module['_pack_used'] = makeInvalidEarlyAccess('_pack_used');
var _fruit = Module['_fruit'] = makeInvalidEarlyAccess('_fruit');
var _home = Module['_home'] = makeInvalidEarlyAccess('_home');
var _inv_t_name = Module['_inv_t_name'] = makeInvalidEarlyAccess('_inv_t_name');
var _l_last_comm = Module['_l_last_comm'] = makeInvalidEarlyAccess('_l_last_comm');
var _l_last_dir = Module['_l_last_dir'] = makeInvalidEarlyAccess('_l_last_dir');
var _last_comm = Module['_last_comm'] = makeInvalidEarlyAccess('_last_comm');
var _last_dir = Module['_last_dir'] = makeInvalidEarlyAccess('_last_dir');
var _tr_name = Module['_tr_name'] = makeInvalidEarlyAccess('_tr_name');
var _hungry_state = Module['_hungry_state'] = makeInvalidEarlyAccess('_hungry_state');
var _inpack = Module['_inpack'] = makeInvalidEarlyAccess('_inpack');
var _inv_type = Module['_inv_type'] = makeInvalidEarlyAccess('_inv_type');
var _level = Module['_level'] = makeInvalidEarlyAccess('_level');
var _mpos = Module['_mpos'] = makeInvalidEarlyAccess('_mpos');
var _no_food = Module['_no_food'] = makeInvalidEarlyAccess('_no_food');
var _a_class = Module['_a_class'] = makeInvalidEarlyAccess('_a_class');
var _count = Module['_count'] = makeInvalidEarlyAccess('_count');
var _scoreboard = Module['_scoreboard'] = makeInvalidEarlyAccess('_scoreboard');
var _lastscore = Module['_lastscore'] = makeInvalidEarlyAccess('_lastscore');
var _no_command = Module['_no_command'] = makeInvalidEarlyAccess('_no_command');
var _no_move = Module['_no_move'] = makeInvalidEarlyAccess('_no_move');
var _purse = Module['_purse'] = makeInvalidEarlyAccess('_purse');
var _quiet = Module['_quiet'] = makeInvalidEarlyAccess('_quiet');
var _vf_hit = Module['_vf_hit'] = makeInvalidEarlyAccess('_vf_hit');
var _e_levels = Module['_e_levels'] = makeInvalidEarlyAccess('_e_levels');
var _l_last_pick = Module['_l_last_pick'] = makeInvalidEarlyAccess('_l_last_pick');
var _last_pick = Module['_last_pick'] = makeInvalidEarlyAccess('_last_pick');
var _lvl_obj = Module['_lvl_obj'] = makeInvalidEarlyAccess('_lvl_obj');
var _mlist = Module['_mlist'] = makeInvalidEarlyAccess('_mlist');
var _hw = Module['_hw'] = makeInvalidEarlyAccess('_hw');
var _max_stats = Module['_max_stats'] = makeInvalidEarlyAccess('_max_stats');
var _passages = Module['_passages'] = makeInvalidEarlyAccess('_passages');
var _monsters = Module['_monsters'] = makeInvalidEarlyAccess('_monsters');
var _things = Module['_things'] = makeInvalidEarlyAccess('_things');
var _arm_info = Module['_arm_info'] = makeInvalidEarlyAccess('_arm_info');
var _pot_info = Module['_pot_info'] = makeInvalidEarlyAccess('_pot_info');
var _ring_info = Module['_ring_info'] = makeInvalidEarlyAccess('_ring_info');
var _scr_info = Module['_scr_info'] = makeInvalidEarlyAccess('_scr_info');
var _weap_info = Module['_weap_info'] = makeInvalidEarlyAccess('_weap_info');
var _ws_info = Module['_ws_info'] = makeInvalidEarlyAccess('_ws_info');
var _helpstr = Module['_helpstr'] = makeInvalidEarlyAccess('_helpstr');
var _after = Module['_after'] = makeInvalidEarlyAccess('_after');
var _again = Module['_again'] = makeInvalidEarlyAccess('_again');
var _noscore = Module['_noscore'] = makeInvalidEarlyAccess('_noscore');
var _seenstairs = Module['_seenstairs'] = makeInvalidEarlyAccess('_seenstairs');
var _dir_ch = Module['_dir_ch'] = makeInvalidEarlyAccess('_dir_ch');
var _file_name = Module['_file_name'] = makeInvalidEarlyAccess('_file_name');
var _huh = Module['_huh'] = makeInvalidEarlyAccess('_huh');
var _p_colors = Module['_p_colors'] = makeInvalidEarlyAccess('_p_colors');
var _prbuf = Module['_prbuf'] = makeInvalidEarlyAccess('_prbuf');
var _r_stones = Module['_r_stones'] = makeInvalidEarlyAccess('_r_stones');
var _runch = Module['_runch'] = makeInvalidEarlyAccess('_runch');
var _s_names = Module['_s_names'] = makeInvalidEarlyAccess('_s_names');
var _take = Module['_take'] = makeInvalidEarlyAccess('_take');
var _whoami = Module['_whoami'] = makeInvalidEarlyAccess('_whoami');
var _ws_made = Module['_ws_made'] = makeInvalidEarlyAccess('_ws_made');
var _ws_type = Module['_ws_type'] = makeInvalidEarlyAccess('_ws_type');
var _orig_dsusp = Module['_orig_dsusp'] = makeInvalidEarlyAccess('_orig_dsusp');
var _n_objs = Module['_n_objs'] = makeInvalidEarlyAccess('_n_objs');
var _ntraps = Module['_ntraps'] = makeInvalidEarlyAccess('_ntraps');
var _max_hit = Module['_max_hit'] = makeInvalidEarlyAccess('_max_hit');
var _max_level = Module['_max_level'] = makeInvalidEarlyAccess('_max_level');
var _food_left = Module['_food_left'] = makeInvalidEarlyAccess('_food_left');
var _dnum = Module['_dnum'] = makeInvalidEarlyAccess('_dnum');
var _seed = Module['_seed'] = makeInvalidEarlyAccess('_seed');
var _delta = Module['_delta'] = makeInvalidEarlyAccess('_delta');
var _oldpos = Module['_oldpos'] = makeInvalidEarlyAccess('_oldpos');
var _stairs = Module['_stairs'] = makeInvalidEarlyAccess('_stairs');
var _places = Module['_places'] = makeInvalidEarlyAccess('_places');
var _cur_armor = Module['_cur_armor'] = makeInvalidEarlyAccess('_cur_armor');
var _cur_ring = Module['_cur_ring'] = makeInvalidEarlyAccess('_cur_ring');
var _cur_weapon = Module['_cur_weapon'] = makeInvalidEarlyAccess('_cur_weapon');
var _player = Module['_player'] = makeInvalidEarlyAccess('_player');
var _oldrp = Module['_oldrp'] = makeInvalidEarlyAccess('_oldrp');
var _rooms = Module['_rooms'] = makeInvalidEarlyAccess('_rooms');
var _curscr = Module['_curscr'] = makeInvalidEarlyAccess('_curscr');
var _LINES = Module['_LINES'] = makeInvalidEarlyAccess('_LINES');
var _COLS = Module['_COLS'] = makeInvalidEarlyAccess('_COLS');
var _stdscr = Module['_stdscr'] = makeInvalidEarlyAccess('_stdscr');
var _d_list = Module['_d_list'] = makeInvalidEarlyAccess('_d_list');
var __indirect_function_table = makeInvalidEarlyAccess('__indirect_function_table');
var _between = Module['_between'] = makeInvalidEarlyAccess('_between');
var _h_names = Module['_h_names'] = makeInvalidEarlyAccess('_h_names');
var _m_names = Module['_m_names'] = makeInvalidEarlyAccess('_m_names');
var _rainbow = Module['_rainbow'] = makeInvalidEarlyAccess('_rainbow');
var _stones = Module['_stones'] = makeInvalidEarlyAccess('_stones');
var _metal = Module['_metal'] = makeInvalidEarlyAccess('_metal');
var _wood = Module['_wood'] = makeInvalidEarlyAccess('_wood');
var _cNCOLORS = Module['_cNCOLORS'] = makeInvalidEarlyAccess('_cNCOLORS');
var _cNSTONES = Module['_cNSTONES'] = makeInvalidEarlyAccess('_cNSTONES');
var _cNWOOD = Module['_cNWOOD'] = makeInvalidEarlyAccess('_cNWOOD');
var _cNMETAL = Module['_cNMETAL'] = makeInvalidEarlyAccess('_cNMETAL');
var _numscores = Module['_numscores'] = makeInvalidEarlyAccess('_numscores');
var _Numname = Module['_Numname'] = makeInvalidEarlyAccess('_Numname');
var _allscore = Module['_allscore'] = makeInvalidEarlyAccess('_allscore');
var _nh = Module['_nh'] = makeInvalidEarlyAccess('_nh');
var _optlist = Module['_optlist'] = makeInvalidEarlyAccess('_optlist');
var _group = Module['_group'] = makeInvalidEarlyAccess('_group');
var _md_endian = Module['_md_endian'] = makeInvalidEarlyAccess('_md_endian');
var ___abort_handler = Module['___abort_handler'] = makeInvalidEarlyAccess('___abort_handler');
var ___instance_terminated = Module['___instance_terminated'] = makeInvalidEarlyAccess('___instance_terminated');
var ___wbindgen_externrefs = Module['___wbindgen_externrefs'] = makeInvalidEarlyAccess('___wbindgen_externrefs');
var wasmMemory = makeInvalidEarlyAccess('wasmMemory');
var wasmTable = makeInvalidEarlyAccess('wasmTable');

function assignWasmExports(wasmExports) {
  assert(typeof wasmExports['wear'] != 'undefined', 'missing Wasm export: wear');
  assert(typeof wasmExports['get_item'] != 'undefined', 'missing Wasm export: get_item');
  assert(typeof wasmExports['rg_addmsg'] != 'undefined', 'missing Wasm export: rg_addmsg');
  assert(typeof wasmExports['endmsg'] != 'undefined', 'missing Wasm export: endmsg');
  assert(typeof wasmExports['rg_msg'] != 'undefined', 'missing Wasm export: rg_msg');
  assert(typeof wasmExports['spread'] != 'undefined', 'missing Wasm export: spread');
  assert(typeof wasmExports['do_daemons'] != 'undefined', 'missing Wasm export: do_daemons');
  assert(typeof wasmExports['do_fuses'] != 'undefined', 'missing Wasm export: do_fuses');
  assert(typeof wasmExports['rg_core_tick_complete'] != 'undefined', 'missing Wasm export: rg_core_tick_complete');
  assert(typeof wasmExports['inv_name'] != 'undefined', 'missing Wasm export: inv_name');
  assert(typeof wasmExports['take_off'] != 'undefined', 'missing Wasm export: take_off');
  assert(typeof wasmExports['dropcheck'] != 'undefined', 'missing Wasm export: dropcheck');
  assert(typeof wasmExports['waste_time'] != 'undefined', 'missing Wasm export: waste_time');
  assert(typeof wasmExports['runners'] != 'undefined', 'missing Wasm export: runners');
  assert(typeof wasmExports['do_chase'] != 'undefined', 'missing Wasm export: do_chase');
  assert(typeof wasmExports['move_monst'] != 'undefined', 'missing Wasm export: move_monst');
  assert(typeof wasmExports['dist_cp'] != 'undefined', 'missing Wasm export: dist_cp');
  assert(typeof wasmExports['rnd'] != 'undefined', 'missing Wasm export: rnd');
  assert(typeof wasmExports['sign'] != 'undefined', 'missing Wasm export: sign');
  assert(typeof wasmExports['fire_bolt'] != 'undefined', 'missing Wasm export: fire_bolt');
  assert(typeof wasmExports['chase'] != 'undefined', 'missing Wasm export: chase');
  assert(typeof wasmExports['attack'] != 'undefined', 'missing Wasm export: attack');
  assert(typeof wasmExports['_detach'] != 'undefined', 'missing Wasm export: _detach');
  assert(typeof wasmExports['_attach'] != 'undefined', 'missing Wasm export: _attach');
  assert(typeof wasmExports['find_dest'] != 'undefined', 'missing Wasm export: find_dest');
  assert(typeof wasmExports['relocate'] != 'undefined', 'missing Wasm export: relocate');
  assert(typeof wasmExports['mvaddch'] != 'undefined', 'missing Wasm export: mvaddch');
  assert(typeof wasmExports['mvinch'] != 'undefined', 'missing Wasm export: mvinch');
  assert(typeof wasmExports['move'] != 'undefined', 'missing Wasm export: move');
  assert(typeof wasmExports['see_monst'] != 'undefined', 'missing Wasm export: see_monst');
  assert(typeof wasmExports['addch'] != 'undefined', 'missing Wasm export: addch');
  assert(typeof wasmExports['standout'] != 'undefined', 'missing Wasm export: standout');
  assert(typeof wasmExports['standend'] != 'undefined', 'missing Wasm export: standend');
  assert(typeof wasmExports['roomin'] != 'undefined', 'missing Wasm export: roomin');
  assert(typeof wasmExports['set_oldch'] != 'undefined', 'missing Wasm export: set_oldch');
  assert(typeof wasmExports['step_ok'] != 'undefined', 'missing Wasm export: step_ok');
  assert(typeof wasmExports['rndmove'] != 'undefined', 'missing Wasm export: rndmove');
  assert(typeof wasmExports['dist'] != 'undefined', 'missing Wasm export: dist');
  assert(typeof wasmExports['runto'] != 'undefined', 'missing Wasm export: runto');
  assert(typeof wasmExports['diag_ok'] != 'undefined', 'missing Wasm export: diag_ok');
  assert(typeof wasmExports['cansee'] != 'undefined', 'missing Wasm export: cansee');
  assert(typeof wasmExports['command'] != 'undefined', 'missing Wasm export: command');
  assert(typeof wasmExports['rg_core_exit'] != 'undefined', 'missing Wasm export: rg_core_exit');
  assert(typeof wasmExports['look'] != 'undefined', 'missing Wasm export: look');
  assert(typeof wasmExports['status'] != 'undefined', 'missing Wasm export: status');
  assert(typeof wasmExports['refresh'] != 'undefined', 'missing Wasm export: refresh');
  assert(typeof wasmExports['readchar'] != 'undefined', 'missing Wasm export: readchar');
  assert(typeof wasmExports['pick_up'] != 'undefined', 'missing Wasm export: pick_up');
  assert(typeof wasmExports['shell'] != 'undefined', 'missing Wasm export: shell');
  assert(typeof wasmExports['do_move'] != 'undefined', 'missing Wasm export: do_move');
  assert(typeof wasmExports['do_run'] != 'undefined', 'missing Wasm export: do_run');
  assert(typeof wasmExports['get_dir'] != 'undefined', 'missing Wasm export: get_dir');
  assert(typeof wasmExports['rg_ui_line'] != 'undefined', 'missing Wasm export: rg_ui_line');
  assert(typeof wasmExports['missile'] != 'undefined', 'missing Wasm export: missile');
  assert(typeof wasmExports['rg_ui_clear'] != 'undefined', 'missing Wasm export: rg_ui_clear');
  assert(typeof wasmExports['quaff'] != 'undefined', 'missing Wasm export: quaff');
  assert(typeof wasmExports['quit'] != 'undefined', 'missing Wasm export: quit');
  assert(typeof wasmExports['rg_inventory_browser'] != 'undefined', 'missing Wasm export: rg_inventory_browser');
  assert(typeof wasmExports['picky_inven'] != 'undefined', 'missing Wasm export: picky_inven');
  assert(typeof wasmExports['drop'] != 'undefined', 'missing Wasm export: drop');
  assert(typeof wasmExports['read_scroll'] != 'undefined', 'missing Wasm export: read_scroll');
  assert(typeof wasmExports['eat'] != 'undefined', 'missing Wasm export: eat');
  assert(typeof wasmExports['wield'] != 'undefined', 'missing Wasm export: wield');
  assert(typeof wasmExports['ring_on'] != 'undefined', 'missing Wasm export: ring_on');
  assert(typeof wasmExports['ring_off'] != 'undefined', 'missing Wasm export: ring_off');
  assert(typeof wasmExports['option'] != 'undefined', 'missing Wasm export: option');
  assert(typeof wasmExports['call'] != 'undefined', 'missing Wasm export: call');
  assert(typeof wasmExports['new_level'] != 'undefined', 'missing Wasm export: new_level');
  assert(typeof wasmExports['u_level'] != 'undefined', 'missing Wasm export: u_level');
  assert(typeof wasmExports['help'] != 'undefined', 'missing Wasm export: help');
  assert(typeof wasmExports['identify'] != 'undefined', 'missing Wasm export: identify');
  assert(typeof wasmExports['search'] != 'undefined', 'missing Wasm export: search');
  assert(typeof wasmExports['do_zap'] != 'undefined', 'missing Wasm export: do_zap');
  assert(typeof wasmExports['discovered'] != 'undefined', 'missing Wasm export: discovered');
  assert(typeof wasmExports['clearok'] != 'undefined', 'missing Wasm export: clearok');
  assert(typeof wasmExports['wrefresh'] != 'undefined', 'missing Wasm export: wrefresh');
  assert(typeof wasmExports['save_game'] != 'undefined', 'missing Wasm export: save_game');
  assert(typeof wasmExports['current'] != 'undefined', 'missing Wasm export: current');
  assert(typeof wasmExports['unctrl'] != 'undefined', 'missing Wasm export: unctrl');
  assert(typeof wasmExports['teleport'] != 'undefined', 'missing Wasm export: teleport');
  assert(typeof wasmExports['rg_semantic_register_term'] != 'undefined', 'missing Wasm export: rg_semantic_register_term');
  assert(typeof wasmExports['illcom'] != 'undefined', 'missing Wasm export: illcom');
  assert(typeof wasmExports['rg_command_state_get'] != 'undefined', 'missing Wasm export: rg_command_state_get');
  assert(typeof wasmExports['rg_command_state_set'] != 'undefined', 'missing Wasm export: rg_command_state_set');
  assert(typeof wasmExports['wclear'] != 'undefined', 'missing Wasm export: wclear');
  assert(typeof wasmExports['wmove'] != 'undefined', 'missing Wasm export: wmove');
  assert(typeof wasmExports['waddstr'] != 'undefined', 'missing Wasm export: waddstr');
  assert(typeof wasmExports['rg_wait_for'] != 'undefined', 'missing Wasm export: rg_wait_for');
  assert(typeof wasmExports['touchwin'] != 'undefined', 'missing Wasm export: touchwin');
  assert(typeof wasmExports['d_level'] != 'undefined', 'missing Wasm export: d_level');
  assert(typeof wasmExports['total_winner'] != 'undefined', 'missing Wasm export: total_winner');
  assert(typeof wasmExports['levit_check'] != 'undefined', 'missing Wasm export: levit_check');
  assert(typeof wasmExports['get_str'] != 'undefined', 'missing Wasm export: get_str');
  assert(typeof wasmExports['free'] != 'undefined', 'missing Wasm export: free');
  assert(typeof wasmExports['strlen'] != 'undefined', 'missing Wasm export: strlen');
  assert(typeof wasmExports['malloc'] != 'undefined', 'missing Wasm export: malloc');
  assert(typeof wasmExports['d_slot'] != 'undefined', 'missing Wasm export: d_slot');
  assert(typeof wasmExports['find_slot'] != 'undefined', 'missing Wasm export: find_slot');
  assert(typeof wasmExports['start_daemon'] != 'undefined', 'missing Wasm export: start_daemon');
  assert(typeof wasmExports['kill_daemon'] != 'undefined', 'missing Wasm export: kill_daemon');
  assert(typeof wasmExports['turn_see'] != 'undefined', 'missing Wasm export: turn_see');
  assert(typeof wasmExports['land'] != 'undefined', 'missing Wasm export: land');
  assert(typeof wasmExports['visuals'] != 'undefined', 'missing Wasm export: visuals');
  assert(typeof wasmExports['come_down'] != 'undefined', 'missing Wasm export: come_down');
  assert(typeof wasmExports['nohaste'] != 'undefined', 'missing Wasm export: nohaste');
  assert(typeof wasmExports['sight'] != 'undefined', 'missing Wasm export: sight');
  assert(typeof wasmExports['unsee'] != 'undefined', 'missing Wasm export: unsee');
  assert(typeof wasmExports['unconfuse'] != 'undefined', 'missing Wasm export: unconfuse');
  assert(typeof wasmExports['rollwand'] != 'undefined', 'missing Wasm export: rollwand');
  assert(typeof wasmExports['swander'] != 'undefined', 'missing Wasm export: swander');
  assert(typeof wasmExports['stomach'] != 'undefined', 'missing Wasm export: stomach');
  assert(typeof wasmExports['doctor'] != 'undefined', 'missing Wasm export: doctor');
  assert(typeof wasmExports['rg_core_abort'] != 'undefined', 'missing Wasm export: rg_core_abort');
  assert(typeof wasmExports['fuse'] != 'undefined', 'missing Wasm export: fuse');
  assert(typeof wasmExports['lengthen'] != 'undefined', 'missing Wasm export: lengthen');
  assert(typeof wasmExports['extinguish'] != 'undefined', 'missing Wasm export: extinguish');
  assert(typeof wasmExports['roll'] != 'undefined', 'missing Wasm export: roll');
  assert(typeof wasmExports['wanderer'] != 'undefined', 'missing Wasm export: wanderer');
  assert(typeof wasmExports['choose_str'] != 'undefined', 'missing Wasm export: choose_str');
  assert(typeof wasmExports['enter_room'] != 'undefined', 'missing Wasm export: enter_room');
  assert(typeof wasmExports['death'] != 'undefined', 'missing Wasm export: death');
  assert(typeof wasmExports['ring_eat'] != 'undefined', 'missing Wasm export: ring_eat');
  assert(typeof wasmExports['rnd_thing'] != 'undefined', 'missing Wasm export: rnd_thing');
  assert(typeof wasmExports['fight'] != 'undefined', 'missing Wasm export: fight');
  assert(typeof wasmExports['set_mname'] != 'undefined', 'missing Wasm export: set_mname');
  assert(typeof wasmExports['roll_em'] != 'undefined', 'missing Wasm export: roll_em');
  assert(typeof wasmExports['hit'] != 'undefined', 'missing Wasm export: hit');
  assert(typeof wasmExports['pick_color'] != 'undefined', 'missing Wasm export: pick_color');
  assert(typeof wasmExports['killed'] != 'undefined', 'missing Wasm export: killed');
  assert(typeof wasmExports['miss'] != 'undefined', 'missing Wasm export: miss');
  assert(typeof wasmExports['rg_semantic_monster'] != 'undefined', 'missing Wasm export: rg_semantic_monster');
  assert(typeof wasmExports['inch'] != 'undefined', 'missing Wasm export: inch');
  assert(typeof wasmExports['thunk'] != 'undefined', 'missing Wasm export: thunk');
  assert(typeof wasmExports['rg_semantic_combatant'] != 'undefined', 'missing Wasm export: rg_semantic_combatant');
  assert(typeof wasmExports['rg_semantic_combat_verb'] != 'undefined', 'missing Wasm export: rg_semantic_combat_verb');
  assert(typeof wasmExports['fallpos'] != 'undefined', 'missing Wasm export: fallpos');
  assert(typeof wasmExports['new_item'] != 'undefined', 'missing Wasm export: new_item');
  assert(typeof wasmExports['save'] != 'undefined', 'missing Wasm export: save');
  assert(typeof wasmExports['remove_mon'] != 'undefined', 'missing Wasm export: remove_mon');
  assert(typeof wasmExports['check_level'] != 'undefined', 'missing Wasm export: check_level');
  assert(typeof wasmExports['flush_type'] != 'undefined', 'missing Wasm export: flush_type');
  assert(typeof wasmExports['bounce'] != 'undefined', 'missing Wasm export: bounce');
  assert(typeof wasmExports['rust_armor'] != 'undefined', 'missing Wasm export: rust_armor');
  assert(typeof wasmExports['chg_str'] != 'undefined', 'missing Wasm export: chg_str');
  assert(typeof wasmExports['is_magic'] != 'undefined', 'missing Wasm export: is_magic');
  assert(typeof wasmExports['leave_pack'] != 'undefined', 'missing Wasm export: leave_pack');
  assert(typeof wasmExports['discard'] != 'undefined', 'missing Wasm export: discard');
  assert(typeof wasmExports['fall'] != 'undefined', 'missing Wasm export: fall');
  assert(typeof wasmExports['swing'] != 'undefined', 'missing Wasm export: swing');
  assert(typeof wasmExports['prname'] != 'undefined', 'missing Wasm export: prname');
  assert(typeof wasmExports['init_player'] != 'undefined', 'missing Wasm export: init_player');
  assert(typeof wasmExports['add_pack'] != 'undefined', 'missing Wasm export: add_pack');
  assert(typeof wasmExports['init_weapon'] != 'undefined', 'missing Wasm export: init_weapon');
  assert(typeof wasmExports['init_colors'] != 'undefined', 'missing Wasm export: init_colors');
  assert(typeof wasmExports['init_names'] != 'undefined', 'missing Wasm export: init_names');
  assert(typeof wasmExports['init_stones'] != 'undefined', 'missing Wasm export: init_stones');
  assert(typeof wasmExports['init_materials'] != 'undefined', 'missing Wasm export: init_materials');
  assert(typeof wasmExports['sumprobs'] != 'undefined', 'missing Wasm export: sumprobs');
  assert(typeof wasmExports['init_probs'] != 'undefined', 'missing Wasm export: init_probs');
  assert(typeof wasmExports['clrtoeol'] != 'undefined', 'missing Wasm export: clrtoeol');
  assert(typeof wasmExports['rg_message_clear'] != 'undefined', 'missing Wasm export: rg_message_clear');
  assert(typeof wasmExports['rg_message_prepare'] != 'undefined', 'missing Wasm export: rg_message_prepare');
  assert(typeof wasmExports['rg_message_push'] != 'undefined', 'missing Wasm export: rg_message_push');
  assert(typeof wasmExports['mvaddstr'] != 'undefined', 'missing Wasm export: mvaddstr');
  assert(typeof wasmExports['rg_host_message_requires_acknowledgement'] != 'undefined', 'missing Wasm export: rg_host_message_requires_acknowledgement');
  assert(typeof wasmExports['md_readchar'] != 'undefined', 'missing Wasm export: md_readchar');
  assert(typeof wasmExports['rg_message_discard'] != 'undefined', 'missing Wasm export: rg_message_discard');
  assert(typeof wasmExports['rg_message_flush'] != 'undefined', 'missing Wasm export: rg_message_flush');
  assert(typeof wasmExports['rg_semantic_copy'] != 'undefined', 'missing Wasm export: rg_semantic_copy');
  assert(typeof wasmExports['rg_message_state_export'] != 'undefined', 'missing Wasm export: rg_message_state_export');
  assert(typeof wasmExports['rg_message_state_validate'] != 'undefined', 'missing Wasm export: rg_message_state_validate');
  assert(typeof wasmExports['rg_message_state_import'] != 'undefined', 'missing Wasm export: rg_message_state_import');
  assert(typeof wasmExports['rg_status_publish'] != 'undefined', 'missing Wasm export: rg_status_publish');
  assert(typeof wasmExports['printw'] != 'undefined', 'missing Wasm export: printw');
  assert(typeof wasmExports['rg_status_state_get'] != 'undefined', 'missing Wasm export: rg_status_state_get');
  assert(typeof wasmExports['rg_status_state_set'] != 'undefined', 'missing Wasm export: rg_status_state_set');
  assert(typeof wasmExports['wait_for'] != 'undefined', 'missing Wasm export: wait_for');
  assert(typeof wasmExports['show_win'] != 'undefined', 'missing Wasm export: show_win');
  assert(typeof wasmExports['_free_list'] != 'undefined', 'missing Wasm export: _free_list');
  assert(typeof wasmExports['init_check'] != 'undefined', 'missing Wasm export: init_check');
  assert(typeof wasmExports['open_score'] != 'undefined', 'missing Wasm export: open_score');
  assert(typeof wasmExports['setup'] != 'undefined', 'missing Wasm export: setup');
  assert(typeof wasmExports['getltchars'] != 'undefined', 'missing Wasm export: getltchars');
  assert(typeof wasmExports['resetltchars'] != 'undefined', 'missing Wasm export: resetltchars');
  assert(typeof wasmExports['playltchars'] != 'undefined', 'missing Wasm export: playltchars');
  assert(typeof wasmExports['start_score'] != 'undefined', 'missing Wasm export: start_score');
  assert(typeof wasmExports['is_symlink'] != 'undefined', 'missing Wasm export: is_symlink');
  assert(typeof wasmExports['too_much'] != 'undefined', 'missing Wasm export: too_much');
  assert(typeof wasmExports['author'] != 'undefined', 'missing Wasm export: author');
  assert(typeof wasmExports['lock_sc'] != 'undefined', 'missing Wasm export: lock_sc');
  assert(typeof wasmExports['unlock_sc'] != 'undefined', 'missing Wasm export: unlock_sc');
  assert(typeof wasmExports['rg_knowledge_flush_input'] != 'undefined', 'missing Wasm export: rg_knowledge_flush_input');
  assert(typeof wasmExports['endit'] != 'undefined', 'missing Wasm export: endit');
  assert(typeof wasmExports['endwin'] != 'undefined', 'missing Wasm export: endwin');
  assert(typeof wasmExports['fatal'] != 'undefined', 'missing Wasm export: fatal');
  assert(typeof wasmExports['my_exit'] != 'undefined', 'missing Wasm export: my_exit');
  assert(typeof wasmExports['rg_random_next'] != 'undefined', 'missing Wasm export: rg_random_next');
  assert(typeof wasmExports['tstp'] != 'undefined', 'missing Wasm export: tstp');
  assert(typeof wasmExports['playit'] != 'undefined', 'missing Wasm export: playit');
  assert(typeof wasmExports['baudrate'] != 'undefined', 'missing Wasm export: baudrate');
  assert(typeof wasmExports['md_hasclreol'] != 'undefined', 'missing Wasm export: md_hasclreol');
  assert(typeof wasmExports['rg_core_was_restored'] != 'undefined', 'missing Wasm export: rg_core_was_restored');
  assert(typeof wasmExports['rg_host_checkpoint'] != 'undefined', 'missing Wasm export: rg_host_checkpoint');
  assert(typeof wasmExports['rg_core_set_outcome'] != 'undefined', 'missing Wasm export: rg_core_set_outcome');
  assert(typeof wasmExports['leave'] != 'undefined', 'missing Wasm export: leave');
  assert(typeof wasmExports['clear'] != 'undefined', 'missing Wasm export: clear');
  assert(typeof wasmExports['mvprintw'] != 'undefined', 'missing Wasm export: mvprintw');
  assert(typeof wasmExports['rg_capture_arguments'] != 'undefined', 'missing Wasm export: rg_capture_arguments');
  assert(typeof wasmExports['score'] != 'undefined', 'missing Wasm export: score');
  assert(typeof wasmExports['isendwin'] != 'undefined', 'missing Wasm export: isendwin');
  assert(typeof wasmExports['mvcur'] != 'undefined', 'missing Wasm export: mvcur');
  assert(typeof wasmExports['rg_console_putchar'] != 'undefined', 'missing Wasm export: rg_console_putchar');
  assert(typeof wasmExports['md_init'] != 'undefined', 'missing Wasm export: md_init');
  assert(typeof wasmExports['md_onsignal_default'] != 'undefined', 'missing Wasm export: md_onsignal_default');
  assert(typeof wasmExports['md_onsignal_exit'] != 'undefined', 'missing Wasm export: md_onsignal_exit');
  assert(typeof wasmExports['md_onsignal_autosave'] != 'undefined', 'missing Wasm export: md_onsignal_autosave');
  assert(typeof wasmExports['md_ignoreallsignals'] != 'undefined', 'missing Wasm export: md_ignoreallsignals');
  assert(typeof wasmExports['md_tstphold'] != 'undefined', 'missing Wasm export: md_tstphold');
  assert(typeof wasmExports['md_tstpresume'] != 'undefined', 'missing Wasm export: md_tstpresume');
  assert(typeof wasmExports['md_tstpsignal'] != 'undefined', 'missing Wasm export: md_tstpsignal');
  assert(typeof wasmExports['md_start_checkout_timer'] != 'undefined', 'missing Wasm export: md_start_checkout_timer');
  assert(typeof wasmExports['md_stop_checkout_timer'] != 'undefined', 'missing Wasm export: md_stop_checkout_timer');
  assert(typeof wasmExports['md_putchar'] != 'undefined', 'missing Wasm export: md_putchar');
  assert(typeof wasmExports['md_raw_standout'] != 'undefined', 'missing Wasm export: md_raw_standout');
  assert(typeof wasmExports['md_raw_standend'] != 'undefined', 'missing Wasm export: md_raw_standend');
  assert(typeof wasmExports['md_unlink_open_file'] != 'undefined', 'missing Wasm export: md_unlink_open_file');
  assert(typeof wasmExports['md_unlink'] != 'undefined', 'missing Wasm export: md_unlink');
  assert(typeof wasmExports['md_chmod'] != 'undefined', 'missing Wasm export: md_chmod');
  assert(typeof wasmExports['md_normaluser'] != 'undefined', 'missing Wasm export: md_normaluser');
  assert(typeof wasmExports['md_getuid'] != 'undefined', 'missing Wasm export: md_getuid');
  assert(typeof wasmExports['md_getpid'] != 'undefined', 'missing Wasm export: md_getpid');
  assert(typeof wasmExports['md_getusername'] != 'undefined', 'missing Wasm export: md_getusername');
  assert(typeof wasmExports['rg_core_player_name'] != 'undefined', 'missing Wasm export: rg_core_player_name');
  assert(typeof wasmExports['md_gethomedir'] != 'undefined', 'missing Wasm export: md_gethomedir');
  assert(typeof wasmExports['md_sleep'] != 'undefined', 'missing Wasm export: md_sleep');
  assert(typeof wasmExports['md_getshell'] != 'undefined', 'missing Wasm export: md_getshell');
  assert(typeof wasmExports['md_shellescape'] != 'undefined', 'missing Wasm export: md_shellescape');
  assert(typeof wasmExports['md_getrealname'] != 'undefined', 'missing Wasm export: md_getrealname');
  assert(typeof wasmExports['md_crypt'] != 'undefined', 'missing Wasm export: md_crypt');
  assert(typeof wasmExports['md_getpass'] != 'undefined', 'missing Wasm export: md_getpass');
  assert(typeof wasmExports['wgetnstr'] != 'undefined', 'missing Wasm export: wgetnstr');
  assert(typeof wasmExports['md_erasechar'] != 'undefined', 'missing Wasm export: md_erasechar');
  assert(typeof wasmExports['erasechar'] != 'undefined', 'missing Wasm export: erasechar');
  assert(typeof wasmExports['md_killchar'] != 'undefined', 'missing Wasm export: md_killchar');
  assert(typeof wasmExports['killchar'] != 'undefined', 'missing Wasm export: killchar');
  assert(typeof wasmExports['md_dsuspchar'] != 'undefined', 'missing Wasm export: md_dsuspchar');
  assert(typeof wasmExports['md_setdsuspchar'] != 'undefined', 'missing Wasm export: md_setdsuspchar');
  assert(typeof wasmExports['md_suspchar'] != 'undefined', 'missing Wasm export: md_suspchar');
  assert(typeof wasmExports['md_setsuspchar'] != 'undefined', 'missing Wasm export: md_setsuspchar');
  assert(typeof wasmExports['getch'] != 'undefined', 'missing Wasm export: getch');
  assert(typeof wasmExports['md_loadav'] != 'undefined', 'missing Wasm export: md_loadav');
  assert(typeof wasmExports['md_issymlink'] != 'undefined', 'missing Wasm export: md_issymlink');
  assert(typeof wasmExports['erase_lamp'] != 'undefined', 'missing Wasm export: erase_lamp');
  assert(typeof wasmExports['wake_monster'] != 'undefined', 'missing Wasm export: wake_monster');
  assert(typeof wasmExports['trip_ch'] != 'undefined', 'missing Wasm export: trip_ch');
  assert(typeof wasmExports['show_floor'] != 'undefined', 'missing Wasm export: show_floor');
  assert(typeof wasmExports['find_obj'] != 'undefined', 'missing Wasm export: find_obj');
  assert(typeof wasmExports['add_str'] != 'undefined', 'missing Wasm export: add_str');
  assert(typeof wasmExports['add_haste'] != 'undefined', 'missing Wasm export: add_haste');
  assert(typeof wasmExports['aggravate'] != 'undefined', 'missing Wasm export: aggravate');
  assert(typeof wasmExports['vowelstr'] != 'undefined', 'missing Wasm export: vowelstr');
  assert(typeof wasmExports['is_current'] != 'undefined', 'missing Wasm export: is_current');
  assert(typeof wasmExports['reset_last'] != 'undefined', 'missing Wasm export: reset_last');
  assert(typeof wasmExports['rg_direction_state_get'] != 'undefined', 'missing Wasm export: rg_direction_state_get');
  assert(typeof wasmExports['rg_direction_state_set'] != 'undefined', 'missing Wasm export: rg_direction_state_set');
  assert(typeof wasmExports['call_it'] != 'undefined', 'missing Wasm export: call_it');
  assert(typeof wasmExports['randmonster'] != 'undefined', 'missing Wasm export: randmonster');
  assert(typeof wasmExports['new_monster'] != 'undefined', 'missing Wasm export: new_monster');
  assert(typeof wasmExports['exp_add'] != 'undefined', 'missing Wasm export: exp_add');
  assert(typeof wasmExports['find_floor'] != 'undefined', 'missing Wasm export: find_floor');
  assert(typeof wasmExports['give_pack'] != 'undefined', 'missing Wasm export: give_pack');
  assert(typeof wasmExports['new_thing'] != 'undefined', 'missing Wasm export: new_thing');
  assert(typeof wasmExports['save_throw'] != 'undefined', 'missing Wasm export: save_throw');
  assert(typeof wasmExports['leaveok'] != 'undefined', 'missing Wasm export: leaveok');
  assert(typeof wasmExports['be_trapped'] != 'undefined', 'missing Wasm export: be_trapped');
  assert(typeof wasmExports['floor_at'] != 'undefined', 'missing Wasm export: floor_at');
  assert(typeof wasmExports['leave_room'] != 'undefined', 'missing Wasm export: leave_room');
  assert(typeof wasmExports['turn_ok'] != 'undefined', 'missing Wasm export: turn_ok');
  assert(typeof wasmExports['turnref'] != 'undefined', 'missing Wasm export: turnref');
  assert(typeof wasmExports['door_open'] != 'undefined', 'missing Wasm export: door_open');
  assert(typeof wasmExports['do_rooms'] != 'undefined', 'missing Wasm export: do_rooms');
  assert(typeof wasmExports['do_passages'] != 'undefined', 'missing Wasm export: do_passages');
  assert(typeof wasmExports['put_things'] != 'undefined', 'missing Wasm export: put_things');
  assert(typeof wasmExports['rnd_room'] != 'undefined', 'missing Wasm export: rnd_room');
  assert(typeof wasmExports['treas_room'] != 'undefined', 'missing Wasm export: treas_room');
  assert(typeof wasmExports['put_bool'] != 'undefined', 'missing Wasm export: put_bool');
  assert(typeof wasmExports['get_bool'] != 'undefined', 'missing Wasm export: get_bool');
  assert(typeof wasmExports['waddch'] != 'undefined', 'missing Wasm export: waddch');
  assert(typeof wasmExports['get_sf'] != 'undefined', 'missing Wasm export: get_sf');
  assert(typeof wasmExports['put_inv_t'] != 'undefined', 'missing Wasm export: put_inv_t');
  assert(typeof wasmExports['get_inv_t'] != 'undefined', 'missing Wasm export: get_inv_t');
  assert(typeof wasmExports['mvwprintw'] != 'undefined', 'missing Wasm export: mvwprintw');
  assert(typeof wasmExports['put_str'] != 'undefined', 'missing Wasm export: put_str');
  assert(typeof wasmExports['rg_ui_printf'] != 'undefined', 'missing Wasm export: rg_ui_printf');
  assert(typeof wasmExports['rg_host_text_mode'] != 'undefined', 'missing Wasm export: rg_host_text_mode');
  assert(typeof wasmExports['strucpy'] != 'undefined', 'missing Wasm export: strucpy');
  assert(typeof wasmExports['wclrtoeol'] != 'undefined', 'missing Wasm export: wclrtoeol');
  assert(typeof wasmExports['rg_host_player_name'] != 'undefined', 'missing Wasm export: rg_host_player_name');
  assert(typeof wasmExports['wprintw'] != 'undefined', 'missing Wasm export: wprintw');
  assert(typeof wasmExports['pr_optname'] != 'undefined', 'missing Wasm export: pr_optname');
  assert(typeof wasmExports['parse_opts'] != 'undefined', 'missing Wasm export: parse_opts');
  assert(typeof wasmExports['pack_room'] != 'undefined', 'missing Wasm export: pack_room');
  assert(typeof wasmExports['rg_semantic_pickup_item'] != 'undefined', 'missing Wasm export: rg_semantic_pickup_item');
  assert(typeof wasmExports['move_msg'] != 'undefined', 'missing Wasm export: move_msg');
  assert(typeof wasmExports['pack_char'] != 'undefined', 'missing Wasm export: pack_char');
  assert(typeof wasmExports['inventory'] != 'undefined', 'missing Wasm export: inventory');
  assert(typeof wasmExports['add_line'] != 'undefined', 'missing Wasm export: add_line');
  assert(typeof wasmExports['end_line'] != 'undefined', 'missing Wasm export: end_line');
  assert(typeof wasmExports['money'] != 'undefined', 'missing Wasm export: money');
  assert(typeof wasmExports['rg_host_inventory_browser_enabled'] != 'undefined', 'missing Wasm export: rg_host_inventory_browser_enabled');
  assert(typeof wasmExports['floor_ch'] != 'undefined', 'missing Wasm export: floor_ch');
  assert(typeof wasmExports['conn'] != 'undefined', 'missing Wasm export: conn');
  assert(typeof wasmExports['numpass'] != 'undefined', 'missing Wasm export: numpass');
  assert(typeof wasmExports['door'] != 'undefined', 'missing Wasm export: door');
  assert(typeof wasmExports['putpass'] != 'undefined', 'missing Wasm export: putpass');
  assert(typeof wasmExports['passnum'] != 'undefined', 'missing Wasm export: passnum');
  assert(typeof wasmExports['do_pot'] != 'undefined', 'missing Wasm export: do_pot');
  assert(typeof wasmExports['seen_stairs'] != 'undefined', 'missing Wasm export: seen_stairs');
  assert(typeof wasmExports['invis_on'] != 'undefined', 'missing Wasm export: invis_on');
  assert(typeof wasmExports['rg_semantic_register_message'] != 'undefined', 'missing Wasm export: rg_semantic_register_message');
  assert(typeof wasmExports['raise_level'] != 'undefined', 'missing Wasm export: raise_level');
  assert(typeof wasmExports['gethand'] != 'undefined', 'missing Wasm export: gethand');
  assert(typeof wasmExports['ring_num'] != 'undefined', 'missing Wasm export: ring_num');
  assert(typeof wasmExports['num'] != 'undefined', 'missing Wasm export: num');
  assert(typeof wasmExports['rg_console_printf'] != 'undefined', 'missing Wasm export: rg_console_printf');
  assert(typeof wasmExports['delwin'] != 'undefined', 'missing Wasm export: delwin');
  assert(typeof wasmExports['rd_score'] != 'undefined', 'missing Wasm export: rd_score');
  assert(typeof wasmExports['rg_semantic_death'] != 'undefined', 'missing Wasm export: rg_semantic_death');
  assert(typeof wasmExports['wr_score'] != 'undefined', 'missing Wasm export: wr_score');
  assert(typeof wasmExports['rg_message_arguments'] != 'undefined', 'missing Wasm export: rg_message_arguments');
  assert(typeof wasmExports['killname'] != 'undefined', 'missing Wasm export: killname');
  assert(typeof wasmExports['addstr'] != 'undefined', 'missing Wasm export: addstr');
  assert(typeof wasmExports['fflush'] != 'undefined', 'missing Wasm export: fflush');
  assert(typeof wasmExports['rg_console_fgets'] != 'undefined', 'missing Wasm export: rg_console_fgets');
  assert(typeof wasmExports['center'] != 'undefined', 'missing Wasm export: center');
  assert(typeof wasmExports['death_monst'] != 'undefined', 'missing Wasm export: death_monst');
  assert(typeof wasmExports['draw_room'] != 'undefined', 'missing Wasm export: draw_room');
  assert(typeof wasmExports['do_maze'] != 'undefined', 'missing Wasm export: do_maze');
  assert(typeof wasmExports['dig'] != 'undefined', 'missing Wasm export: dig');
  assert(typeof wasmExports['vert'] != 'undefined', 'missing Wasm export: vert');
  assert(typeof wasmExports['horiz'] != 'undefined', 'missing Wasm export: horiz');
  assert(typeof wasmExports['accnt_maze'] != 'undefined', 'missing Wasm export: accnt_maze');
  assert(typeof wasmExports['rnd_pos'] != 'undefined', 'missing Wasm export: rnd_pos');
  assert(typeof wasmExports['rg_host_message'] != 'undefined', 'missing Wasm export: rg_host_message');
  assert(typeof wasmExports['encwrite'] != 'undefined', 'missing Wasm export: encwrite');
  assert(typeof wasmExports['encread'] != 'undefined', 'missing Wasm export: encread');
  assert(typeof wasmExports['whatis'] != 'undefined', 'missing Wasm export: whatis');
  assert(typeof wasmExports['uncurse'] != 'undefined', 'missing Wasm export: uncurse');
  assert(typeof wasmExports['rs_write'] != 'undefined', 'missing Wasm export: rs_write');
  assert(typeof wasmExports['rs_read'] != 'undefined', 'missing Wasm export: rs_read');
  assert(typeof wasmExports['rs_write_int'] != 'undefined', 'missing Wasm export: rs_write_int');
  assert(typeof wasmExports['rs_read_int'] != 'undefined', 'missing Wasm export: rs_read_int');
  assert(typeof wasmExports['rs_write_char'] != 'undefined', 'missing Wasm export: rs_write_char');
  assert(typeof wasmExports['rs_read_char'] != 'undefined', 'missing Wasm export: rs_read_char');
  assert(typeof wasmExports['rs_write_chars'] != 'undefined', 'missing Wasm export: rs_write_chars');
  assert(typeof wasmExports['rs_read_chars'] != 'undefined', 'missing Wasm export: rs_read_chars');
  assert(typeof wasmExports['rs_write_ints'] != 'undefined', 'missing Wasm export: rs_write_ints');
  assert(typeof wasmExports['rs_read_ints'] != 'undefined', 'missing Wasm export: rs_read_ints');
  assert(typeof wasmExports['rs_write_boolean'] != 'undefined', 'missing Wasm export: rs_write_boolean');
  assert(typeof wasmExports['rs_read_boolean'] != 'undefined', 'missing Wasm export: rs_read_boolean');
  assert(typeof wasmExports['rs_write_booleans'] != 'undefined', 'missing Wasm export: rs_write_booleans');
  assert(typeof wasmExports['rs_read_booleans'] != 'undefined', 'missing Wasm export: rs_read_booleans');
  assert(typeof wasmExports['rs_write_short'] != 'undefined', 'missing Wasm export: rs_write_short');
  assert(typeof wasmExports['rs_read_short'] != 'undefined', 'missing Wasm export: rs_read_short');
  assert(typeof wasmExports['rs_write_shorts'] != 'undefined', 'missing Wasm export: rs_write_shorts');
  assert(typeof wasmExports['rs_read_shorts'] != 'undefined', 'missing Wasm export: rs_read_shorts');
  assert(typeof wasmExports['rs_write_ushort'] != 'undefined', 'missing Wasm export: rs_write_ushort');
  assert(typeof wasmExports['rs_read_ushort'] != 'undefined', 'missing Wasm export: rs_read_ushort');
  assert(typeof wasmExports['rs_write_uint'] != 'undefined', 'missing Wasm export: rs_write_uint');
  assert(typeof wasmExports['rs_read_uint'] != 'undefined', 'missing Wasm export: rs_read_uint');
  assert(typeof wasmExports['rs_write_marker'] != 'undefined', 'missing Wasm export: rs_write_marker');
  assert(typeof wasmExports['rs_read_marker'] != 'undefined', 'missing Wasm export: rs_read_marker');
  assert(typeof wasmExports['rs_write_string'] != 'undefined', 'missing Wasm export: rs_write_string');
  assert(typeof wasmExports['rs_read_string'] != 'undefined', 'missing Wasm export: rs_read_string');
  assert(typeof wasmExports['rs_read_new_string'] != 'undefined', 'missing Wasm export: rs_read_new_string');
  assert(typeof wasmExports['rs_write_strings'] != 'undefined', 'missing Wasm export: rs_write_strings');
  assert(typeof wasmExports['rs_read_strings'] != 'undefined', 'missing Wasm export: rs_read_strings');
  assert(typeof wasmExports['rs_read_new_strings'] != 'undefined', 'missing Wasm export: rs_read_new_strings');
  assert(typeof wasmExports['rs_write_string_index'] != 'undefined', 'missing Wasm export: rs_write_string_index');
  assert(typeof wasmExports['rs_read_string_index'] != 'undefined', 'missing Wasm export: rs_read_string_index');
  assert(typeof wasmExports['rs_write_str_t'] != 'undefined', 'missing Wasm export: rs_write_str_t');
  assert(typeof wasmExports['rs_read_str_t'] != 'undefined', 'missing Wasm export: rs_read_str_t');
  assert(typeof wasmExports['rs_write_coord'] != 'undefined', 'missing Wasm export: rs_write_coord');
  assert(typeof wasmExports['rs_read_coord'] != 'undefined', 'missing Wasm export: rs_read_coord');
  assert(typeof wasmExports['rs_write_window'] != 'undefined', 'missing Wasm export: rs_write_window');
  assert(typeof wasmExports['mvwinch'] != 'undefined', 'missing Wasm export: mvwinch');
  assert(typeof wasmExports['rs_read_window'] != 'undefined', 'missing Wasm export: rs_read_window');
  assert(typeof wasmExports['mvwaddch'] != 'undefined', 'missing Wasm export: mvwaddch');
  assert(typeof wasmExports['get_list_item'] != 'undefined', 'missing Wasm export: get_list_item');
  assert(typeof wasmExports['find_list_ptr'] != 'undefined', 'missing Wasm export: find_list_ptr');
  assert(typeof wasmExports['list_size'] != 'undefined', 'missing Wasm export: list_size');
  assert(typeof wasmExports['rs_write_stats'] != 'undefined', 'missing Wasm export: rs_write_stats');
  assert(typeof wasmExports['rs_read_stats'] != 'undefined', 'missing Wasm export: rs_read_stats');
  assert(typeof wasmExports['rs_write_stone_index'] != 'undefined', 'missing Wasm export: rs_write_stone_index');
  assert(typeof wasmExports['rs_read_stone_index'] != 'undefined', 'missing Wasm export: rs_read_stone_index');
  assert(typeof wasmExports['rs_write_scrolls'] != 'undefined', 'missing Wasm export: rs_write_scrolls');
  assert(typeof wasmExports['rs_read_scrolls'] != 'undefined', 'missing Wasm export: rs_read_scrolls');
  assert(typeof wasmExports['rs_write_potions'] != 'undefined', 'missing Wasm export: rs_write_potions');
  assert(typeof wasmExports['rs_read_potions'] != 'undefined', 'missing Wasm export: rs_read_potions');
  assert(typeof wasmExports['rs_write_rings'] != 'undefined', 'missing Wasm export: rs_write_rings');
  assert(typeof wasmExports['rs_read_rings'] != 'undefined', 'missing Wasm export: rs_read_rings');
  assert(typeof wasmExports['rs_write_sticks'] != 'undefined', 'missing Wasm export: rs_write_sticks');
  assert(typeof wasmExports['rs_read_sticks'] != 'undefined', 'missing Wasm export: rs_read_sticks');
  assert(typeof wasmExports['rs_write_daemons'] != 'undefined', 'missing Wasm export: rs_write_daemons');
  assert(typeof wasmExports['rs_read_daemons'] != 'undefined', 'missing Wasm export: rs_read_daemons');
  assert(typeof wasmExports['rs_write_obj_info'] != 'undefined', 'missing Wasm export: rs_write_obj_info');
  assert(typeof wasmExports['rs_read_obj_info'] != 'undefined', 'missing Wasm export: rs_read_obj_info');
  assert(typeof wasmExports['rs_write_room'] != 'undefined', 'missing Wasm export: rs_write_room');
  assert(typeof wasmExports['rs_read_room'] != 'undefined', 'missing Wasm export: rs_read_room');
  assert(typeof wasmExports['rs_write_rooms'] != 'undefined', 'missing Wasm export: rs_write_rooms');
  assert(typeof wasmExports['rs_read_rooms'] != 'undefined', 'missing Wasm export: rs_read_rooms');
  assert(typeof wasmExports['rs_write_room_reference'] != 'undefined', 'missing Wasm export: rs_write_room_reference');
  assert(typeof wasmExports['rs_read_room_reference'] != 'undefined', 'missing Wasm export: rs_read_room_reference');
  assert(typeof wasmExports['rs_write_monsters'] != 'undefined', 'missing Wasm export: rs_write_monsters');
  assert(typeof wasmExports['rs_read_monsters'] != 'undefined', 'missing Wasm export: rs_read_monsters');
  assert(typeof wasmExports['rs_write_object'] != 'undefined', 'missing Wasm export: rs_write_object');
  assert(typeof wasmExports['rs_read_object'] != 'undefined', 'missing Wasm export: rs_read_object');
  assert(typeof wasmExports['rs_write_object_list'] != 'undefined', 'missing Wasm export: rs_write_object_list');
  assert(typeof wasmExports['rs_read_object_list'] != 'undefined', 'missing Wasm export: rs_read_object_list');
  assert(typeof wasmExports['rs_write_object_reference'] != 'undefined', 'missing Wasm export: rs_write_object_reference');
  assert(typeof wasmExports['rs_read_object_reference'] != 'undefined', 'missing Wasm export: rs_read_object_reference');
  assert(typeof wasmExports['find_room_coord'] != 'undefined', 'missing Wasm export: find_room_coord');
  assert(typeof wasmExports['find_thing_coord'] != 'undefined', 'missing Wasm export: find_thing_coord');
  assert(typeof wasmExports['find_object_coord'] != 'undefined', 'missing Wasm export: find_object_coord');
  assert(typeof wasmExports['rs_write_thing'] != 'undefined', 'missing Wasm export: rs_write_thing');
  assert(typeof wasmExports['rs_read_thing'] != 'undefined', 'missing Wasm export: rs_read_thing');
  assert(typeof wasmExports['rs_fix_thing'] != 'undefined', 'missing Wasm export: rs_fix_thing');
  assert(typeof wasmExports['rs_write_thing_list'] != 'undefined', 'missing Wasm export: rs_write_thing_list');
  assert(typeof wasmExports['rs_read_thing_list'] != 'undefined', 'missing Wasm export: rs_read_thing_list');
  assert(typeof wasmExports['rs_fix_thing_list'] != 'undefined', 'missing Wasm export: rs_fix_thing_list');
  assert(typeof wasmExports['rs_write_thing_reference'] != 'undefined', 'missing Wasm export: rs_write_thing_reference');
  assert(typeof wasmExports['rs_read_thing_reference'] != 'undefined', 'missing Wasm export: rs_read_thing_reference');
  assert(typeof wasmExports['rs_write_thing_references'] != 'undefined', 'missing Wasm export: rs_write_thing_references');
  assert(typeof wasmExports['rs_read_thing_references'] != 'undefined', 'missing Wasm export: rs_read_thing_references');
  assert(typeof wasmExports['rs_write_places'] != 'undefined', 'missing Wasm export: rs_write_places');
  assert(typeof wasmExports['rs_read_places'] != 'undefined', 'missing Wasm export: rs_read_places');
  assert(typeof wasmExports['rs_save_file'] != 'undefined', 'missing Wasm export: rs_save_file');
  assert(typeof wasmExports['rs_restore_file'] != 'undefined', 'missing Wasm export: rs_restore_file');
  assert(typeof wasmExports['rg_state_save_bytes'] != 'undefined', 'missing Wasm export: rg_state_save_bytes');
  assert(typeof wasmExports['rg_state_load_bytes'] != 'undefined', 'missing Wasm export: rg_state_load_bytes');
  assert(typeof wasmExports['fix_stick'] != 'undefined', 'missing Wasm export: fix_stick');
  assert(typeof wasmExports['drain'] != 'undefined', 'missing Wasm export: drain');
  assert(typeof wasmExports['do_motion'] != 'undefined', 'missing Wasm export: do_motion');
  assert(typeof wasmExports['hit_monster'] != 'undefined', 'missing Wasm export: hit_monster');
  assert(typeof wasmExports['rg_host_map_effect'] != 'undefined', 'missing Wasm export: rg_host_map_effect');
  assert(typeof wasmExports['charge_str'] != 'undefined', 'missing Wasm export: charge_str');
  assert(typeof wasmExports['rg_semantic_item'] != 'undefined', 'missing Wasm export: rg_semantic_item');
  assert(typeof wasmExports['nameit'] != 'undefined', 'missing Wasm export: nameit');
  assert(typeof wasmExports['nullstr'] != 'undefined', 'missing Wasm export: nullstr');
  assert(typeof wasmExports['pick_one'] != 'undefined', 'missing Wasm export: pick_one');
  assert(typeof wasmExports['rg_menu_state_get'] != 'undefined', 'missing Wasm export: rg_menu_state_get');
  assert(typeof wasmExports['rg_menu_state_set'] != 'undefined', 'missing Wasm export: rg_menu_state_set');
  assert(typeof wasmExports['print_disc'] != 'undefined', 'missing Wasm export: print_disc');
  assert(typeof wasmExports['nothing'] != 'undefined', 'missing Wasm export: nothing');
  assert(typeof wasmExports['newwin'] != 'undefined', 'missing Wasm export: newwin');
  assert(typeof wasmExports['subwin'] != 'undefined', 'missing Wasm export: subwin');
  assert(typeof wasmExports['mvwin'] != 'undefined', 'missing Wasm export: mvwin');
  assert(typeof wasmExports['werase'] != 'undefined', 'missing Wasm export: werase');
  assert(typeof wasmExports['set_order'] != 'undefined', 'missing Wasm export: set_order');
  assert(typeof wasmExports['type_name'] != 'undefined', 'missing Wasm export: type_name');
  assert(typeof wasmExports['set_know'] != 'undefined', 'missing Wasm export: set_know');
  assert(typeof wasmExports['xntohl'] != 'undefined', 'missing Wasm export: xntohl');
  assert(typeof wasmExports['xhtonl'] != 'undefined', 'missing Wasm export: xhtonl');
  assert(typeof wasmExports['xcrypt'] != 'undefined', 'missing Wasm export: xcrypt');
  assert(typeof wasmExports['rg_core_turn'] != 'undefined', 'missing Wasm export: rg_core_turn');
  assert(typeof wasmExports['rg_core_set_turn'] != 'undefined', 'missing Wasm export: rg_core_set_turn');
  assert(typeof wasmExports['rg_core_pending'] != 'undefined', 'missing Wasm export: rg_core_pending');
  assert(typeof wasmExports['rg_knowledge_present'] != 'undefined', 'missing Wasm export: rg_knowledge_present');
  assert(typeof wasmExports['rg_host_outcome'] != 'undefined', 'missing Wasm export: rg_host_outcome');
  assert(typeof wasmExports['rg_core_start'] != 'undefined', 'missing Wasm export: rg_core_start');
  assert(typeof wasmExports['initscr'] != 'undefined', 'missing Wasm export: initscr');
  assert(typeof wasmExports['rg_host_restore_data'] != 'undefined', 'missing Wasm export: rg_host_restore_data');
  assert(typeof wasmExports['rg_core_load_bytes'] != 'undefined', 'missing Wasm export: rg_core_load_bytes');
  assert(typeof wasmExports['rg_core_runtime_export'] != 'undefined', 'missing Wasm export: rg_core_runtime_export');
  assert(typeof wasmExports['rg_core_runtime_validate'] != 'undefined', 'missing Wasm export: rg_core_runtime_validate');
  assert(typeof wasmExports['rg_core_runtime_import'] != 'undefined', 'missing Wasm export: rg_core_runtime_import');
  assert(typeof wasmExports['rg_core_inspect'] != 'undefined', 'missing Wasm export: rg_core_inspect');
  assert(typeof wasmExports['rg_knowledge_cells'] != 'undefined', 'missing Wasm export: rg_knowledge_cells');
  assert(typeof wasmExports['rg_console_getchar'] != 'undefined', 'missing Wasm export: rg_console_getchar');
  assert(typeof wasmExports['erase'] != 'undefined', 'missing Wasm export: erase');
  assert(typeof wasmExports['mvwaddstr'] != 'undefined', 'missing Wasm export: mvwaddstr');
  assert(typeof wasmExports['winch'] != 'undefined', 'missing Wasm export: winch');
  assert(typeof wasmExports['wstandout'] != 'undefined', 'missing Wasm export: wstandout');
  assert(typeof wasmExports['wstandend'] != 'undefined', 'missing Wasm export: wstandend');
  assert(typeof wasmExports['rg_knowledge_view'] != 'undefined', 'missing Wasm export: rg_knowledge_view');
  assert(typeof wasmExports['rg_semantic_map_terrain'] != 'undefined', 'missing Wasm export: rg_semantic_map_terrain');
  assert(typeof wasmExports['rg_host_present'] != 'undefined', 'missing Wasm export: rg_host_present');
  assert(typeof wasmExports['idlok'] != 'undefined', 'missing Wasm export: idlok');
  assert(typeof wasmExports['keypad'] != 'undefined', 'missing Wasm export: keypad');
  assert(typeof wasmExports['raw'] != 'undefined', 'missing Wasm export: raw');
  assert(typeof wasmExports['noecho'] != 'undefined', 'missing Wasm export: noecho');
  assert(typeof wasmExports['rg_host_read_key'] != 'undefined', 'missing Wasm export: rg_host_read_key');
  assert(typeof wasmExports['wgetch'] != 'undefined', 'missing Wasm export: wgetch');
  assert(typeof wasmExports['rg_host_flush_input'] != 'undefined', 'missing Wasm export: rg_host_flush_input');
  assert(typeof wasmExports['rg_knowledge_export'] != 'undefined', 'missing Wasm export: rg_knowledge_export');
  assert(typeof wasmExports['rg_knowledge_validate'] != 'undefined', 'missing Wasm export: rg_knowledge_validate');
  assert(typeof wasmExports['rg_knowledge_import'] != 'undefined', 'missing Wasm export: rg_knowledge_import');
  assert(typeof wasmExports['rg_semantic_argument'] != 'undefined', 'missing Wasm export: rg_semantic_argument');
  assert(typeof wasmExports['__trunctfdf2'] != 'undefined', 'missing Wasm export: __trunctfdf2');
  assert(typeof wasmExports['rg_host_ui'] != 'undefined', 'missing Wasm export: rg_host_ui');
  assert(typeof wasmExports['rg_core_save_bytes'] != 'undefined', 'missing Wasm export: rg_core_save_bytes');
  assert(typeof wasmExports['rg_core_save_free'] != 'undefined', 'missing Wasm export: rg_core_save_free');
  assert(typeof wasmExports['rg_host_map_terrain'] != 'undefined', 'missing Wasm export: rg_host_map_terrain');
  assert(typeof wasmExports['rg_semantic_category'] != 'undefined', 'missing Wasm export: rg_semantic_category');
  assert(typeof wasmExports['memcmp'] != 'undefined', 'missing Wasm export: memcmp');
  assert(typeof wasmExports['rg_run'] != 'undefined', 'missing Wasm export: rg_run');
  assert(typeof wasmExports['rg_snapshot_json'] != 'undefined', 'missing Wasm export: rg_snapshot_json');
  assert(typeof wasmExports['rg_string_free'] != 'undefined', 'missing Wasm export: rg_string_free');
  assert(typeof wasmExports['rg_validate_envelope'] != 'undefined', 'missing Wasm export: rg_validate_envelope');
  assert(typeof wasmExports['__lshrti3'] != 'undefined', 'missing Wasm export: __lshrti3');
  assert(typeof wasmExports['__multi3'] != 'undefined', 'missing Wasm export: __multi3');
  assert(typeof wasmExports['__powidf2'] != 'undefined', 'missing Wasm export: __powidf2');
  assert(typeof wasmExports['round'] != 'undefined', 'missing Wasm export: round');
  assert(typeof wasmExports['__ashlti3'] != 'undefined', 'missing Wasm export: __ashlti3');
  assert(typeof wasmExports['__udivti3'] != 'undefined', 'missing Wasm export: __udivti3');
  assert(typeof wasmExports['__divti3'] != 'undefined', 'missing Wasm export: __divti3');
  assert(typeof wasmExports['fmod'] != 'undefined', 'missing Wasm export: fmod');
  assert(typeof wasmExports['fmodf'] != 'undefined', 'missing Wasm export: fmodf');
  assert(typeof wasmExports['__modti3'] != 'undefined', 'missing Wasm export: __modti3');
  assert(typeof wasmExports['__umodti3'] != 'undefined', 'missing Wasm export: __umodti3');
  assert(typeof wasmExports['rust_eh_personality'] != 'undefined', 'missing Wasm export: rust_eh_personality');
  assert(typeof wasmExports['__truncsfhf2'] != 'undefined', 'missing Wasm export: __truncsfhf2');
  assert(typeof wasmExports['__extendhfsf2'] != 'undefined', 'missing Wasm export: __extendhfsf2');
  assert(typeof wasmExports['__muloti4'] != 'undefined', 'missing Wasm export: __muloti4');
  assert(typeof wasmExports['fmaf128'] != 'undefined', 'missing Wasm export: fmaf128');
  assert(typeof wasmExports['sqrtf128'] != 'undefined', 'missing Wasm export: sqrtf128');
  assert(typeof wasmExports['sqrtf16'] != 'undefined', 'missing Wasm export: sqrtf16');
  assert(typeof wasmExports['fmodf128'] != 'undefined', 'missing Wasm export: fmodf128');
  assert(typeof wasmExports['fmodf16'] != 'undefined', 'missing Wasm export: fmodf16');
  assert(typeof wasmExports['ceilf128'] != 'undefined', 'missing Wasm export: ceilf128');
  assert(typeof wasmExports['ceilf16'] != 'undefined', 'missing Wasm export: ceilf16');
  assert(typeof wasmExports['floorf128'] != 'undefined', 'missing Wasm export: floorf128');
  assert(typeof wasmExports['floorf16'] != 'undefined', 'missing Wasm export: floorf16');
  assert(typeof wasmExports['roundf16'] != 'undefined', 'missing Wasm export: roundf16');
  assert(typeof wasmExports['roundf128'] != 'undefined', 'missing Wasm export: roundf128');
  assert(typeof wasmExports['rintf128'] != 'undefined', 'missing Wasm export: rintf128');
  assert(typeof wasmExports['roundevenf128'] != 'undefined', 'missing Wasm export: roundevenf128');
  assert(typeof wasmExports['rintf16'] != 'undefined', 'missing Wasm export: rintf16');
  assert(typeof wasmExports['roundevenf16'] != 'undefined', 'missing Wasm export: roundevenf16');
  assert(typeof wasmExports['truncf128'] != 'undefined', 'missing Wasm export: truncf128');
  assert(typeof wasmExports['truncf16'] != 'undefined', 'missing Wasm export: truncf16');
  assert(typeof wasmExports['fmaximum_numf16'] != 'undefined', 'missing Wasm export: fmaximum_numf16');
  assert(typeof wasmExports['fminimum_numf128'] != 'undefined', 'missing Wasm export: fminimum_numf128');
  assert(typeof wasmExports['fmaximum_numf128'] != 'undefined', 'missing Wasm export: fmaximum_numf128');
  assert(typeof wasmExports['fminimum_numf16'] != 'undefined', 'missing Wasm export: fminimum_numf16');
  assert(typeof wasmExports['fminimumf128'] != 'undefined', 'missing Wasm export: fminimumf128');
  assert(typeof wasmExports['fminimumf16'] != 'undefined', 'missing Wasm export: fminimumf16');
  assert(typeof wasmExports['fmaximumf128'] != 'undefined', 'missing Wasm export: fmaximumf128');
  assert(typeof wasmExports['fmaximumf16'] != 'undefined', 'missing Wasm export: fmaximumf16');
  assert(typeof wasmExports['copysignf16'] != 'undefined', 'missing Wasm export: copysignf16');
  assert(typeof wasmExports['copysignf128'] != 'undefined', 'missing Wasm export: copysignf128');
  assert(typeof wasmExports['fmaxf128'] != 'undefined', 'missing Wasm export: fmaxf128');
  assert(typeof wasmExports['fminf16'] != 'undefined', 'missing Wasm export: fminf16');
  assert(typeof wasmExports['fminf128'] != 'undefined', 'missing Wasm export: fminf128');
  assert(typeof wasmExports['fmaxf16'] != 'undefined', 'missing Wasm export: fmaxf16');
  assert(typeof wasmExports['__floatunsitf'] != 'undefined', 'missing Wasm export: __floatunsitf');
  assert(typeof wasmExports['__floatunsidf'] != 'undefined', 'missing Wasm export: __floatunsidf');
  assert(typeof wasmExports['__floatunditf'] != 'undefined', 'missing Wasm export: __floatunditf');
  assert(typeof wasmExports['__eqtf2'] != 'undefined', 'missing Wasm export: __eqtf2');
  assert(typeof wasmExports['__gehf2'] != 'undefined', 'missing Wasm export: __gehf2');
  assert(typeof wasmExports['__eqhf2'] != 'undefined', 'missing Wasm export: __eqhf2');
  assert(typeof wasmExports['__nehf2'] != 'undefined', 'missing Wasm export: __nehf2');
  assert(typeof wasmExports['__netf2'] != 'undefined', 'missing Wasm export: __netf2');
  assert(typeof wasmExports['__lthf2'] != 'undefined', 'missing Wasm export: __lthf2');
  assert(typeof wasmExports['__lttf2'] != 'undefined', 'missing Wasm export: __lttf2');
  assert(typeof wasmExports['__lehf2'] != 'undefined', 'missing Wasm export: __lehf2');
  assert(typeof wasmExports['__letf2'] != 'undefined', 'missing Wasm export: __letf2');
  assert(typeof wasmExports['__gttf2'] != 'undefined', 'missing Wasm export: __gttf2');
  assert(typeof wasmExports['__gthf2'] != 'undefined', 'missing Wasm export: __gthf2');
  assert(typeof wasmExports['__getf2'] != 'undefined', 'missing Wasm export: __getf2');
  assert(typeof wasmExports['fdimf'] != 'undefined', 'missing Wasm export: fdimf');
  assert(typeof wasmExports['fdimf16'] != 'undefined', 'missing Wasm export: fdimf16');
  assert(typeof wasmExports['fdim'] != 'undefined', 'missing Wasm export: fdim');
  assert(typeof wasmExports['fdimf128'] != 'undefined', 'missing Wasm export: fdimf128');
  assert(typeof wasmExports['__subtf3'] != 'undefined', 'missing Wasm export: __subtf3');
  assert(typeof wasmExports['__subhf3'] != 'undefined', 'missing Wasm export: __subhf3');
  assert(typeof wasmExports['fabsf16'] != 'undefined', 'missing Wasm export: fabsf16');
  assert(typeof wasmExports['fabsf128'] != 'undefined', 'missing Wasm export: fabsf128');
  assert(typeof wasmExports['__unordtf2'] != 'undefined', 'missing Wasm export: __unordtf2');
  assert(typeof wasmExports['__unordhf2'] != 'undefined', 'missing Wasm export: __unordhf2');
  assert(typeof wasmExports['__floatuntitf'] != 'undefined', 'missing Wasm export: __floatuntitf');
  assert(typeof wasmExports['__fixunstfdi'] != 'undefined', 'missing Wasm export: __fixunstfdi');
  assert(typeof wasmExports['__fixunstfti'] != 'undefined', 'missing Wasm export: __fixunstfti');
  assert(typeof wasmExports['__fixunstfsi'] != 'undefined', 'missing Wasm export: __fixunstfsi');
  assert(typeof wasmExports['__udivmodsi4'] != 'undefined', 'missing Wasm export: __udivmodsi4');
  assert(typeof wasmExports['__eqdf2'] != 'undefined', 'missing Wasm export: __eqdf2');
  assert(typeof wasmExports['trunc'] != 'undefined', 'missing Wasm export: trunc');
  assert(typeof wasmExports['__divtf3'] != 'undefined', 'missing Wasm export: __divtf3');
  assert(typeof wasmExports['__truncdfsf2'] != 'undefined', 'missing Wasm export: __truncdfsf2');
  assert(typeof wasmExports['truncf'] != 'undefined', 'missing Wasm export: truncf');
  assert(typeof wasmExports['__umodsi3'] != 'undefined', 'missing Wasm export: __umodsi3');
  assert(typeof wasmExports['__truncdfhf2'] != 'undefined', 'missing Wasm export: __truncdfhf2');
  assert(typeof wasmExports['__fixunsdfti'] != 'undefined', 'missing Wasm export: __fixunsdfti');
  assert(typeof wasmExports['__trunctfhf2'] != 'undefined', 'missing Wasm export: __trunctfhf2');
  assert(typeof wasmExports['__floattitf'] != 'undefined', 'missing Wasm export: __floattitf');
  assert(typeof wasmExports['__gedf2'] != 'undefined', 'missing Wasm export: __gedf2');
  assert(typeof wasmExports['__divmoddi4'] != 'undefined', 'missing Wasm export: __divmoddi4');
  assert(typeof wasmExports['fmaximum_numf'] != 'undefined', 'missing Wasm export: fmaximum_numf');
  assert(typeof wasmExports['cbrt'] != 'undefined', 'missing Wasm export: cbrt');
  assert(typeof wasmExports['__moddi3'] != 'undefined', 'missing Wasm export: __moddi3');
  assert(typeof wasmExports['__lshrdi3'] != 'undefined', 'missing Wasm export: __lshrdi3');
  assert(typeof wasmExports['__fixdfdi'] != 'undefined', 'missing Wasm export: __fixdfdi');
  assert(typeof wasmExports['__subdf3'] != 'undefined', 'missing Wasm export: __subdf3');
  assert(typeof wasmExports['__fixunssfdi'] != 'undefined', 'missing Wasm export: __fixunssfdi');
  assert(typeof wasmExports['floor'] != 'undefined', 'missing Wasm export: floor');
  assert(typeof wasmExports['__fixunsdfdi'] != 'undefined', 'missing Wasm export: __fixunsdfdi');
  assert(typeof wasmExports['__rust_i128_add'] != 'undefined', 'missing Wasm export: __rust_i128_add');
  assert(typeof wasmExports['__floatuntisf'] != 'undefined', 'missing Wasm export: __floatuntisf');
  assert(typeof wasmExports['__extendhftf2'] != 'undefined', 'missing Wasm export: __extendhftf2');
  assert(typeof wasmExports['__divmodsi4'] != 'undefined', 'missing Wasm export: __divmodsi4');
  assert(typeof wasmExports['fmaximum_num'] != 'undefined', 'missing Wasm export: fmaximum_num');
  assert(typeof wasmExports['__ashrdi3'] != 'undefined', 'missing Wasm export: __ashrdi3');
  assert(typeof wasmExports['__mulsf3'] != 'undefined', 'missing Wasm export: __mulsf3');
  assert(typeof wasmExports['fmaximum'] != 'undefined', 'missing Wasm export: fmaximum');
  assert(typeof wasmExports['__addsf3'] != 'undefined', 'missing Wasm export: __addsf3');
  assert(typeof wasmExports['rint'] != 'undefined', 'missing Wasm export: rint');
  assert(typeof wasmExports['__udivdi3'] != 'undefined', 'missing Wasm export: __udivdi3');
  assert(typeof wasmExports['__ashrti3'] != 'undefined', 'missing Wasm export: __ashrti3');
  assert(typeof wasmExports['memset'] != 'undefined', 'missing Wasm export: memset');
  assert(typeof wasmExports['cbrtf'] != 'undefined', 'missing Wasm export: cbrtf');
  assert(typeof wasmExports['__mulodi4'] != 'undefined', 'missing Wasm export: __mulodi4');
  assert(typeof wasmExports['__fixunsdfsi'] != 'undefined', 'missing Wasm export: __fixunsdfsi');
  assert(typeof wasmExports['__divdi3'] != 'undefined', 'missing Wasm export: __divdi3');
  assert(typeof wasmExports['__fixtfti'] != 'undefined', 'missing Wasm export: __fixtfti');
  assert(typeof wasmExports['__rust_u128_addo'] != 'undefined', 'missing Wasm export: __rust_u128_addo');
  assert(typeof wasmExports['__extendhfdf2'] != 'undefined', 'missing Wasm export: __extendhfdf2');
  assert(typeof wasmExports['__trunctfsf2'] != 'undefined', 'missing Wasm export: __trunctfsf2');
  assert(typeof wasmExports['fminimum_numf'] != 'undefined', 'missing Wasm export: fminimum_numf');
  assert(typeof wasmExports['fminimum'] != 'undefined', 'missing Wasm export: fminimum');
  assert(typeof wasmExports['__adddf3'] != 'undefined', 'missing Wasm export: __adddf3');
  assert(typeof wasmExports['__fixsfdi'] != 'undefined', 'missing Wasm export: __fixsfdi');
  assert(typeof wasmExports['__rust_i128_sub'] != 'undefined', 'missing Wasm export: __rust_i128_sub');
  assert(typeof wasmExports['__floatsitf'] != 'undefined', 'missing Wasm export: __floatsitf');
  assert(typeof wasmExports['__fixunssfti'] != 'undefined', 'missing Wasm export: __fixunssfti');
  assert(typeof wasmExports['sqrt'] != 'undefined', 'missing Wasm export: sqrt');
  assert(typeof wasmExports['__bswapsi2'] != 'undefined', 'missing Wasm export: __bswapsi2');
  assert(typeof wasmExports['__clzti2'] != 'undefined', 'missing Wasm export: __clzti2');
  assert(typeof wasmExports['__gesf2'] != 'undefined', 'missing Wasm export: __gesf2');
  assert(typeof wasmExports['__floatditf'] != 'undefined', 'missing Wasm export: __floatditf');
  assert(typeof wasmExports['fmin'] != 'undefined', 'missing Wasm export: fmin');
  assert(typeof wasmExports['fmax'] != 'undefined', 'missing Wasm export: fmax');
  assert(typeof wasmExports['__ltdf2'] != 'undefined', 'missing Wasm export: __ltdf2');
  assert(typeof wasmExports['__nesf2'] != 'undefined', 'missing Wasm export: __nesf2');
  assert(typeof wasmExports['__ashlsi3'] != 'undefined', 'missing Wasm export: __ashlsi3');
  assert(typeof wasmExports['ceil'] != 'undefined', 'missing Wasm export: ceil');
  assert(typeof wasmExports['sqrtf'] != 'undefined', 'missing Wasm export: sqrtf');
  assert(typeof wasmExports['__addhf3'] != 'undefined', 'missing Wasm export: __addhf3');
  assert(typeof wasmExports['fminimumf'] != 'undefined', 'missing Wasm export: fminimumf');
  assert(typeof wasmExports['__ashrsi3'] != 'undefined', 'missing Wasm export: __ashrsi3');
  assert(typeof wasmExports['fabsf'] != 'undefined', 'missing Wasm export: fabsf');
  assert(typeof wasmExports['__floatdidf'] != 'undefined', 'missing Wasm export: __floatdidf');
  assert(typeof wasmExports['__gtdf2'] != 'undefined', 'missing Wasm export: __gtdf2');
  assert(typeof wasmExports['__multf3'] != 'undefined', 'missing Wasm export: __multf3');
  assert(typeof wasmExports['__addtf3'] != 'undefined', 'missing Wasm export: __addtf3');
  assert(typeof wasmExports['__fixsfti'] != 'undefined', 'missing Wasm export: __fixsfti');
  assert(typeof wasmExports['__ctzti2'] != 'undefined', 'missing Wasm export: __ctzti2');
  assert(typeof wasmExports['__subsf3'] != 'undefined', 'missing Wasm export: __subsf3');
  assert(typeof wasmExports['__floatdisf'] != 'undefined', 'missing Wasm export: __floatdisf');
  assert(typeof wasmExports['fminf'] != 'undefined', 'missing Wasm export: fminf');
  assert(typeof wasmExports['__udivsi3'] != 'undefined', 'missing Wasm export: __udivsi3');
  assert(typeof wasmExports['__mulhf3'] != 'undefined', 'missing Wasm export: __mulhf3');
  assert(typeof wasmExports['__muldi3'] != 'undefined', 'missing Wasm export: __muldi3');
  assert(typeof wasmExports['__extendsftf2'] != 'undefined', 'missing Wasm export: __extendsftf2');
  assert(typeof wasmExports['__eqsf2'] != 'undefined', 'missing Wasm export: __eqsf2');
  assert(typeof wasmExports['__mulosi4'] != 'undefined', 'missing Wasm export: __mulosi4');
  assert(typeof wasmExports['bcmp'] != 'undefined', 'missing Wasm export: bcmp');
  assert(typeof wasmExports['__rust_u128_subo'] != 'undefined', 'missing Wasm export: __rust_u128_subo');
  assert(typeof wasmExports['__floatsisf'] != 'undefined', 'missing Wasm export: __floatsisf');
  assert(typeof wasmExports['__powitf2'] != 'undefined', 'missing Wasm export: __powitf2');
  assert(typeof wasmExports['__umoddi3'] != 'undefined', 'missing Wasm export: __umoddi3');
  assert(typeof wasmExports['__fixtfsi'] != 'undefined', 'missing Wasm export: __fixtfsi');
  assert(typeof wasmExports['__rust_u128_add'] != 'undefined', 'missing Wasm export: __rust_u128_add');
  assert(typeof wasmExports['fminimum_num'] != 'undefined', 'missing Wasm export: fminimum_num');
  assert(typeof wasmExports['__divmodti4'] != 'undefined', 'missing Wasm export: __divmodti4');
  assert(typeof wasmExports['__lesf2'] != 'undefined', 'missing Wasm export: __lesf2');
  assert(typeof wasmExports['memmove'] != 'undefined', 'missing Wasm export: memmove');
  assert(typeof wasmExports['__fixdfti'] != 'undefined', 'missing Wasm export: __fixdfti');
  assert(typeof wasmExports['__udivmoddi4'] != 'undefined', 'missing Wasm export: __udivmoddi4');
  assert(typeof wasmExports['__floatunsisf'] != 'undefined', 'missing Wasm export: __floatunsisf');
  assert(typeof wasmExports['__unordsf2'] != 'undefined', 'missing Wasm export: __unordsf2');
  assert(typeof wasmExports['__rust_u128_mulo'] != 'undefined', 'missing Wasm export: __rust_u128_mulo');
  assert(typeof wasmExports['fma'] != 'undefined', 'missing Wasm export: fma');
  assert(typeof wasmExports['rintf'] != 'undefined', 'missing Wasm export: rintf');
  assert(typeof wasmExports['copysignf'] != 'undefined', 'missing Wasm export: copysignf');
  assert(typeof wasmExports['__divsf3'] != 'undefined', 'missing Wasm export: __divsf3');
  assert(typeof wasmExports['__ashldi3'] != 'undefined', 'missing Wasm export: __ashldi3');
  assert(typeof wasmExports['fmaxf'] != 'undefined', 'missing Wasm export: fmaxf');
  assert(typeof wasmExports['__gnu_f2h_ieee'] != 'undefined', 'missing Wasm export: __gnu_f2h_ieee');
  assert(typeof wasmExports['__fixsfsi'] != 'undefined', 'missing Wasm export: __fixsfsi');
  assert(typeof wasmExports['__muldf3'] != 'undefined', 'missing Wasm export: __muldf3');
  assert(typeof wasmExports['__fixunssfsi'] != 'undefined', 'missing Wasm export: __fixunssfsi');
  assert(typeof wasmExports['memcpy'] != 'undefined', 'missing Wasm export: memcpy');
  assert(typeof wasmExports['__fixtfdi'] != 'undefined', 'missing Wasm export: __fixtfdi');
  assert(typeof wasmExports['ceilf'] != 'undefined', 'missing Wasm export: ceilf');
  assert(typeof wasmExports['__extenddftf2'] != 'undefined', 'missing Wasm export: __extenddftf2');
  assert(typeof wasmExports['__ctzdi2'] != 'undefined', 'missing Wasm export: __ctzdi2');
  assert(typeof wasmExports['__ledf2'] != 'undefined', 'missing Wasm export: __ledf2');
  assert(typeof wasmExports['__lshrsi3'] != 'undefined', 'missing Wasm export: __lshrsi3');
  assert(typeof wasmExports['__clzsi2'] != 'undefined', 'missing Wasm export: __clzsi2');
  assert(typeof wasmExports['__rust_u128_sub'] != 'undefined', 'missing Wasm export: __rust_u128_sub');
  assert(typeof wasmExports['__floattidf'] != 'undefined', 'missing Wasm export: __floattidf');
  assert(typeof wasmExports['fmaf'] != 'undefined', 'missing Wasm export: fmaf');
  assert(typeof wasmExports['__extendsfdf2'] != 'undefined', 'missing Wasm export: __extendsfdf2');
  assert(typeof wasmExports['__floatuntidf'] != 'undefined', 'missing Wasm export: __floatuntidf');
  assert(typeof wasmExports['__nedf2'] != 'undefined', 'missing Wasm export: __nedf2');
  assert(typeof wasmExports['__ltsf2'] != 'undefined', 'missing Wasm export: __ltsf2');
  assert(typeof wasmExports['__rust_i128_mulo'] != 'undefined', 'missing Wasm export: __rust_i128_mulo');
  assert(typeof wasmExports['floorf'] != 'undefined', 'missing Wasm export: floorf');
  assert(typeof wasmExports['__fixdfsi'] != 'undefined', 'missing Wasm export: __fixdfsi');
  assert(typeof wasmExports['__floatsidf'] != 'undefined', 'missing Wasm export: __floatsidf');
  assert(typeof wasmExports['__modsi3'] != 'undefined', 'missing Wasm export: __modsi3');
  assert(typeof wasmExports['__powisf2'] != 'undefined', 'missing Wasm export: __powisf2');
  assert(typeof wasmExports['__divsi3'] != 'undefined', 'missing Wasm export: __divsi3');
  assert(typeof wasmExports['roundf'] != 'undefined', 'missing Wasm export: roundf');
  assert(typeof wasmExports['__divdf3'] != 'undefined', 'missing Wasm export: __divdf3');
  assert(typeof wasmExports['__floatundisf'] != 'undefined', 'missing Wasm export: __floatundisf');
  assert(typeof wasmExports['fabs'] != 'undefined', 'missing Wasm export: fabs');
  assert(typeof wasmExports['__rust_i128_subo'] != 'undefined', 'missing Wasm export: __rust_i128_subo');
  assert(typeof wasmExports['fmaximumf'] != 'undefined', 'missing Wasm export: fmaximumf');
  assert(typeof wasmExports['__floattisf'] != 'undefined', 'missing Wasm export: __floattisf');
  assert(typeof wasmExports['__ctzsi2'] != 'undefined', 'missing Wasm export: __ctzsi2');
  assert(typeof wasmExports['roundeven'] != 'undefined', 'missing Wasm export: roundeven');
  assert(typeof wasmExports['__gtsf2'] != 'undefined', 'missing Wasm export: __gtsf2');
  assert(typeof wasmExports['__rust_i128_addo'] != 'undefined', 'missing Wasm export: __rust_i128_addo');
  assert(typeof wasmExports['roundevenf'] != 'undefined', 'missing Wasm export: roundevenf');
  assert(typeof wasmExports['__floatundidf'] != 'undefined', 'missing Wasm export: __floatundidf');
  assert(typeof wasmExports['__bswapdi2'] != 'undefined', 'missing Wasm export: __bswapdi2');
  assert(typeof wasmExports['__clzdi2'] != 'undefined', 'missing Wasm export: __clzdi2');
  assert(typeof wasmExports['__gnu_h2f_ieee'] != 'undefined', 'missing Wasm export: __gnu_h2f_ieee');
  assert(typeof wasmExports['__unorddf2'] != 'undefined', 'missing Wasm export: __unorddf2');
  assert(typeof wasmExports['__bswapti2'] != 'undefined', 'missing Wasm export: __bswapti2');
  assert(typeof wasmExports['__udivmodti4'] != 'undefined', 'missing Wasm export: __udivmodti4');
  assert(typeof wasmExports['copysign'] != 'undefined', 'missing Wasm export: copysign');
  assert(typeof wasmExports['emscripten_stack_get_end'] != 'undefined', 'missing Wasm export: emscripten_stack_get_end');
  assert(typeof wasmExports['emscripten_stack_get_base'] != 'undefined', 'missing Wasm export: emscripten_stack_get_base');
  assert(typeof wasmExports['htonl'] != 'undefined', 'missing Wasm export: htonl');
  assert(typeof wasmExports['htons'] != 'undefined', 'missing Wasm export: htons');
  assert(typeof wasmExports['ntohs'] != 'undefined', 'missing Wasm export: ntohs');
  assert(typeof wasmExports['_emscripten_timeout'] != 'undefined', 'missing Wasm export: _emscripten_timeout');
  assert(typeof wasmExports['strerror'] != 'undefined', 'missing Wasm export: strerror');
  assert(typeof wasmExports['setThrew'] != 'undefined', 'missing Wasm export: setThrew');
  assert(typeof wasmExports['emscripten_stack_init'] != 'undefined', 'missing Wasm export: emscripten_stack_init');
  assert(typeof wasmExports['emscripten_stack_get_free'] != 'undefined', 'missing Wasm export: emscripten_stack_get_free');
  assert(typeof wasmExports['_emscripten_stack_restore'] != 'undefined', 'missing Wasm export: _emscripten_stack_restore');
  assert(typeof wasmExports['_emscripten_stack_alloc'] != 'undefined', 'missing Wasm export: _emscripten_stack_alloc');
  assert(typeof wasmExports['emscripten_stack_get_current'] != 'undefined', 'missing Wasm export: emscripten_stack_get_current');
  assert(typeof wasmExports['__wbindgen_start'] != 'undefined', 'missing Wasm export: __wbindgen_start');
  assert(typeof wasmExports['memory'] != 'undefined', 'missing Wasm export: memory');
  assert(typeof wasmExports['release'] != 'undefined', 'missing Wasm export: release');
  assert(typeof wasmExports['encstr'] != 'undefined', 'missing Wasm export: encstr');
  assert(typeof wasmExports['statlist'] != 'undefined', 'missing Wasm export: statlist');
  assert(typeof wasmExports['version'] != 'undefined', 'missing Wasm export: version');
  assert(typeof wasmExports['amulet'] != 'undefined', 'missing Wasm export: amulet');
  assert(typeof wasmExports['door_stop'] != 'undefined', 'missing Wasm export: door_stop');
  assert(typeof wasmExports['fight_flush'] != 'undefined', 'missing Wasm export: fight_flush');
  assert(typeof wasmExports['firstmove'] != 'undefined', 'missing Wasm export: firstmove');
  assert(typeof wasmExports['got_ltc'] != 'undefined', 'missing Wasm export: got_ltc');
  assert(typeof wasmExports['has_hit'] != 'undefined', 'missing Wasm export: has_hit');
  assert(typeof wasmExports['in_shell'] != 'undefined', 'missing Wasm export: in_shell');
  assert(typeof wasmExports['inv_describe'] != 'undefined', 'missing Wasm export: inv_describe');
  assert(typeof wasmExports['jump'] != 'undefined', 'missing Wasm export: jump');
  assert(typeof wasmExports['kamikaze'] != 'undefined', 'missing Wasm export: kamikaze');
  assert(typeof wasmExports['lower_msg'] != 'undefined', 'missing Wasm export: lower_msg');
  assert(typeof wasmExports['move_on'] != 'undefined', 'missing Wasm export: move_on');
  assert(typeof wasmExports['msg_esc'] != 'undefined', 'missing Wasm export: msg_esc');
  assert(typeof wasmExports['passgo'] != 'undefined', 'missing Wasm export: passgo');
  assert(typeof wasmExports['playing'] != 'undefined', 'missing Wasm export: playing');
  assert(typeof wasmExports['q_comm'] != 'undefined', 'missing Wasm export: q_comm');
  assert(typeof wasmExports['running'] != 'undefined', 'missing Wasm export: running');
  assert(typeof wasmExports['save_msg'] != 'undefined', 'missing Wasm export: save_msg');
  assert(typeof wasmExports['see_floor'] != 'undefined', 'missing Wasm export: see_floor');
  assert(typeof wasmExports['stat_msg'] != 'undefined', 'missing Wasm export: stat_msg');
  assert(typeof wasmExports['terse'] != 'undefined', 'missing Wasm export: terse');
  assert(typeof wasmExports['to_death'] != 'undefined', 'missing Wasm export: to_death');
  assert(typeof wasmExports['tombstone'] != 'undefined', 'missing Wasm export: tombstone');
  assert(typeof wasmExports['pack_used'] != 'undefined', 'missing Wasm export: pack_used');
  assert(typeof wasmExports['fruit'] != 'undefined', 'missing Wasm export: fruit');
  assert(typeof wasmExports['home'] != 'undefined', 'missing Wasm export: home');
  assert(typeof wasmExports['inv_t_name'] != 'undefined', 'missing Wasm export: inv_t_name');
  assert(typeof wasmExports['l_last_comm'] != 'undefined', 'missing Wasm export: l_last_comm');
  assert(typeof wasmExports['l_last_dir'] != 'undefined', 'missing Wasm export: l_last_dir');
  assert(typeof wasmExports['last_comm'] != 'undefined', 'missing Wasm export: last_comm');
  assert(typeof wasmExports['last_dir'] != 'undefined', 'missing Wasm export: last_dir');
  assert(typeof wasmExports['tr_name'] != 'undefined', 'missing Wasm export: tr_name');
  assert(typeof wasmExports['hungry_state'] != 'undefined', 'missing Wasm export: hungry_state');
  assert(typeof wasmExports['inpack'] != 'undefined', 'missing Wasm export: inpack');
  assert(typeof wasmExports['inv_type'] != 'undefined', 'missing Wasm export: inv_type');
  assert(typeof wasmExports['level'] != 'undefined', 'missing Wasm export: level');
  assert(typeof wasmExports['mpos'] != 'undefined', 'missing Wasm export: mpos');
  assert(typeof wasmExports['no_food'] != 'undefined', 'missing Wasm export: no_food');
  assert(typeof wasmExports['a_class'] != 'undefined', 'missing Wasm export: a_class');
  assert(typeof wasmExports['count'] != 'undefined', 'missing Wasm export: count');
  assert(typeof wasmExports['scoreboard'] != 'undefined', 'missing Wasm export: scoreboard');
  assert(typeof wasmExports['lastscore'] != 'undefined', 'missing Wasm export: lastscore');
  assert(typeof wasmExports['no_command'] != 'undefined', 'missing Wasm export: no_command');
  assert(typeof wasmExports['no_move'] != 'undefined', 'missing Wasm export: no_move');
  assert(typeof wasmExports['purse'] != 'undefined', 'missing Wasm export: purse');
  assert(typeof wasmExports['quiet'] != 'undefined', 'missing Wasm export: quiet');
  assert(typeof wasmExports['vf_hit'] != 'undefined', 'missing Wasm export: vf_hit');
  assert(typeof wasmExports['e_levels'] != 'undefined', 'missing Wasm export: e_levels');
  assert(typeof wasmExports['l_last_pick'] != 'undefined', 'missing Wasm export: l_last_pick');
  assert(typeof wasmExports['last_pick'] != 'undefined', 'missing Wasm export: last_pick');
  assert(typeof wasmExports['lvl_obj'] != 'undefined', 'missing Wasm export: lvl_obj');
  assert(typeof wasmExports['mlist'] != 'undefined', 'missing Wasm export: mlist');
  assert(typeof wasmExports['hw'] != 'undefined', 'missing Wasm export: hw');
  assert(typeof wasmExports['max_stats'] != 'undefined', 'missing Wasm export: max_stats');
  assert(typeof wasmExports['passages'] != 'undefined', 'missing Wasm export: passages');
  assert(typeof wasmExports['monsters'] != 'undefined', 'missing Wasm export: monsters');
  assert(typeof wasmExports['things'] != 'undefined', 'missing Wasm export: things');
  assert(typeof wasmExports['arm_info'] != 'undefined', 'missing Wasm export: arm_info');
  assert(typeof wasmExports['pot_info'] != 'undefined', 'missing Wasm export: pot_info');
  assert(typeof wasmExports['ring_info'] != 'undefined', 'missing Wasm export: ring_info');
  assert(typeof wasmExports['scr_info'] != 'undefined', 'missing Wasm export: scr_info');
  assert(typeof wasmExports['weap_info'] != 'undefined', 'missing Wasm export: weap_info');
  assert(typeof wasmExports['ws_info'] != 'undefined', 'missing Wasm export: ws_info');
  assert(typeof wasmExports['helpstr'] != 'undefined', 'missing Wasm export: helpstr');
  assert(typeof wasmExports['after'] != 'undefined', 'missing Wasm export: after');
  assert(typeof wasmExports['again'] != 'undefined', 'missing Wasm export: again');
  assert(typeof wasmExports['noscore'] != 'undefined', 'missing Wasm export: noscore');
  assert(typeof wasmExports['seenstairs'] != 'undefined', 'missing Wasm export: seenstairs');
  assert(typeof wasmExports['dir_ch'] != 'undefined', 'missing Wasm export: dir_ch');
  assert(typeof wasmExports['file_name'] != 'undefined', 'missing Wasm export: file_name');
  assert(typeof wasmExports['huh'] != 'undefined', 'missing Wasm export: huh');
  assert(typeof wasmExports['p_colors'] != 'undefined', 'missing Wasm export: p_colors');
  assert(typeof wasmExports['prbuf'] != 'undefined', 'missing Wasm export: prbuf');
  assert(typeof wasmExports['r_stones'] != 'undefined', 'missing Wasm export: r_stones');
  assert(typeof wasmExports['runch'] != 'undefined', 'missing Wasm export: runch');
  assert(typeof wasmExports['s_names'] != 'undefined', 'missing Wasm export: s_names');
  assert(typeof wasmExports['take'] != 'undefined', 'missing Wasm export: take');
  assert(typeof wasmExports['whoami'] != 'undefined', 'missing Wasm export: whoami');
  assert(typeof wasmExports['ws_made'] != 'undefined', 'missing Wasm export: ws_made');
  assert(typeof wasmExports['ws_type'] != 'undefined', 'missing Wasm export: ws_type');
  assert(typeof wasmExports['orig_dsusp'] != 'undefined', 'missing Wasm export: orig_dsusp');
  assert(typeof wasmExports['n_objs'] != 'undefined', 'missing Wasm export: n_objs');
  assert(typeof wasmExports['ntraps'] != 'undefined', 'missing Wasm export: ntraps');
  assert(typeof wasmExports['max_hit'] != 'undefined', 'missing Wasm export: max_hit');
  assert(typeof wasmExports['max_level'] != 'undefined', 'missing Wasm export: max_level');
  assert(typeof wasmExports['food_left'] != 'undefined', 'missing Wasm export: food_left');
  assert(typeof wasmExports['dnum'] != 'undefined', 'missing Wasm export: dnum');
  assert(typeof wasmExports['seed'] != 'undefined', 'missing Wasm export: seed');
  assert(typeof wasmExports['delta'] != 'undefined', 'missing Wasm export: delta');
  assert(typeof wasmExports['oldpos'] != 'undefined', 'missing Wasm export: oldpos');
  assert(typeof wasmExports['stairs'] != 'undefined', 'missing Wasm export: stairs');
  assert(typeof wasmExports['places'] != 'undefined', 'missing Wasm export: places');
  assert(typeof wasmExports['cur_armor'] != 'undefined', 'missing Wasm export: cur_armor');
  assert(typeof wasmExports['cur_ring'] != 'undefined', 'missing Wasm export: cur_ring');
  assert(typeof wasmExports['cur_weapon'] != 'undefined', 'missing Wasm export: cur_weapon');
  assert(typeof wasmExports['player'] != 'undefined', 'missing Wasm export: player');
  assert(typeof wasmExports['oldrp'] != 'undefined', 'missing Wasm export: oldrp');
  assert(typeof wasmExports['rooms'] != 'undefined', 'missing Wasm export: rooms');
  assert(typeof wasmExports['curscr'] != 'undefined', 'missing Wasm export: curscr');
  assert(typeof wasmExports['LINES'] != 'undefined', 'missing Wasm export: LINES');
  assert(typeof wasmExports['COLS'] != 'undefined', 'missing Wasm export: COLS');
  assert(typeof wasmExports['stdscr'] != 'undefined', 'missing Wasm export: stdscr');
  assert(typeof wasmExports['d_list'] != 'undefined', 'missing Wasm export: d_list');
  assert(typeof wasmExports['__indirect_function_table'] != 'undefined', 'missing Wasm export: __indirect_function_table');
  assert(typeof wasmExports['between'] != 'undefined', 'missing Wasm export: between');
  assert(typeof wasmExports['h_names'] != 'undefined', 'missing Wasm export: h_names');
  assert(typeof wasmExports['m_names'] != 'undefined', 'missing Wasm export: m_names');
  assert(typeof wasmExports['rainbow'] != 'undefined', 'missing Wasm export: rainbow');
  assert(typeof wasmExports['stones'] != 'undefined', 'missing Wasm export: stones');
  assert(typeof wasmExports['metal'] != 'undefined', 'missing Wasm export: metal');
  assert(typeof wasmExports['wood'] != 'undefined', 'missing Wasm export: wood');
  assert(typeof wasmExports['cNCOLORS'] != 'undefined', 'missing Wasm export: cNCOLORS');
  assert(typeof wasmExports['cNSTONES'] != 'undefined', 'missing Wasm export: cNSTONES');
  assert(typeof wasmExports['cNWOOD'] != 'undefined', 'missing Wasm export: cNWOOD');
  assert(typeof wasmExports['cNMETAL'] != 'undefined', 'missing Wasm export: cNMETAL');
  assert(typeof wasmExports['numscores'] != 'undefined', 'missing Wasm export: numscores');
  assert(typeof wasmExports['Numname'] != 'undefined', 'missing Wasm export: Numname');
  assert(typeof wasmExports['allscore'] != 'undefined', 'missing Wasm export: allscore');
  assert(typeof wasmExports['nh'] != 'undefined', 'missing Wasm export: nh');
  assert(typeof wasmExports['optlist'] != 'undefined', 'missing Wasm export: optlist');
  assert(typeof wasmExports['group'] != 'undefined', 'missing Wasm export: group');
  assert(typeof wasmExports['md_endian'] != 'undefined', 'missing Wasm export: md_endian');
  assert(typeof wasmExports['__abort_handler'] != 'undefined', 'missing Wasm export: __abort_handler');
  assert(typeof wasmExports['__instance_terminated'] != 'undefined', 'missing Wasm export: __instance_terminated');
  assert(typeof wasmExports['__wbindgen_externrefs'] != 'undefined', 'missing Wasm export: __wbindgen_externrefs');
  _wear = Module['_wear'] = createExportWrapper('wear', wasmExports['wear'], 0);
  _get_item = Module['_get_item'] = createExportWrapper('get_item', wasmExports['get_item'], 2);
  _rg_addmsg = Module['_rg_addmsg'] = createExportWrapper('rg_addmsg', wasmExports['rg_addmsg'], 4);
  _endmsg = Module['_endmsg'] = createExportWrapper('endmsg', wasmExports['endmsg'], 0);
  _rg_msg = Module['_rg_msg'] = createExportWrapper('rg_msg', wasmExports['rg_msg'], 4);
  _spread = Module['_spread'] = createExportWrapper('spread', wasmExports['spread'], 1);
  _do_daemons = Module['_do_daemons'] = createExportWrapper('do_daemons', wasmExports['do_daemons'], 1);
  _do_fuses = Module['_do_fuses'] = createExportWrapper('do_fuses', wasmExports['do_fuses'], 1);
  _rg_core_tick_complete = Module['_rg_core_tick_complete'] = createExportWrapper('rg_core_tick_complete', wasmExports['rg_core_tick_complete'], 0);
  _inv_name = Module['_inv_name'] = createExportWrapper('inv_name', wasmExports['inv_name'], 2);
  _take_off = Module['_take_off'] = createExportWrapper('take_off', wasmExports['take_off'], 0);
  _dropcheck = Module['_dropcheck'] = createExportWrapper('dropcheck', wasmExports['dropcheck'], 1);
  _waste_time = Module['_waste_time'] = createExportWrapper('waste_time', wasmExports['waste_time'], 0);
  _runners = Module['_runners'] = createExportWrapper('runners', wasmExports['runners'], 0);
  _do_chase = Module['_do_chase'] = createExportWrapper('do_chase', wasmExports['do_chase'], 1);
  _move_monst = Module['_move_monst'] = createExportWrapper('move_monst', wasmExports['move_monst'], 1);
  _dist_cp = Module['_dist_cp'] = createExportWrapper('dist_cp', wasmExports['dist_cp'], 2);
  _rnd = Module['_rnd'] = createExportWrapper('rnd', wasmExports['rnd'], 1);
  _sign = Module['_sign'] = createExportWrapper('sign', wasmExports['sign'], 1);
  _fire_bolt = Module['_fire_bolt'] = createExportWrapper('fire_bolt', wasmExports['fire_bolt'], 3);
  _chase = Module['_chase'] = createExportWrapper('chase', wasmExports['chase'], 2);
  _attack = Module['_attack'] = createExportWrapper('attack', wasmExports['attack'], 1);
  __detach = Module['__detach'] = createExportWrapper('_detach', wasmExports['_detach'], 2);
  __attach = Module['__attach'] = createExportWrapper('_attach', wasmExports['_attach'], 2);
  _find_dest = Module['_find_dest'] = createExportWrapper('find_dest', wasmExports['find_dest'], 1);
  _relocate = Module['_relocate'] = createExportWrapper('relocate', wasmExports['relocate'], 2);
  _mvaddch = Module['_mvaddch'] = createExportWrapper('mvaddch', wasmExports['mvaddch'], 3);
  _mvinch = Module['_mvinch'] = createExportWrapper('mvinch', wasmExports['mvinch'], 2);
  _move = Module['_move'] = createExportWrapper('move', wasmExports['move'], 2);
  _see_monst = Module['_see_monst'] = createExportWrapper('see_monst', wasmExports['see_monst'], 1);
  _addch = Module['_addch'] = createExportWrapper('addch', wasmExports['addch'], 1);
  _standout = Module['_standout'] = createExportWrapper('standout', wasmExports['standout'], 0);
  _standend = Module['_standend'] = createExportWrapper('standend', wasmExports['standend'], 0);
  _roomin = Module['_roomin'] = createExportWrapper('roomin', wasmExports['roomin'], 1);
  _set_oldch = Module['_set_oldch'] = createExportWrapper('set_oldch', wasmExports['set_oldch'], 2);
  _step_ok = Module['_step_ok'] = createExportWrapper('step_ok', wasmExports['step_ok'], 1);
  _rndmove = Module['_rndmove'] = createExportWrapper('rndmove', wasmExports['rndmove'], 1);
  _dist = Module['_dist'] = createExportWrapper('dist', wasmExports['dist'], 4);
  _runto = Module['_runto'] = createExportWrapper('runto', wasmExports['runto'], 1);
  _diag_ok = Module['_diag_ok'] = createExportWrapper('diag_ok', wasmExports['diag_ok'], 2);
  _cansee = Module['_cansee'] = createExportWrapper('cansee', wasmExports['cansee'], 2);
  _command = Module['_command'] = createExportWrapper('command', wasmExports['command'], 0);
  _rg_core_exit = Module['_rg_core_exit'] = createExportWrapper('rg_core_exit', wasmExports['rg_core_exit'], 1);
  _look = Module['_look'] = createExportWrapper('look', wasmExports['look'], 1);
  _status = Module['_status'] = createExportWrapper('status', wasmExports['status'], 0);
  _refresh = Module['_refresh'] = createExportWrapper('refresh', wasmExports['refresh'], 0);
  _readchar = Module['_readchar'] = createExportWrapper('readchar', wasmExports['readchar'], 0);
  _pick_up = Module['_pick_up'] = createExportWrapper('pick_up', wasmExports['pick_up'], 1);
  _shell = Module['_shell'] = createExportWrapper('shell', wasmExports['shell'], 0);
  _do_move = Module['_do_move'] = createExportWrapper('do_move', wasmExports['do_move'], 2);
  _do_run = Module['_do_run'] = createExportWrapper('do_run', wasmExports['do_run'], 1);
  _get_dir = Module['_get_dir'] = createExportWrapper('get_dir', wasmExports['get_dir'], 0);
  _rg_ui_line = Module['_rg_ui_line'] = createExportWrapper('rg_ui_line', wasmExports['rg_ui_line'], 6);
  _missile = Module['_missile'] = createExportWrapper('missile', wasmExports['missile'], 2);
  _rg_ui_clear = Module['_rg_ui_clear'] = createExportWrapper('rg_ui_clear', wasmExports['rg_ui_clear'], 1);
  _quaff = Module['_quaff'] = createExportWrapper('quaff', wasmExports['quaff'], 0);
  _quit = Module['_quit'] = createExportWrapper('quit', wasmExports['quit'], 1);
  _rg_inventory_browser = Module['_rg_inventory_browser'] = createExportWrapper('rg_inventory_browser', wasmExports['rg_inventory_browser'], 0);
  _picky_inven = Module['_picky_inven'] = createExportWrapper('picky_inven', wasmExports['picky_inven'], 0);
  _drop = Module['_drop'] = createExportWrapper('drop', wasmExports['drop'], 0);
  _read_scroll = Module['_read_scroll'] = createExportWrapper('read_scroll', wasmExports['read_scroll'], 0);
  _eat = Module['_eat'] = createExportWrapper('eat', wasmExports['eat'], 0);
  _wield = Module['_wield'] = createExportWrapper('wield', wasmExports['wield'], 0);
  _ring_on = Module['_ring_on'] = createExportWrapper('ring_on', wasmExports['ring_on'], 0);
  _ring_off = Module['_ring_off'] = createExportWrapper('ring_off', wasmExports['ring_off'], 0);
  _option = Module['_option'] = createExportWrapper('option', wasmExports['option'], 0);
  _call = Module['_call'] = createExportWrapper('call', wasmExports['call'], 0);
  _new_level = Module['_new_level'] = createExportWrapper('new_level', wasmExports['new_level'], 0);
  _u_level = Module['_u_level'] = createExportWrapper('u_level', wasmExports['u_level'], 0);
  _help = Module['_help'] = createExportWrapper('help', wasmExports['help'], 0);
  _identify = Module['_identify'] = createExportWrapper('identify', wasmExports['identify'], 0);
  _search = Module['_search'] = createExportWrapper('search', wasmExports['search'], 0);
  _do_zap = Module['_do_zap'] = createExportWrapper('do_zap', wasmExports['do_zap'], 0);
  _discovered = Module['_discovered'] = createExportWrapper('discovered', wasmExports['discovered'], 0);
  _clearok = Module['_clearok'] = createExportWrapper('clearok', wasmExports['clearok'], 2);
  _wrefresh = Module['_wrefresh'] = createExportWrapper('wrefresh', wasmExports['wrefresh'], 1);
  _save_game = Module['_save_game'] = createExportWrapper('save_game', wasmExports['save_game'], 0);
  _current = Module['_current'] = createExportWrapper('current', wasmExports['current'], 3);
  _unctrl = Module['_unctrl'] = createExportWrapper('unctrl', wasmExports['unctrl'], 1);
  _teleport = Module['_teleport'] = createExportWrapper('teleport', wasmExports['teleport'], 0);
  _rg_semantic_register_term = Module['_rg_semantic_register_term'] = createExportWrapper('rg_semantic_register_term', wasmExports['rg_semantic_register_term'], 2);
  _illcom = Module['_illcom'] = createExportWrapper('illcom', wasmExports['illcom'], 1);
  _rg_command_state_get = Module['_rg_command_state_get'] = createExportWrapper('rg_command_state_get', wasmExports['rg_command_state_get'], 1);
  _rg_command_state_set = Module['_rg_command_state_set'] = createExportWrapper('rg_command_state_set', wasmExports['rg_command_state_set'], 1);
  _wclear = Module['_wclear'] = createExportWrapper('wclear', wasmExports['wclear'], 1);
  _wmove = Module['_wmove'] = createExportWrapper('wmove', wasmExports['wmove'], 3);
  _waddstr = Module['_waddstr'] = createExportWrapper('waddstr', wasmExports['waddstr'], 2);
  _rg_wait_for = Module['_rg_wait_for'] = createExportWrapper('rg_wait_for', wasmExports['rg_wait_for'], 2);
  _touchwin = Module['_touchwin'] = createExportWrapper('touchwin', wasmExports['touchwin'], 1);
  _d_level = Module['_d_level'] = createExportWrapper('d_level', wasmExports['d_level'], 0);
  _total_winner = Module['_total_winner'] = createExportWrapper('total_winner', wasmExports['total_winner'], 0);
  _levit_check = Module['_levit_check'] = createExportWrapper('levit_check', wasmExports['levit_check'], 0);
  _get_str = Module['_get_str'] = createExportWrapper('get_str', wasmExports['get_str'], 2);
  _free = Module['_free'] = createExportWrapper('free', wasmExports['free'], 1);
  _strlen = Module['_strlen'] = createExportWrapper('strlen', wasmExports['strlen'], 1);
  _malloc = Module['_malloc'] = createExportWrapper('malloc', wasmExports['malloc'], 1);
  _d_slot = Module['_d_slot'] = createExportWrapper('d_slot', wasmExports['d_slot'], 0);
  _find_slot = Module['_find_slot'] = createExportWrapper('find_slot', wasmExports['find_slot'], 1);
  _start_daemon = Module['_start_daemon'] = createExportWrapper('start_daemon', wasmExports['start_daemon'], 3);
  _kill_daemon = Module['_kill_daemon'] = createExportWrapper('kill_daemon', wasmExports['kill_daemon'], 1);
  _turn_see = Module['_turn_see'] = createExportWrapper('turn_see', wasmExports['turn_see'], 1);
  _land = Module['_land'] = createExportWrapper('land', wasmExports['land'], 0);
  _visuals = Module['_visuals'] = createExportWrapper('visuals', wasmExports['visuals'], 0);
  _come_down = Module['_come_down'] = createExportWrapper('come_down', wasmExports['come_down'], 0);
  _nohaste = Module['_nohaste'] = createExportWrapper('nohaste', wasmExports['nohaste'], 0);
  _sight = Module['_sight'] = createExportWrapper('sight', wasmExports['sight'], 0);
  _unsee = Module['_unsee'] = createExportWrapper('unsee', wasmExports['unsee'], 0);
  _unconfuse = Module['_unconfuse'] = createExportWrapper('unconfuse', wasmExports['unconfuse'], 0);
  _rollwand = Module['_rollwand'] = createExportWrapper('rollwand', wasmExports['rollwand'], 0);
  _swander = Module['_swander'] = createExportWrapper('swander', wasmExports['swander'], 0);
  _stomach = Module['_stomach'] = createExportWrapper('stomach', wasmExports['stomach'], 0);
  _doctor = Module['_doctor'] = createExportWrapper('doctor', wasmExports['doctor'], 0);
  _rg_core_abort = Module['_rg_core_abort'] = createExportWrapper('rg_core_abort', wasmExports['rg_core_abort'], 0);
  _fuse = Module['_fuse'] = createExportWrapper('fuse', wasmExports['fuse'], 4);
  _lengthen = Module['_lengthen'] = createExportWrapper('lengthen', wasmExports['lengthen'], 2);
  _extinguish = Module['_extinguish'] = createExportWrapper('extinguish', wasmExports['extinguish'], 1);
  _roll = Module['_roll'] = createExportWrapper('roll', wasmExports['roll'], 2);
  _wanderer = Module['_wanderer'] = createExportWrapper('wanderer', wasmExports['wanderer'], 0);
  _choose_str = Module['_choose_str'] = createExportWrapper('choose_str', wasmExports['choose_str'], 2);
  _enter_room = Module['_enter_room'] = createExportWrapper('enter_room', wasmExports['enter_room'], 1);
  _death = Module['_death'] = createExportWrapper('death', wasmExports['death'], 1);
  _ring_eat = Module['_ring_eat'] = createExportWrapper('ring_eat', wasmExports['ring_eat'], 1);
  _rnd_thing = Module['_rnd_thing'] = createExportWrapper('rnd_thing', wasmExports['rnd_thing'], 0);
  _fight = Module['_fight'] = createExportWrapper('fight', wasmExports['fight'], 3);
  _set_mname = Module['_set_mname'] = createExportWrapper('set_mname', wasmExports['set_mname'], 1);
  _roll_em = Module['_roll_em'] = createExportWrapper('roll_em', wasmExports['roll_em'], 4);
  _hit = Module['_hit'] = createExportWrapper('hit', wasmExports['hit'], 3);
  _pick_color = Module['_pick_color'] = createExportWrapper('pick_color', wasmExports['pick_color'], 1);
  _killed = Module['_killed'] = createExportWrapper('killed', wasmExports['killed'], 2);
  _miss = Module['_miss'] = createExportWrapper('miss', wasmExports['miss'], 3);
  _rg_semantic_monster = Module['_rg_semantic_monster'] = createExportWrapper('rg_semantic_monster', wasmExports['rg_semantic_monster'], 6);
  _inch = Module['_inch'] = createExportWrapper('inch', wasmExports['inch'], 0);
  _thunk = Module['_thunk'] = createExportWrapper('thunk', wasmExports['thunk'], 3);
  _rg_semantic_combatant = Module['_rg_semantic_combatant'] = createExportWrapper('rg_semantic_combatant', wasmExports['rg_semantic_combatant'], 3);
  _rg_semantic_combat_verb = Module['_rg_semantic_combat_verb'] = createExportWrapper('rg_semantic_combat_verb', wasmExports['rg_semantic_combat_verb'], 3);
  _fallpos = Module['_fallpos'] = createExportWrapper('fallpos', wasmExports['fallpos'], 2);
  _new_item = Module['_new_item'] = createExportWrapper('new_item', wasmExports['new_item'], 0);
  _save = Module['_save'] = createExportWrapper('save', wasmExports['save'], 1);
  _remove_mon = Module['_remove_mon'] = createExportWrapper('remove_mon', wasmExports['remove_mon'], 3);
  _check_level = Module['_check_level'] = createExportWrapper('check_level', wasmExports['check_level'], 0);
  _flush_type = Module['_flush_type'] = createExportWrapper('flush_type', wasmExports['flush_type'], 0);
  _bounce = Module['_bounce'] = createExportWrapper('bounce', wasmExports['bounce'], 3);
  _rust_armor = Module['_rust_armor'] = createExportWrapper('rust_armor', wasmExports['rust_armor'], 1);
  _chg_str = Module['_chg_str'] = createExportWrapper('chg_str', wasmExports['chg_str'], 1);
  _is_magic = Module['_is_magic'] = createExportWrapper('is_magic', wasmExports['is_magic'], 1);
  _leave_pack = Module['_leave_pack'] = createExportWrapper('leave_pack', wasmExports['leave_pack'], 3);
  _discard = Module['_discard'] = createExportWrapper('discard', wasmExports['discard'], 1);
  _fall = Module['_fall'] = createExportWrapper('fall', wasmExports['fall'], 2);
  _swing = Module['_swing'] = createExportWrapper('swing', wasmExports['swing'], 3);
  _prname = Module['_prname'] = createExportWrapper('prname', wasmExports['prname'], 2);
  _init_player = Module['_init_player'] = createExportWrapper('init_player', wasmExports['init_player'], 0);
  _add_pack = Module['_add_pack'] = createExportWrapper('add_pack', wasmExports['add_pack'], 2);
  _init_weapon = Module['_init_weapon'] = createExportWrapper('init_weapon', wasmExports['init_weapon'], 2);
  _init_colors = Module['_init_colors'] = createExportWrapper('init_colors', wasmExports['init_colors'], 0);
  _init_names = Module['_init_names'] = createExportWrapper('init_names', wasmExports['init_names'], 0);
  _init_stones = Module['_init_stones'] = createExportWrapper('init_stones', wasmExports['init_stones'], 0);
  _init_materials = Module['_init_materials'] = createExportWrapper('init_materials', wasmExports['init_materials'], 0);
  _sumprobs = Module['_sumprobs'] = createExportWrapper('sumprobs', wasmExports['sumprobs'], 2);
  _init_probs = Module['_init_probs'] = createExportWrapper('init_probs', wasmExports['init_probs'], 0);
  _clrtoeol = Module['_clrtoeol'] = createExportWrapper('clrtoeol', wasmExports['clrtoeol'], 0);
  _rg_message_clear = Module['_rg_message_clear'] = createExportWrapper('rg_message_clear', wasmExports['rg_message_clear'], 0);
  _rg_message_prepare = Module['_rg_message_prepare'] = createExportWrapper('rg_message_prepare', wasmExports['rg_message_prepare'], 5);
  _rg_message_push = Module['_rg_message_push'] = createExportWrapper('rg_message_push', wasmExports['rg_message_push'], 1);
  _mvaddstr = Module['_mvaddstr'] = createExportWrapper('mvaddstr', wasmExports['mvaddstr'], 3);
  _rg_host_message_requires_acknowledgement = Module['_rg_host_message_requires_acknowledgement'] = createExportWrapper('rg_host_message_requires_acknowledgement', wasmExports['rg_host_message_requires_acknowledgement'], 0);
  _md_readchar = Module['_md_readchar'] = createExportWrapper('md_readchar', wasmExports['md_readchar'], 0);
  _rg_message_discard = Module['_rg_message_discard'] = createExportWrapper('rg_message_discard', wasmExports['rg_message_discard'], 0);
  _rg_message_flush = Module['_rg_message_flush'] = createExportWrapper('rg_message_flush', wasmExports['rg_message_flush'], 1);
  _rg_semantic_copy = Module['_rg_semantic_copy'] = createExportWrapper('rg_semantic_copy', wasmExports['rg_semantic_copy'], 2);
  _rg_message_state_export = Module['_rg_message_state_export'] = createExportWrapper('rg_message_state_export', wasmExports['rg_message_state_export'], 2);
  _rg_message_state_validate = Module['_rg_message_state_validate'] = createExportWrapper('rg_message_state_validate', wasmExports['rg_message_state_validate'], 2);
  _rg_message_state_import = Module['_rg_message_state_import'] = createExportWrapper('rg_message_state_import', wasmExports['rg_message_state_import'], 2);
  _rg_status_publish = Module['_rg_status_publish'] = createExportWrapper('rg_status_publish', wasmExports['rg_status_publish'], 1);
  _printw = Module['_printw'] = createExportWrapper('printw', wasmExports['printw'], 2);
  _rg_status_state_get = Module['_rg_status_state_get'] = createExportWrapper('rg_status_state_get', wasmExports['rg_status_state_get'], 1);
  _rg_status_state_set = Module['_rg_status_state_set'] = createExportWrapper('rg_status_state_set', wasmExports['rg_status_state_set'], 1);
  _wait_for = Module['_wait_for'] = createExportWrapper('wait_for', wasmExports['wait_for'], 1);
  _show_win = Module['_show_win'] = createExportWrapper('show_win', wasmExports['show_win'], 1);
  __free_list = Module['__free_list'] = createExportWrapper('_free_list', wasmExports['_free_list'], 1);
  _init_check = Module['_init_check'] = createExportWrapper('init_check', wasmExports['init_check'], 0);
  _open_score = Module['_open_score'] = createExportWrapper('open_score', wasmExports['open_score'], 0);
  _setup = Module['_setup'] = createExportWrapper('setup', wasmExports['setup'], 0);
  _getltchars = Module['_getltchars'] = createExportWrapper('getltchars', wasmExports['getltchars'], 0);
  _resetltchars = Module['_resetltchars'] = createExportWrapper('resetltchars', wasmExports['resetltchars'], 0);
  _playltchars = Module['_playltchars'] = createExportWrapper('playltchars', wasmExports['playltchars'], 0);
  _start_score = Module['_start_score'] = createExportWrapper('start_score', wasmExports['start_score'], 0);
  _is_symlink = Module['_is_symlink'] = createExportWrapper('is_symlink', wasmExports['is_symlink'], 1);
  _too_much = Module['_too_much'] = createExportWrapper('too_much', wasmExports['too_much'], 0);
  _author = Module['_author'] = createExportWrapper('author', wasmExports['author'], 0);
  _lock_sc = Module['_lock_sc'] = createExportWrapper('lock_sc', wasmExports['lock_sc'], 0);
  _unlock_sc = Module['_unlock_sc'] = createExportWrapper('unlock_sc', wasmExports['unlock_sc'], 0);
  _rg_knowledge_flush_input = Module['_rg_knowledge_flush_input'] = createExportWrapper('rg_knowledge_flush_input', wasmExports['rg_knowledge_flush_input'], 0);
  _endit = Module['_endit'] = createExportWrapper('endit', wasmExports['endit'], 1);
  _endwin = Module['_endwin'] = createExportWrapper('endwin', wasmExports['endwin'], 0);
  _fatal = Module['_fatal'] = createExportWrapper('fatal', wasmExports['fatal'], 1);
  _my_exit = Module['_my_exit'] = createExportWrapper('my_exit', wasmExports['my_exit'], 1);
  _rg_random_next = Module['_rg_random_next'] = createExportWrapper('rg_random_next', wasmExports['rg_random_next'], 0);
  _tstp = Module['_tstp'] = createExportWrapper('tstp', wasmExports['tstp'], 1);
  _playit = Module['_playit'] = createExportWrapper('playit', wasmExports['playit'], 0);
  _baudrate = Module['_baudrate'] = createExportWrapper('baudrate', wasmExports['baudrate'], 0);
  _md_hasclreol = Module['_md_hasclreol'] = createExportWrapper('md_hasclreol', wasmExports['md_hasclreol'], 0);
  _rg_core_was_restored = Module['_rg_core_was_restored'] = createExportWrapper('rg_core_was_restored', wasmExports['rg_core_was_restored'], 0);
  _rg_host_checkpoint = Module['_rg_host_checkpoint'] = createExportWrapper('rg_host_checkpoint', wasmExports['rg_host_checkpoint'], 0);
  _rg_core_set_outcome = Module['_rg_core_set_outcome'] = createExportWrapper('rg_core_set_outcome', wasmExports['rg_core_set_outcome'], 2);
  _leave = Module['_leave'] = createExportWrapper('leave', wasmExports['leave'], 1);
  _clear = Module['_clear'] = createExportWrapper('clear', wasmExports['clear'], 0);
  _mvprintw = Module['_mvprintw'] = createExportWrapper('mvprintw', wasmExports['mvprintw'], 4);
  _rg_capture_arguments = Module['_rg_capture_arguments'] = createExportWrapper('rg_capture_arguments', wasmExports['rg_capture_arguments'], 4);
  _score = Module['_score'] = createExportWrapper('score', wasmExports['score'], 3);
  _isendwin = Module['_isendwin'] = createExportWrapper('isendwin', wasmExports['isendwin'], 0);
  _mvcur = Module['_mvcur'] = createExportWrapper('mvcur', wasmExports['mvcur'], 4);
  _rg_console_putchar = Module['_rg_console_putchar'] = createExportWrapper('rg_console_putchar', wasmExports['rg_console_putchar'], 1);
  _md_init = Module['_md_init'] = createExportWrapper('md_init', wasmExports['md_init'], 0);
  _md_onsignal_default = Module['_md_onsignal_default'] = createExportWrapper('md_onsignal_default', wasmExports['md_onsignal_default'], 0);
  _md_onsignal_exit = Module['_md_onsignal_exit'] = createExportWrapper('md_onsignal_exit', wasmExports['md_onsignal_exit'], 0);
  _md_onsignal_autosave = Module['_md_onsignal_autosave'] = createExportWrapper('md_onsignal_autosave', wasmExports['md_onsignal_autosave'], 0);
  _md_ignoreallsignals = Module['_md_ignoreallsignals'] = createExportWrapper('md_ignoreallsignals', wasmExports['md_ignoreallsignals'], 0);
  _md_tstphold = Module['_md_tstphold'] = createExportWrapper('md_tstphold', wasmExports['md_tstphold'], 0);
  _md_tstpresume = Module['_md_tstpresume'] = createExportWrapper('md_tstpresume', wasmExports['md_tstpresume'], 0);
  _md_tstpsignal = Module['_md_tstpsignal'] = createExportWrapper('md_tstpsignal', wasmExports['md_tstpsignal'], 0);
  _md_start_checkout_timer = Module['_md_start_checkout_timer'] = createExportWrapper('md_start_checkout_timer', wasmExports['md_start_checkout_timer'], 1);
  _md_stop_checkout_timer = Module['_md_stop_checkout_timer'] = createExportWrapper('md_stop_checkout_timer', wasmExports['md_stop_checkout_timer'], 0);
  _md_putchar = Module['_md_putchar'] = createExportWrapper('md_putchar', wasmExports['md_putchar'], 1);
  _md_raw_standout = Module['_md_raw_standout'] = createExportWrapper('md_raw_standout', wasmExports['md_raw_standout'], 0);
  _md_raw_standend = Module['_md_raw_standend'] = createExportWrapper('md_raw_standend', wasmExports['md_raw_standend'], 0);
  _md_unlink_open_file = Module['_md_unlink_open_file'] = createExportWrapper('md_unlink_open_file', wasmExports['md_unlink_open_file'], 2);
  _md_unlink = Module['_md_unlink'] = createExportWrapper('md_unlink', wasmExports['md_unlink'], 1);
  _md_chmod = Module['_md_chmod'] = createExportWrapper('md_chmod', wasmExports['md_chmod'], 2);
  _md_normaluser = Module['_md_normaluser'] = createExportWrapper('md_normaluser', wasmExports['md_normaluser'], 0);
  _md_getuid = Module['_md_getuid'] = createExportWrapper('md_getuid', wasmExports['md_getuid'], 0);
  _md_getpid = Module['_md_getpid'] = createExportWrapper('md_getpid', wasmExports['md_getpid'], 0);
  _md_getusername = Module['_md_getusername'] = createExportWrapper('md_getusername', wasmExports['md_getusername'], 0);
  _rg_core_player_name = Module['_rg_core_player_name'] = createExportWrapper('rg_core_player_name', wasmExports['rg_core_player_name'], 0);
  _md_gethomedir = Module['_md_gethomedir'] = createExportWrapper('md_gethomedir', wasmExports['md_gethomedir'], 0);
  _md_sleep = Module['_md_sleep'] = createExportWrapper('md_sleep', wasmExports['md_sleep'], 1);
  _md_getshell = Module['_md_getshell'] = createExportWrapper('md_getshell', wasmExports['md_getshell'], 0);
  _md_shellescape = Module['_md_shellescape'] = createExportWrapper('md_shellescape', wasmExports['md_shellescape'], 0);
  _md_getrealname = Module['_md_getrealname'] = createExportWrapper('md_getrealname', wasmExports['md_getrealname'], 1);
  _md_crypt = Module['_md_crypt'] = createExportWrapper('md_crypt', wasmExports['md_crypt'], 2);
  _md_getpass = Module['_md_getpass'] = createExportWrapper('md_getpass', wasmExports['md_getpass'], 1);
  _wgetnstr = Module['_wgetnstr'] = createExportWrapper('wgetnstr', wasmExports['wgetnstr'], 3);
  _md_erasechar = Module['_md_erasechar'] = createExportWrapper('md_erasechar', wasmExports['md_erasechar'], 0);
  _erasechar = Module['_erasechar'] = createExportWrapper('erasechar', wasmExports['erasechar'], 0);
  _md_killchar = Module['_md_killchar'] = createExportWrapper('md_killchar', wasmExports['md_killchar'], 0);
  _killchar = Module['_killchar'] = createExportWrapper('killchar', wasmExports['killchar'], 0);
  _md_dsuspchar = Module['_md_dsuspchar'] = createExportWrapper('md_dsuspchar', wasmExports['md_dsuspchar'], 0);
  _md_setdsuspchar = Module['_md_setdsuspchar'] = createExportWrapper('md_setdsuspchar', wasmExports['md_setdsuspchar'], 1);
  _md_suspchar = Module['_md_suspchar'] = createExportWrapper('md_suspchar', wasmExports['md_suspchar'], 0);
  _md_setsuspchar = Module['_md_setsuspchar'] = createExportWrapper('md_setsuspchar', wasmExports['md_setsuspchar'], 1);
  _getch = Module['_getch'] = createExportWrapper('getch', wasmExports['getch'], 0);
  _md_loadav = Module['_md_loadav'] = createExportWrapper('md_loadav', wasmExports['md_loadav'], 1);
  _md_issymlink = Module['_md_issymlink'] = createExportWrapper('md_issymlink', wasmExports['md_issymlink'], 1);
  _erase_lamp = Module['_erase_lamp'] = createExportWrapper('erase_lamp', wasmExports['erase_lamp'], 2);
  _wake_monster = Module['_wake_monster'] = createExportWrapper('wake_monster', wasmExports['wake_monster'], 2);
  _trip_ch = Module['_trip_ch'] = createExportWrapper('trip_ch', wasmExports['trip_ch'], 3);
  _show_floor = Module['_show_floor'] = createExportWrapper('show_floor', wasmExports['show_floor'], 0);
  _find_obj = Module['_find_obj'] = createExportWrapper('find_obj', wasmExports['find_obj'], 2);
  _add_str = Module['_add_str'] = createExportWrapper('add_str', wasmExports['add_str'], 2);
  _add_haste = Module['_add_haste'] = createExportWrapper('add_haste', wasmExports['add_haste'], 1);
  _aggravate = Module['_aggravate'] = createExportWrapper('aggravate', wasmExports['aggravate'], 0);
  _vowelstr = Module['_vowelstr'] = createExportWrapper('vowelstr', wasmExports['vowelstr'], 1);
  _is_current = Module['_is_current'] = createExportWrapper('is_current', wasmExports['is_current'], 1);
  _reset_last = Module['_reset_last'] = createExportWrapper('reset_last', wasmExports['reset_last'], 0);
  _rg_direction_state_get = Module['_rg_direction_state_get'] = createExportWrapper('rg_direction_state_get', wasmExports['rg_direction_state_get'], 1);
  _rg_direction_state_set = Module['_rg_direction_state_set'] = createExportWrapper('rg_direction_state_set', wasmExports['rg_direction_state_set'], 1);
  _call_it = Module['_call_it'] = createExportWrapper('call_it', wasmExports['call_it'], 1);
  _randmonster = Module['_randmonster'] = createExportWrapper('randmonster', wasmExports['randmonster'], 1);
  _new_monster = Module['_new_monster'] = createExportWrapper('new_monster', wasmExports['new_monster'], 3);
  _exp_add = Module['_exp_add'] = createExportWrapper('exp_add', wasmExports['exp_add'], 1);
  _find_floor = Module['_find_floor'] = createExportWrapper('find_floor', wasmExports['find_floor'], 4);
  _give_pack = Module['_give_pack'] = createExportWrapper('give_pack', wasmExports['give_pack'], 1);
  _new_thing = Module['_new_thing'] = createExportWrapper('new_thing', wasmExports['new_thing'], 0);
  _save_throw = Module['_save_throw'] = createExportWrapper('save_throw', wasmExports['save_throw'], 2);
  _leaveok = Module['_leaveok'] = createExportWrapper('leaveok', wasmExports['leaveok'], 2);
  _be_trapped = Module['_be_trapped'] = createExportWrapper('be_trapped', wasmExports['be_trapped'], 1);
  _floor_at = Module['_floor_at'] = createExportWrapper('floor_at', wasmExports['floor_at'], 0);
  _leave_room = Module['_leave_room'] = createExportWrapper('leave_room', wasmExports['leave_room'], 1);
  _turn_ok = Module['_turn_ok'] = createExportWrapper('turn_ok', wasmExports['turn_ok'], 2);
  _turnref = Module['_turnref'] = createExportWrapper('turnref', wasmExports['turnref'], 0);
  _door_open = Module['_door_open'] = createExportWrapper('door_open', wasmExports['door_open'], 1);
  _do_rooms = Module['_do_rooms'] = createExportWrapper('do_rooms', wasmExports['do_rooms'], 0);
  _do_passages = Module['_do_passages'] = createExportWrapper('do_passages', wasmExports['do_passages'], 0);
  _put_things = Module['_put_things'] = createExportWrapper('put_things', wasmExports['put_things'], 0);
  _rnd_room = Module['_rnd_room'] = createExportWrapper('rnd_room', wasmExports['rnd_room'], 0);
  _treas_room = Module['_treas_room'] = createExportWrapper('treas_room', wasmExports['treas_room'], 0);
  _put_bool = Module['_put_bool'] = createExportWrapper('put_bool', wasmExports['put_bool'], 1);
  _get_bool = Module['_get_bool'] = createExportWrapper('get_bool', wasmExports['get_bool'], 2);
  _waddch = Module['_waddch'] = createExportWrapper('waddch', wasmExports['waddch'], 2);
  _get_sf = Module['_get_sf'] = createExportWrapper('get_sf', wasmExports['get_sf'], 2);
  _put_inv_t = Module['_put_inv_t'] = createExportWrapper('put_inv_t', wasmExports['put_inv_t'], 1);
  _get_inv_t = Module['_get_inv_t'] = createExportWrapper('get_inv_t', wasmExports['get_inv_t'], 2);
  _mvwprintw = Module['_mvwprintw'] = createExportWrapper('mvwprintw', wasmExports['mvwprintw'], 5);
  _put_str = Module['_put_str'] = createExportWrapper('put_str', wasmExports['put_str'], 1);
  _rg_ui_printf = Module['_rg_ui_printf'] = createExportWrapper('rg_ui_printf', wasmExports['rg_ui_printf'], 7);
  _rg_host_text_mode = Module['_rg_host_text_mode'] = createExportWrapper('rg_host_text_mode', wasmExports['rg_host_text_mode'], 3);
  _strucpy = Module['_strucpy'] = createExportWrapper('strucpy', wasmExports['strucpy'], 3);
  _wclrtoeol = Module['_wclrtoeol'] = createExportWrapper('wclrtoeol', wasmExports['wclrtoeol'], 1);
  _rg_host_player_name = Module['_rg_host_player_name'] = createExportWrapper('rg_host_player_name', wasmExports['rg_host_player_name'], 1);
  _wprintw = Module['_wprintw'] = createExportWrapper('wprintw', wasmExports['wprintw'], 3);
  _pr_optname = Module['_pr_optname'] = createExportWrapper('pr_optname', wasmExports['pr_optname'], 1);
  _parse_opts = Module['_parse_opts'] = createExportWrapper('parse_opts', wasmExports['parse_opts'], 1);
  _pack_room = Module['_pack_room'] = createExportWrapper('pack_room', wasmExports['pack_room'], 2);
  _rg_semantic_pickup_item = Module['_rg_semantic_pickup_item'] = createExportWrapper('rg_semantic_pickup_item', wasmExports['rg_semantic_pickup_item'], 4);
  _move_msg = Module['_move_msg'] = createExportWrapper('move_msg', wasmExports['move_msg'], 1);
  _pack_char = Module['_pack_char'] = createExportWrapper('pack_char', wasmExports['pack_char'], 0);
  _inventory = Module['_inventory'] = createExportWrapper('inventory', wasmExports['inventory'], 2);
  _add_line = Module['_add_line'] = createExportWrapper('add_line', wasmExports['add_line'], 2);
  _end_line = Module['_end_line'] = createExportWrapper('end_line', wasmExports['end_line'], 0);
  _money = Module['_money'] = createExportWrapper('money', wasmExports['money'], 1);
  _rg_host_inventory_browser_enabled = Module['_rg_host_inventory_browser_enabled'] = createExportWrapper('rg_host_inventory_browser_enabled', wasmExports['rg_host_inventory_browser_enabled'], 0);
  _floor_ch = Module['_floor_ch'] = createExportWrapper('floor_ch', wasmExports['floor_ch'], 0);
  _conn = Module['_conn'] = createExportWrapper('conn', wasmExports['conn'], 2);
  _numpass = Module['_numpass'] = createExportWrapper('numpass', wasmExports['numpass'], 2);
  _door = Module['_door'] = createExportWrapper('door', wasmExports['door'], 2);
  _putpass = Module['_putpass'] = createExportWrapper('putpass', wasmExports['putpass'], 1);
  _passnum = Module['_passnum'] = createExportWrapper('passnum', wasmExports['passnum'], 0);
  _do_pot = Module['_do_pot'] = createExportWrapper('do_pot', wasmExports['do_pot'], 2);
  _seen_stairs = Module['_seen_stairs'] = createExportWrapper('seen_stairs', wasmExports['seen_stairs'], 0);
  _invis_on = Module['_invis_on'] = createExportWrapper('invis_on', wasmExports['invis_on'], 0);
  _rg_semantic_register_message = Module['_rg_semantic_register_message'] = createExportWrapper('rg_semantic_register_message', wasmExports['rg_semantic_register_message'], 3);
  _raise_level = Module['_raise_level'] = createExportWrapper('raise_level', wasmExports['raise_level'], 0);
  _gethand = Module['_gethand'] = createExportWrapper('gethand', wasmExports['gethand'], 0);
  _ring_num = Module['_ring_num'] = createExportWrapper('ring_num', wasmExports['ring_num'], 1);
  _num = Module['_num'] = createExportWrapper('num', wasmExports['num'], 3);
  _rg_console_printf = Module['_rg_console_printf'] = createExportWrapper('rg_console_printf', wasmExports['rg_console_printf'], 2);
  _delwin = Module['_delwin'] = createExportWrapper('delwin', wasmExports['delwin'], 1);
  _rd_score = Module['_rd_score'] = createExportWrapper('rd_score', wasmExports['rd_score'], 1);
  _rg_semantic_death = Module['_rg_semantic_death'] = createExportWrapper('rg_semantic_death', wasmExports['rg_semantic_death'], 3);
  _wr_score = Module['_wr_score'] = createExportWrapper('wr_score', wasmExports['wr_score'], 1);
  _rg_message_arguments = Module['_rg_message_arguments'] = createExportWrapper('rg_message_arguments', wasmExports['rg_message_arguments'], 4);
  _killname = Module['_killname'] = createExportWrapper('killname', wasmExports['killname'], 2);
  _addstr = Module['_addstr'] = createExportWrapper('addstr', wasmExports['addstr'], 1);
  _fflush = createExportWrapper('fflush', wasmExports['fflush'], 1);
  _rg_console_fgets = Module['_rg_console_fgets'] = createExportWrapper('rg_console_fgets', wasmExports['rg_console_fgets'], 3);
  _center = Module['_center'] = createExportWrapper('center', wasmExports['center'], 1);
  _death_monst = Module['_death_monst'] = createExportWrapper('death_monst', wasmExports['death_monst'], 0);
  _draw_room = Module['_draw_room'] = createExportWrapper('draw_room', wasmExports['draw_room'], 1);
  _do_maze = Module['_do_maze'] = createExportWrapper('do_maze', wasmExports['do_maze'], 1);
  _dig = Module['_dig'] = createExportWrapper('dig', wasmExports['dig'], 2);
  _vert = Module['_vert'] = createExportWrapper('vert', wasmExports['vert'], 2);
  _horiz = Module['_horiz'] = createExportWrapper('horiz', wasmExports['horiz'], 2);
  _accnt_maze = Module['_accnt_maze'] = createExportWrapper('accnt_maze', wasmExports['accnt_maze'], 4);
  _rnd_pos = Module['_rnd_pos'] = createExportWrapper('rnd_pos', wasmExports['rnd_pos'], 2);
  _rg_host_message = Module['_rg_host_message'] = createExportWrapper('rg_host_message', wasmExports['rg_host_message'], 3);
  _encwrite = Module['_encwrite'] = createExportWrapper('encwrite', wasmExports['encwrite'], 3);
  _encread = Module['_encread'] = createExportWrapper('encread', wasmExports['encread'], 3);
  _whatis = Module['_whatis'] = createExportWrapper('whatis', wasmExports['whatis'], 2);
  _uncurse = Module['_uncurse'] = createExportWrapper('uncurse', wasmExports['uncurse'], 1);
  _rs_write = Module['_rs_write'] = createExportWrapper('rs_write', wasmExports['rs_write'], 3);
  _rs_read = Module['_rs_read'] = createExportWrapper('rs_read', wasmExports['rs_read'], 3);
  _rs_write_int = Module['_rs_write_int'] = createExportWrapper('rs_write_int', wasmExports['rs_write_int'], 2);
  _rs_read_int = Module['_rs_read_int'] = createExportWrapper('rs_read_int', wasmExports['rs_read_int'], 2);
  _rs_write_char = Module['_rs_write_char'] = createExportWrapper('rs_write_char', wasmExports['rs_write_char'], 2);
  _rs_read_char = Module['_rs_read_char'] = createExportWrapper('rs_read_char', wasmExports['rs_read_char'], 2);
  _rs_write_chars = Module['_rs_write_chars'] = createExportWrapper('rs_write_chars', wasmExports['rs_write_chars'], 3);
  _rs_read_chars = Module['_rs_read_chars'] = createExportWrapper('rs_read_chars', wasmExports['rs_read_chars'], 3);
  _rs_write_ints = Module['_rs_write_ints'] = createExportWrapper('rs_write_ints', wasmExports['rs_write_ints'], 3);
  _rs_read_ints = Module['_rs_read_ints'] = createExportWrapper('rs_read_ints', wasmExports['rs_read_ints'], 3);
  _rs_write_boolean = Module['_rs_write_boolean'] = createExportWrapper('rs_write_boolean', wasmExports['rs_write_boolean'], 2);
  _rs_read_boolean = Module['_rs_read_boolean'] = createExportWrapper('rs_read_boolean', wasmExports['rs_read_boolean'], 2);
  _rs_write_booleans = Module['_rs_write_booleans'] = createExportWrapper('rs_write_booleans', wasmExports['rs_write_booleans'], 3);
  _rs_read_booleans = Module['_rs_read_booleans'] = createExportWrapper('rs_read_booleans', wasmExports['rs_read_booleans'], 3);
  _rs_write_short = Module['_rs_write_short'] = createExportWrapper('rs_write_short', wasmExports['rs_write_short'], 2);
  _rs_read_short = Module['_rs_read_short'] = createExportWrapper('rs_read_short', wasmExports['rs_read_short'], 2);
  _rs_write_shorts = Module['_rs_write_shorts'] = createExportWrapper('rs_write_shorts', wasmExports['rs_write_shorts'], 3);
  _rs_read_shorts = Module['_rs_read_shorts'] = createExportWrapper('rs_read_shorts', wasmExports['rs_read_shorts'], 3);
  _rs_write_ushort = Module['_rs_write_ushort'] = createExportWrapper('rs_write_ushort', wasmExports['rs_write_ushort'], 2);
  _rs_read_ushort = Module['_rs_read_ushort'] = createExportWrapper('rs_read_ushort', wasmExports['rs_read_ushort'], 2);
  _rs_write_uint = Module['_rs_write_uint'] = createExportWrapper('rs_write_uint', wasmExports['rs_write_uint'], 2);
  _rs_read_uint = Module['_rs_read_uint'] = createExportWrapper('rs_read_uint', wasmExports['rs_read_uint'], 2);
  _rs_write_marker = Module['_rs_write_marker'] = createExportWrapper('rs_write_marker', wasmExports['rs_write_marker'], 2);
  _rs_read_marker = Module['_rs_read_marker'] = createExportWrapper('rs_read_marker', wasmExports['rs_read_marker'], 2);
  _rs_write_string = Module['_rs_write_string'] = createExportWrapper('rs_write_string', wasmExports['rs_write_string'], 2);
  _rs_read_string = Module['_rs_read_string'] = createExportWrapper('rs_read_string', wasmExports['rs_read_string'], 3);
  _rs_read_new_string = Module['_rs_read_new_string'] = createExportWrapper('rs_read_new_string', wasmExports['rs_read_new_string'], 2);
  _rs_write_strings = Module['_rs_write_strings'] = createExportWrapper('rs_write_strings', wasmExports['rs_write_strings'], 3);
  _rs_read_strings = Module['_rs_read_strings'] = createExportWrapper('rs_read_strings', wasmExports['rs_read_strings'], 4);
  _rs_read_new_strings = Module['_rs_read_new_strings'] = createExportWrapper('rs_read_new_strings', wasmExports['rs_read_new_strings'], 3);
  _rs_write_string_index = Module['_rs_write_string_index'] = createExportWrapper('rs_write_string_index', wasmExports['rs_write_string_index'], 4);
  _rs_read_string_index = Module['_rs_read_string_index'] = createExportWrapper('rs_read_string_index', wasmExports['rs_read_string_index'], 4);
  _rs_write_str_t = Module['_rs_write_str_t'] = createExportWrapper('rs_write_str_t', wasmExports['rs_write_str_t'], 2);
  _rs_read_str_t = Module['_rs_read_str_t'] = createExportWrapper('rs_read_str_t', wasmExports['rs_read_str_t'], 2);
  _rs_write_coord = Module['_rs_write_coord'] = createExportWrapper('rs_write_coord', wasmExports['rs_write_coord'], 2);
  _rs_read_coord = Module['_rs_read_coord'] = createExportWrapper('rs_read_coord', wasmExports['rs_read_coord'], 2);
  _rs_write_window = Module['_rs_write_window'] = createExportWrapper('rs_write_window', wasmExports['rs_write_window'], 2);
  _mvwinch = Module['_mvwinch'] = createExportWrapper('mvwinch', wasmExports['mvwinch'], 3);
  _rs_read_window = Module['_rs_read_window'] = createExportWrapper('rs_read_window', wasmExports['rs_read_window'], 2);
  _mvwaddch = Module['_mvwaddch'] = createExportWrapper('mvwaddch', wasmExports['mvwaddch'], 4);
  _get_list_item = Module['_get_list_item'] = createExportWrapper('get_list_item', wasmExports['get_list_item'], 2);
  _find_list_ptr = Module['_find_list_ptr'] = createExportWrapper('find_list_ptr', wasmExports['find_list_ptr'], 2);
  _list_size = Module['_list_size'] = createExportWrapper('list_size', wasmExports['list_size'], 1);
  _rs_write_stats = Module['_rs_write_stats'] = createExportWrapper('rs_write_stats', wasmExports['rs_write_stats'], 2);
  _rs_read_stats = Module['_rs_read_stats'] = createExportWrapper('rs_read_stats', wasmExports['rs_read_stats'], 2);
  _rs_write_stone_index = Module['_rs_write_stone_index'] = createExportWrapper('rs_write_stone_index', wasmExports['rs_write_stone_index'], 4);
  _rs_read_stone_index = Module['_rs_read_stone_index'] = createExportWrapper('rs_read_stone_index', wasmExports['rs_read_stone_index'], 4);
  _rs_write_scrolls = Module['_rs_write_scrolls'] = createExportWrapper('rs_write_scrolls', wasmExports['rs_write_scrolls'], 1);
  _rs_read_scrolls = Module['_rs_read_scrolls'] = createExportWrapper('rs_read_scrolls', wasmExports['rs_read_scrolls'], 1);
  _rs_write_potions = Module['_rs_write_potions'] = createExportWrapper('rs_write_potions', wasmExports['rs_write_potions'], 1);
  _rs_read_potions = Module['_rs_read_potions'] = createExportWrapper('rs_read_potions', wasmExports['rs_read_potions'], 1);
  _rs_write_rings = Module['_rs_write_rings'] = createExportWrapper('rs_write_rings', wasmExports['rs_write_rings'], 1);
  _rs_read_rings = Module['_rs_read_rings'] = createExportWrapper('rs_read_rings', wasmExports['rs_read_rings'], 1);
  _rs_write_sticks = Module['_rs_write_sticks'] = createExportWrapper('rs_write_sticks', wasmExports['rs_write_sticks'], 1);
  _rs_read_sticks = Module['_rs_read_sticks'] = createExportWrapper('rs_read_sticks', wasmExports['rs_read_sticks'], 1);
  _rs_write_daemons = Module['_rs_write_daemons'] = createExportWrapper('rs_write_daemons', wasmExports['rs_write_daemons'], 3);
  _rs_read_daemons = Module['_rs_read_daemons'] = createExportWrapper('rs_read_daemons', wasmExports['rs_read_daemons'], 3);
  _rs_write_obj_info = Module['_rs_write_obj_info'] = createExportWrapper('rs_write_obj_info', wasmExports['rs_write_obj_info'], 3);
  _rs_read_obj_info = Module['_rs_read_obj_info'] = createExportWrapper('rs_read_obj_info', wasmExports['rs_read_obj_info'], 3);
  _rs_write_room = Module['_rs_write_room'] = createExportWrapper('rs_write_room', wasmExports['rs_write_room'], 2);
  _rs_read_room = Module['_rs_read_room'] = createExportWrapper('rs_read_room', wasmExports['rs_read_room'], 2);
  _rs_write_rooms = Module['_rs_write_rooms'] = createExportWrapper('rs_write_rooms', wasmExports['rs_write_rooms'], 3);
  _rs_read_rooms = Module['_rs_read_rooms'] = createExportWrapper('rs_read_rooms', wasmExports['rs_read_rooms'], 3);
  _rs_write_room_reference = Module['_rs_write_room_reference'] = createExportWrapper('rs_write_room_reference', wasmExports['rs_write_room_reference'], 2);
  _rs_read_room_reference = Module['_rs_read_room_reference'] = createExportWrapper('rs_read_room_reference', wasmExports['rs_read_room_reference'], 2);
  _rs_write_monsters = Module['_rs_write_monsters'] = createExportWrapper('rs_write_monsters', wasmExports['rs_write_monsters'], 3);
  _rs_read_monsters = Module['_rs_read_monsters'] = createExportWrapper('rs_read_monsters', wasmExports['rs_read_monsters'], 3);
  _rs_write_object = Module['_rs_write_object'] = createExportWrapper('rs_write_object', wasmExports['rs_write_object'], 2);
  _rs_read_object = Module['_rs_read_object'] = createExportWrapper('rs_read_object', wasmExports['rs_read_object'], 2);
  _rs_write_object_list = Module['_rs_write_object_list'] = createExportWrapper('rs_write_object_list', wasmExports['rs_write_object_list'], 2);
  _rs_read_object_list = Module['_rs_read_object_list'] = createExportWrapper('rs_read_object_list', wasmExports['rs_read_object_list'], 2);
  _rs_write_object_reference = Module['_rs_write_object_reference'] = createExportWrapper('rs_write_object_reference', wasmExports['rs_write_object_reference'], 3);
  _rs_read_object_reference = Module['_rs_read_object_reference'] = createExportWrapper('rs_read_object_reference', wasmExports['rs_read_object_reference'], 3);
  _find_room_coord = Module['_find_room_coord'] = createExportWrapper('find_room_coord', wasmExports['find_room_coord'], 3);
  _find_thing_coord = Module['_find_thing_coord'] = createExportWrapper('find_thing_coord', wasmExports['find_thing_coord'], 2);
  _find_object_coord = Module['_find_object_coord'] = createExportWrapper('find_object_coord', wasmExports['find_object_coord'], 2);
  _rs_write_thing = Module['_rs_write_thing'] = createExportWrapper('rs_write_thing', wasmExports['rs_write_thing'], 2);
  _rs_read_thing = Module['_rs_read_thing'] = createExportWrapper('rs_read_thing', wasmExports['rs_read_thing'], 2);
  _rs_fix_thing = Module['_rs_fix_thing'] = createExportWrapper('rs_fix_thing', wasmExports['rs_fix_thing'], 1);
  _rs_write_thing_list = Module['_rs_write_thing_list'] = createExportWrapper('rs_write_thing_list', wasmExports['rs_write_thing_list'], 2);
  _rs_read_thing_list = Module['_rs_read_thing_list'] = createExportWrapper('rs_read_thing_list', wasmExports['rs_read_thing_list'], 2);
  _rs_fix_thing_list = Module['_rs_fix_thing_list'] = createExportWrapper('rs_fix_thing_list', wasmExports['rs_fix_thing_list'], 1);
  _rs_write_thing_reference = Module['_rs_write_thing_reference'] = createExportWrapper('rs_write_thing_reference', wasmExports['rs_write_thing_reference'], 3);
  _rs_read_thing_reference = Module['_rs_read_thing_reference'] = createExportWrapper('rs_read_thing_reference', wasmExports['rs_read_thing_reference'], 3);
  _rs_write_thing_references = Module['_rs_write_thing_references'] = createExportWrapper('rs_write_thing_references', wasmExports['rs_write_thing_references'], 4);
  _rs_read_thing_references = Module['_rs_read_thing_references'] = createExportWrapper('rs_read_thing_references', wasmExports['rs_read_thing_references'], 4);
  _rs_write_places = Module['_rs_write_places'] = createExportWrapper('rs_write_places', wasmExports['rs_write_places'], 3);
  _rs_read_places = Module['_rs_read_places'] = createExportWrapper('rs_read_places', wasmExports['rs_read_places'], 3);
  _rs_save_file = Module['_rs_save_file'] = createExportWrapper('rs_save_file', wasmExports['rs_save_file'], 1);
  _rs_restore_file = Module['_rs_restore_file'] = createExportWrapper('rs_restore_file', wasmExports['rs_restore_file'], 1);
  _rg_state_save_bytes = Module['_rg_state_save_bytes'] = createExportWrapper('rg_state_save_bytes', wasmExports['rg_state_save_bytes'], 2);
  _rg_state_load_bytes = Module['_rg_state_load_bytes'] = createExportWrapper('rg_state_load_bytes', wasmExports['rg_state_load_bytes'], 2);
  _fix_stick = Module['_fix_stick'] = createExportWrapper('fix_stick', wasmExports['fix_stick'], 1);
  _drain = Module['_drain'] = createExportWrapper('drain', wasmExports['drain'], 0);
  _do_motion = Module['_do_motion'] = createExportWrapper('do_motion', wasmExports['do_motion'], 3);
  _hit_monster = Module['_hit_monster'] = createExportWrapper('hit_monster', wasmExports['hit_monster'], 3);
  _rg_host_map_effect = Module['_rg_host_map_effect'] = createExportWrapper('rg_host_map_effect', wasmExports['rg_host_map_effect'], 4);
  _charge_str = Module['_charge_str'] = createExportWrapper('charge_str', wasmExports['charge_str'], 1);
  _rg_semantic_item = Module['_rg_semantic_item'] = createExportWrapper('rg_semantic_item', wasmExports['rg_semantic_item'], 3);
  _nameit = Module['_nameit'] = createExportWrapper('nameit', wasmExports['nameit'], 5);
  _nullstr = Module['_nullstr'] = createExportWrapper('nullstr', wasmExports['nullstr'], 1);
  _pick_one = Module['_pick_one'] = createExportWrapper('pick_one', wasmExports['pick_one'], 2);
  _rg_menu_state_get = Module['_rg_menu_state_get'] = createExportWrapper('rg_menu_state_get', wasmExports['rg_menu_state_get'], 1);
  _rg_menu_state_set = Module['_rg_menu_state_set'] = createExportWrapper('rg_menu_state_set', wasmExports['rg_menu_state_set'], 1);
  _print_disc = Module['_print_disc'] = createExportWrapper('print_disc', wasmExports['print_disc'], 1);
  _nothing = Module['_nothing'] = createExportWrapper('nothing', wasmExports['nothing'], 1);
  _newwin = Module['_newwin'] = createExportWrapper('newwin', wasmExports['newwin'], 4);
  _subwin = Module['_subwin'] = createExportWrapper('subwin', wasmExports['subwin'], 5);
  _mvwin = Module['_mvwin'] = createExportWrapper('mvwin', wasmExports['mvwin'], 3);
  _werase = Module['_werase'] = createExportWrapper('werase', wasmExports['werase'], 1);
  _set_order = Module['_set_order'] = createExportWrapper('set_order', wasmExports['set_order'], 2);
  _type_name = Module['_type_name'] = createExportWrapper('type_name', wasmExports['type_name'], 1);
  _set_know = Module['_set_know'] = createExportWrapper('set_know', wasmExports['set_know'], 2);
  _xntohl = Module['_xntohl'] = createExportWrapper('xntohl', wasmExports['xntohl'], 1);
  _xhtonl = Module['_xhtonl'] = createExportWrapper('xhtonl', wasmExports['xhtonl'], 1);
  _xcrypt = Module['_xcrypt'] = createExportWrapper('xcrypt', wasmExports['xcrypt'], 2);
  _rg_core_turn = Module['_rg_core_turn'] = createExportWrapper('rg_core_turn', wasmExports['rg_core_turn'], 0);
  _rg_core_set_turn = Module['_rg_core_set_turn'] = createExportWrapper('rg_core_set_turn', wasmExports['rg_core_set_turn'], 1);
  _rg_core_pending = Module['_rg_core_pending'] = createExportWrapper('rg_core_pending', wasmExports['rg_core_pending'], 1);
  _rg_knowledge_present = Module['_rg_knowledge_present'] = createExportWrapper('rg_knowledge_present', wasmExports['rg_knowledge_present'], 0);
  _rg_host_outcome = Module['_rg_host_outcome'] = createExportWrapper('rg_host_outcome', wasmExports['rg_host_outcome'], 2);
  _rg_core_start = Module['_rg_core_start'] = createExportWrapper('rg_core_start', wasmExports['rg_core_start'], 2);
  _initscr = Module['_initscr'] = createExportWrapper('initscr', wasmExports['initscr'], 0);
  _rg_host_restore_data = Module['_rg_host_restore_data'] = createExportWrapper('rg_host_restore_data', wasmExports['rg_host_restore_data'], 2);
  _rg_core_load_bytes = Module['_rg_core_load_bytes'] = createExportWrapper('rg_core_load_bytes', wasmExports['rg_core_load_bytes'], 2);
  _rg_core_runtime_export = Module['_rg_core_runtime_export'] = createExportWrapper('rg_core_runtime_export', wasmExports['rg_core_runtime_export'], 2);
  _rg_core_runtime_validate = Module['_rg_core_runtime_validate'] = createExportWrapper('rg_core_runtime_validate', wasmExports['rg_core_runtime_validate'], 2);
  _rg_core_runtime_import = Module['_rg_core_runtime_import'] = createExportWrapper('rg_core_runtime_import', wasmExports['rg_core_runtime_import'], 2);
  _rg_core_inspect = Module['_rg_core_inspect'] = createExportWrapper('rg_core_inspect', wasmExports['rg_core_inspect'], 2);
  _rg_knowledge_cells = Module['_rg_knowledge_cells'] = createExportWrapper('rg_knowledge_cells', wasmExports['rg_knowledge_cells'], 0);
  _rg_console_getchar = Module['_rg_console_getchar'] = createExportWrapper('rg_console_getchar', wasmExports['rg_console_getchar'], 0);
  _erase = Module['_erase'] = createExportWrapper('erase', wasmExports['erase'], 0);
  _mvwaddstr = Module['_mvwaddstr'] = createExportWrapper('mvwaddstr', wasmExports['mvwaddstr'], 4);
  _winch = Module['_winch'] = createExportWrapper('winch', wasmExports['winch'], 1);
  _wstandout = Module['_wstandout'] = createExportWrapper('wstandout', wasmExports['wstandout'], 1);
  _wstandend = Module['_wstandend'] = createExportWrapper('wstandend', wasmExports['wstandend'], 1);
  _rg_knowledge_view = Module['_rg_knowledge_view'] = createExportWrapper('rg_knowledge_view', wasmExports['rg_knowledge_view'], 0);
  _rg_semantic_map_terrain = Module['_rg_semantic_map_terrain'] = createExportWrapper('rg_semantic_map_terrain', wasmExports['rg_semantic_map_terrain'], 3);
  _rg_host_present = Module['_rg_host_present'] = createExportWrapper('rg_host_present', wasmExports['rg_host_present'], 3);
  _idlok = Module['_idlok'] = createExportWrapper('idlok', wasmExports['idlok'], 2);
  _keypad = Module['_keypad'] = createExportWrapper('keypad', wasmExports['keypad'], 2);
  _raw = Module['_raw'] = createExportWrapper('raw', wasmExports['raw'], 0);
  _noecho = Module['_noecho'] = createExportWrapper('noecho', wasmExports['noecho'], 0);
  _rg_host_read_key = Module['_rg_host_read_key'] = createExportWrapper('rg_host_read_key', wasmExports['rg_host_read_key'], 0);
  _wgetch = Module['_wgetch'] = createExportWrapper('wgetch', wasmExports['wgetch'], 1);
  _rg_host_flush_input = Module['_rg_host_flush_input'] = createExportWrapper('rg_host_flush_input', wasmExports['rg_host_flush_input'], 0);
  _rg_knowledge_export = Module['_rg_knowledge_export'] = createExportWrapper('rg_knowledge_export', wasmExports['rg_knowledge_export'], 2);
  _rg_knowledge_validate = Module['_rg_knowledge_validate'] = createExportWrapper('rg_knowledge_validate', wasmExports['rg_knowledge_validate'], 2);
  _rg_knowledge_import = Module['_rg_knowledge_import'] = createExportWrapper('rg_knowledge_import', wasmExports['rg_knowledge_import'], 2);
  _rg_semantic_argument = Module['_rg_semantic_argument'] = createExportWrapper('rg_semantic_argument', wasmExports['rg_semantic_argument'], 3);
  ___trunctfdf2 = Module['___trunctfdf2'] = createExportWrapper('__trunctfdf2', wasmExports['__trunctfdf2'], 2);
  _rg_host_ui = Module['_rg_host_ui'] = createExportWrapper('rg_host_ui', wasmExports['rg_host_ui'], 6);
  _rg_core_save_bytes = Module['_rg_core_save_bytes'] = createExportWrapper('rg_core_save_bytes', wasmExports['rg_core_save_bytes'], 2);
  _rg_core_save_free = Module['_rg_core_save_free'] = createExportWrapper('rg_core_save_free', wasmExports['rg_core_save_free'], 1);
  _rg_host_map_terrain = Module['_rg_host_map_terrain'] = createExportWrapper('rg_host_map_terrain', wasmExports['rg_host_map_terrain'], 3);
  _rg_semantic_category = Module['_rg_semantic_category'] = createExportWrapper('rg_semantic_category', wasmExports['rg_semantic_category'], 2);
  _memcmp = createExportWrapper('memcmp', wasmExports['memcmp'], 3);
  _rg_run = Module['_rg_run'] = createExportWrapper('rg_run', wasmExports['rg_run'], 2);
  _rg_snapshot_json = Module['_rg_snapshot_json'] = createExportWrapper('rg_snapshot_json', wasmExports['rg_snapshot_json'], 0);
  _rg_string_free = Module['_rg_string_free'] = createExportWrapper('rg_string_free', wasmExports['rg_string_free'], 1);
  _rg_validate_envelope = Module['_rg_validate_envelope'] = createExportWrapper('rg_validate_envelope', wasmExports['rg_validate_envelope'], 2);
  ___lshrti3 = Module['___lshrti3'] = createExportWrapper('__lshrti3', wasmExports['__lshrti3'], 4);
  ___multi3 = Module['___multi3'] = createExportWrapper('__multi3', wasmExports['__multi3'], 5);
  ___powidf2 = Module['___powidf2'] = createExportWrapper('__powidf2', wasmExports['__powidf2'], 2);
  _round = Module['_round'] = createExportWrapper('round', wasmExports['round'], 1);
  ___ashlti3 = Module['___ashlti3'] = createExportWrapper('__ashlti3', wasmExports['__ashlti3'], 4);
  ___udivti3 = Module['___udivti3'] = createExportWrapper('__udivti3', wasmExports['__udivti3'], 5);
  ___divti3 = Module['___divti3'] = createExportWrapper('__divti3', wasmExports['__divti3'], 5);
  _fmod = Module['_fmod'] = createExportWrapper('fmod', wasmExports['fmod'], 2);
  _fmodf = Module['_fmodf'] = createExportWrapper('fmodf', wasmExports['fmodf'], 2);
  ___modti3 = Module['___modti3'] = createExportWrapper('__modti3', wasmExports['__modti3'], 5);
  ___umodti3 = Module['___umodti3'] = createExportWrapper('__umodti3', wasmExports['__umodti3'], 5);
  _rust_eh_personality = Module['_rust_eh_personality'] = createExportWrapper('rust_eh_personality', wasmExports['rust_eh_personality'], 5);
  ___truncsfhf2 = Module['___truncsfhf2'] = createExportWrapper('__truncsfhf2', wasmExports['__truncsfhf2'], 1);
  ___extendhfsf2 = Module['___extendhfsf2'] = createExportWrapper('__extendhfsf2', wasmExports['__extendhfsf2'], 1);
  ___muloti4 = Module['___muloti4'] = createExportWrapper('__muloti4', wasmExports['__muloti4'], 6);
  _fmaf128 = Module['_fmaf128'] = createExportWrapper('fmaf128', wasmExports['fmaf128'], 7);
  _sqrtf128 = Module['_sqrtf128'] = createExportWrapper('sqrtf128', wasmExports['sqrtf128'], 3);
  _sqrtf16 = Module['_sqrtf16'] = createExportWrapper('sqrtf16', wasmExports['sqrtf16'], 1);
  _fmodf128 = Module['_fmodf128'] = createExportWrapper('fmodf128', wasmExports['fmodf128'], 5);
  _fmodf16 = Module['_fmodf16'] = createExportWrapper('fmodf16', wasmExports['fmodf16'], 2);
  _ceilf128 = Module['_ceilf128'] = createExportWrapper('ceilf128', wasmExports['ceilf128'], 3);
  _ceilf16 = Module['_ceilf16'] = createExportWrapper('ceilf16', wasmExports['ceilf16'], 1);
  _floorf128 = Module['_floorf128'] = createExportWrapper('floorf128', wasmExports['floorf128'], 3);
  _floorf16 = Module['_floorf16'] = createExportWrapper('floorf16', wasmExports['floorf16'], 1);
  _roundf16 = Module['_roundf16'] = createExportWrapper('roundf16', wasmExports['roundf16'], 1);
  _roundf128 = Module['_roundf128'] = createExportWrapper('roundf128', wasmExports['roundf128'], 3);
  _rintf128 = Module['_rintf128'] = createExportWrapper('rintf128', wasmExports['rintf128'], 3);
  _roundevenf128 = Module['_roundevenf128'] = createExportWrapper('roundevenf128', wasmExports['roundevenf128'], 3);
  _rintf16 = Module['_rintf16'] = createExportWrapper('rintf16', wasmExports['rintf16'], 1);
  _roundevenf16 = Module['_roundevenf16'] = createExportWrapper('roundevenf16', wasmExports['roundevenf16'], 1);
  _truncf128 = Module['_truncf128'] = createExportWrapper('truncf128', wasmExports['truncf128'], 3);
  _truncf16 = Module['_truncf16'] = createExportWrapper('truncf16', wasmExports['truncf16'], 1);
  _fmaximum_numf16 = Module['_fmaximum_numf16'] = createExportWrapper('fmaximum_numf16', wasmExports['fmaximum_numf16'], 2);
  _fminimum_numf128 = Module['_fminimum_numf128'] = createExportWrapper('fminimum_numf128', wasmExports['fminimum_numf128'], 5);
  _fmaximum_numf128 = Module['_fmaximum_numf128'] = createExportWrapper('fmaximum_numf128', wasmExports['fmaximum_numf128'], 5);
  _fminimum_numf16 = Module['_fminimum_numf16'] = createExportWrapper('fminimum_numf16', wasmExports['fminimum_numf16'], 2);
  _fminimumf128 = Module['_fminimumf128'] = createExportWrapper('fminimumf128', wasmExports['fminimumf128'], 5);
  _fminimumf16 = Module['_fminimumf16'] = createExportWrapper('fminimumf16', wasmExports['fminimumf16'], 2);
  _fmaximumf128 = Module['_fmaximumf128'] = createExportWrapper('fmaximumf128', wasmExports['fmaximumf128'], 5);
  _fmaximumf16 = Module['_fmaximumf16'] = createExportWrapper('fmaximumf16', wasmExports['fmaximumf16'], 2);
  _copysignf16 = Module['_copysignf16'] = createExportWrapper('copysignf16', wasmExports['copysignf16'], 2);
  _copysignf128 = Module['_copysignf128'] = createExportWrapper('copysignf128', wasmExports['copysignf128'], 5);
  _fmaxf128 = Module['_fmaxf128'] = createExportWrapper('fmaxf128', wasmExports['fmaxf128'], 5);
  _fminf16 = Module['_fminf16'] = createExportWrapper('fminf16', wasmExports['fminf16'], 2);
  _fminf128 = Module['_fminf128'] = createExportWrapper('fminf128', wasmExports['fminf128'], 5);
  _fmaxf16 = Module['_fmaxf16'] = createExportWrapper('fmaxf16', wasmExports['fmaxf16'], 2);
  ___floatunsitf = Module['___floatunsitf'] = createExportWrapper('__floatunsitf', wasmExports['__floatunsitf'], 2);
  ___floatunsidf = Module['___floatunsidf'] = createExportWrapper('__floatunsidf', wasmExports['__floatunsidf'], 1);
  ___floatunditf = Module['___floatunditf'] = createExportWrapper('__floatunditf', wasmExports['__floatunditf'], 2);
  ___eqtf2 = Module['___eqtf2'] = createExportWrapper('__eqtf2', wasmExports['__eqtf2'], 4);
  ___gehf2 = Module['___gehf2'] = createExportWrapper('__gehf2', wasmExports['__gehf2'], 2);
  ___eqhf2 = Module['___eqhf2'] = createExportWrapper('__eqhf2', wasmExports['__eqhf2'], 2);
  ___nehf2 = Module['___nehf2'] = createExportWrapper('__nehf2', wasmExports['__nehf2'], 2);
  ___netf2 = Module['___netf2'] = createExportWrapper('__netf2', wasmExports['__netf2'], 4);
  ___lthf2 = Module['___lthf2'] = createExportWrapper('__lthf2', wasmExports['__lthf2'], 2);
  ___lttf2 = Module['___lttf2'] = createExportWrapper('__lttf2', wasmExports['__lttf2'], 4);
  ___lehf2 = Module['___lehf2'] = createExportWrapper('__lehf2', wasmExports['__lehf2'], 2);
  ___letf2 = Module['___letf2'] = createExportWrapper('__letf2', wasmExports['__letf2'], 4);
  ___gttf2 = Module['___gttf2'] = createExportWrapper('__gttf2', wasmExports['__gttf2'], 4);
  ___gthf2 = Module['___gthf2'] = createExportWrapper('__gthf2', wasmExports['__gthf2'], 2);
  ___getf2 = Module['___getf2'] = createExportWrapper('__getf2', wasmExports['__getf2'], 4);
  _fdimf = Module['_fdimf'] = createExportWrapper('fdimf', wasmExports['fdimf'], 2);
  _fdimf16 = Module['_fdimf16'] = createExportWrapper('fdimf16', wasmExports['fdimf16'], 2);
  _fdim = Module['_fdim'] = createExportWrapper('fdim', wasmExports['fdim'], 2);
  _fdimf128 = Module['_fdimf128'] = createExportWrapper('fdimf128', wasmExports['fdimf128'], 5);
  ___subtf3 = Module['___subtf3'] = createExportWrapper('__subtf3', wasmExports['__subtf3'], 5);
  ___subhf3 = Module['___subhf3'] = createExportWrapper('__subhf3', wasmExports['__subhf3'], 2);
  _fabsf16 = Module['_fabsf16'] = createExportWrapper('fabsf16', wasmExports['fabsf16'], 1);
  _fabsf128 = Module['_fabsf128'] = createExportWrapper('fabsf128', wasmExports['fabsf128'], 3);
  ___unordtf2 = Module['___unordtf2'] = createExportWrapper('__unordtf2', wasmExports['__unordtf2'], 4);
  ___unordhf2 = Module['___unordhf2'] = createExportWrapper('__unordhf2', wasmExports['__unordhf2'], 2);
  ___floatuntitf = Module['___floatuntitf'] = createExportWrapper('__floatuntitf', wasmExports['__floatuntitf'], 3);
  ___fixunstfdi = Module['___fixunstfdi'] = createExportWrapper('__fixunstfdi', wasmExports['__fixunstfdi'], 2);
  ___fixunstfti = Module['___fixunstfti'] = createExportWrapper('__fixunstfti', wasmExports['__fixunstfti'], 3);
  ___fixunstfsi = Module['___fixunstfsi'] = createExportWrapper('__fixunstfsi', wasmExports['__fixunstfsi'], 2);
  ___udivmodsi4 = Module['___udivmodsi4'] = createExportWrapper('__udivmodsi4', wasmExports['__udivmodsi4'], 3);
  ___eqdf2 = Module['___eqdf2'] = createExportWrapper('__eqdf2', wasmExports['__eqdf2'], 2);
  _trunc = Module['_trunc'] = createExportWrapper('trunc', wasmExports['trunc'], 1);
  ___divtf3 = Module['___divtf3'] = createExportWrapper('__divtf3', wasmExports['__divtf3'], 5);
  ___truncdfsf2 = Module['___truncdfsf2'] = createExportWrapper('__truncdfsf2', wasmExports['__truncdfsf2'], 1);
  _truncf = Module['_truncf'] = createExportWrapper('truncf', wasmExports['truncf'], 1);
  ___umodsi3 = Module['___umodsi3'] = createExportWrapper('__umodsi3', wasmExports['__umodsi3'], 2);
  ___truncdfhf2 = Module['___truncdfhf2'] = createExportWrapper('__truncdfhf2', wasmExports['__truncdfhf2'], 1);
  ___fixunsdfti = Module['___fixunsdfti'] = createExportWrapper('__fixunsdfti', wasmExports['__fixunsdfti'], 2);
  ___trunctfhf2 = Module['___trunctfhf2'] = createExportWrapper('__trunctfhf2', wasmExports['__trunctfhf2'], 2);
  ___floattitf = Module['___floattitf'] = createExportWrapper('__floattitf', wasmExports['__floattitf'], 3);
  ___gedf2 = Module['___gedf2'] = createExportWrapper('__gedf2', wasmExports['__gedf2'], 2);
  ___divmoddi4 = Module['___divmoddi4'] = createExportWrapper('__divmoddi4', wasmExports['__divmoddi4'], 3);
  _fmaximum_numf = Module['_fmaximum_numf'] = createExportWrapper('fmaximum_numf', wasmExports['fmaximum_numf'], 2);
  _cbrt = Module['_cbrt'] = createExportWrapper('cbrt', wasmExports['cbrt'], 1);
  ___moddi3 = Module['___moddi3'] = createExportWrapper('__moddi3', wasmExports['__moddi3'], 2);
  ___lshrdi3 = Module['___lshrdi3'] = createExportWrapper('__lshrdi3', wasmExports['__lshrdi3'], 2);
  ___fixdfdi = Module['___fixdfdi'] = createExportWrapper('__fixdfdi', wasmExports['__fixdfdi'], 1);
  ___subdf3 = Module['___subdf3'] = createExportWrapper('__subdf3', wasmExports['__subdf3'], 2);
  ___fixunssfdi = Module['___fixunssfdi'] = createExportWrapper('__fixunssfdi', wasmExports['__fixunssfdi'], 1);
  _floor = Module['_floor'] = createExportWrapper('floor', wasmExports['floor'], 1);
  ___fixunsdfdi = Module['___fixunsdfdi'] = createExportWrapper('__fixunsdfdi', wasmExports['__fixunsdfdi'], 1);
  ___rust_i128_add = Module['___rust_i128_add'] = createExportWrapper('__rust_i128_add', wasmExports['__rust_i128_add'], 5);
  ___floatuntisf = Module['___floatuntisf'] = createExportWrapper('__floatuntisf', wasmExports['__floatuntisf'], 2);
  ___extendhftf2 = Module['___extendhftf2'] = createExportWrapper('__extendhftf2', wasmExports['__extendhftf2'], 2);
  ___divmodsi4 = Module['___divmodsi4'] = createExportWrapper('__divmodsi4', wasmExports['__divmodsi4'], 3);
  _fmaximum_num = Module['_fmaximum_num'] = createExportWrapper('fmaximum_num', wasmExports['fmaximum_num'], 2);
  ___ashrdi3 = Module['___ashrdi3'] = createExportWrapper('__ashrdi3', wasmExports['__ashrdi3'], 2);
  ___mulsf3 = Module['___mulsf3'] = createExportWrapper('__mulsf3', wasmExports['__mulsf3'], 2);
  _fmaximum = Module['_fmaximum'] = createExportWrapper('fmaximum', wasmExports['fmaximum'], 2);
  ___addsf3 = Module['___addsf3'] = createExportWrapper('__addsf3', wasmExports['__addsf3'], 2);
  _rint = Module['_rint'] = createExportWrapper('rint', wasmExports['rint'], 1);
  ___udivdi3 = Module['___udivdi3'] = createExportWrapper('__udivdi3', wasmExports['__udivdi3'], 2);
  ___ashrti3 = Module['___ashrti3'] = createExportWrapper('__ashrti3', wasmExports['__ashrti3'], 4);
  _memset = Module['_memset'] = createExportWrapper('memset', wasmExports['memset'], 3);
  _cbrtf = Module['_cbrtf'] = createExportWrapper('cbrtf', wasmExports['cbrtf'], 1);
  ___mulodi4 = Module['___mulodi4'] = createExportWrapper('__mulodi4', wasmExports['__mulodi4'], 3);
  ___fixunsdfsi = Module['___fixunsdfsi'] = createExportWrapper('__fixunsdfsi', wasmExports['__fixunsdfsi'], 1);
  ___divdi3 = Module['___divdi3'] = createExportWrapper('__divdi3', wasmExports['__divdi3'], 2);
  ___fixtfti = Module['___fixtfti'] = createExportWrapper('__fixtfti', wasmExports['__fixtfti'], 3);
  ___rust_u128_addo = Module['___rust_u128_addo'] = createExportWrapper('__rust_u128_addo', wasmExports['__rust_u128_addo'], 6);
  ___extendhfdf2 = Module['___extendhfdf2'] = createExportWrapper('__extendhfdf2', wasmExports['__extendhfdf2'], 1);
  ___trunctfsf2 = Module['___trunctfsf2'] = createExportWrapper('__trunctfsf2', wasmExports['__trunctfsf2'], 2);
  _fminimum_numf = Module['_fminimum_numf'] = createExportWrapper('fminimum_numf', wasmExports['fminimum_numf'], 2);
  _fminimum = Module['_fminimum'] = createExportWrapper('fminimum', wasmExports['fminimum'], 2);
  ___adddf3 = Module['___adddf3'] = createExportWrapper('__adddf3', wasmExports['__adddf3'], 2);
  ___fixsfdi = Module['___fixsfdi'] = createExportWrapper('__fixsfdi', wasmExports['__fixsfdi'], 1);
  ___rust_i128_sub = Module['___rust_i128_sub'] = createExportWrapper('__rust_i128_sub', wasmExports['__rust_i128_sub'], 5);
  ___floatsitf = Module['___floatsitf'] = createExportWrapper('__floatsitf', wasmExports['__floatsitf'], 2);
  ___fixunssfti = Module['___fixunssfti'] = createExportWrapper('__fixunssfti', wasmExports['__fixunssfti'], 2);
  _sqrt = Module['_sqrt'] = createExportWrapper('sqrt', wasmExports['sqrt'], 1);
  ___bswapsi2 = Module['___bswapsi2'] = createExportWrapper('__bswapsi2', wasmExports['__bswapsi2'], 1);
  ___clzti2 = Module['___clzti2'] = createExportWrapper('__clzti2', wasmExports['__clzti2'], 2);
  ___gesf2 = Module['___gesf2'] = createExportWrapper('__gesf2', wasmExports['__gesf2'], 2);
  ___floatditf = Module['___floatditf'] = createExportWrapper('__floatditf', wasmExports['__floatditf'], 2);
  _fmin = Module['_fmin'] = createExportWrapper('fmin', wasmExports['fmin'], 2);
  _fmax = Module['_fmax'] = createExportWrapper('fmax', wasmExports['fmax'], 2);
  ___ltdf2 = Module['___ltdf2'] = createExportWrapper('__ltdf2', wasmExports['__ltdf2'], 2);
  ___nesf2 = Module['___nesf2'] = createExportWrapper('__nesf2', wasmExports['__nesf2'], 2);
  ___ashlsi3 = Module['___ashlsi3'] = createExportWrapper('__ashlsi3', wasmExports['__ashlsi3'], 2);
  _ceil = Module['_ceil'] = createExportWrapper('ceil', wasmExports['ceil'], 1);
  _sqrtf = Module['_sqrtf'] = createExportWrapper('sqrtf', wasmExports['sqrtf'], 1);
  ___addhf3 = Module['___addhf3'] = createExportWrapper('__addhf3', wasmExports['__addhf3'], 2);
  _fminimumf = Module['_fminimumf'] = createExportWrapper('fminimumf', wasmExports['fminimumf'], 2);
  ___ashrsi3 = Module['___ashrsi3'] = createExportWrapper('__ashrsi3', wasmExports['__ashrsi3'], 2);
  _fabsf = Module['_fabsf'] = createExportWrapper('fabsf', wasmExports['fabsf'], 1);
  ___floatdidf = Module['___floatdidf'] = createExportWrapper('__floatdidf', wasmExports['__floatdidf'], 1);
  ___gtdf2 = Module['___gtdf2'] = createExportWrapper('__gtdf2', wasmExports['__gtdf2'], 2);
  ___multf3 = Module['___multf3'] = createExportWrapper('__multf3', wasmExports['__multf3'], 5);
  ___addtf3 = Module['___addtf3'] = createExportWrapper('__addtf3', wasmExports['__addtf3'], 5);
  ___fixsfti = Module['___fixsfti'] = createExportWrapper('__fixsfti', wasmExports['__fixsfti'], 2);
  ___ctzti2 = Module['___ctzti2'] = createExportWrapper('__ctzti2', wasmExports['__ctzti2'], 2);
  ___subsf3 = Module['___subsf3'] = createExportWrapper('__subsf3', wasmExports['__subsf3'], 2);
  ___floatdisf = Module['___floatdisf'] = createExportWrapper('__floatdisf', wasmExports['__floatdisf'], 1);
  _fminf = Module['_fminf'] = createExportWrapper('fminf', wasmExports['fminf'], 2);
  ___udivsi3 = Module['___udivsi3'] = createExportWrapper('__udivsi3', wasmExports['__udivsi3'], 2);
  ___mulhf3 = Module['___mulhf3'] = createExportWrapper('__mulhf3', wasmExports['__mulhf3'], 2);
  ___muldi3 = Module['___muldi3'] = createExportWrapper('__muldi3', wasmExports['__muldi3'], 2);
  ___extendsftf2 = Module['___extendsftf2'] = createExportWrapper('__extendsftf2', wasmExports['__extendsftf2'], 2);
  ___eqsf2 = Module['___eqsf2'] = createExportWrapper('__eqsf2', wasmExports['__eqsf2'], 2);
  ___mulosi4 = Module['___mulosi4'] = createExportWrapper('__mulosi4', wasmExports['__mulosi4'], 3);
  _bcmp = Module['_bcmp'] = createExportWrapper('bcmp', wasmExports['bcmp'], 3);
  ___rust_u128_subo = Module['___rust_u128_subo'] = createExportWrapper('__rust_u128_subo', wasmExports['__rust_u128_subo'], 6);
  ___floatsisf = Module['___floatsisf'] = createExportWrapper('__floatsisf', wasmExports['__floatsisf'], 1);
  ___powitf2 = Module['___powitf2'] = createExportWrapper('__powitf2', wasmExports['__powitf2'], 4);
  ___umoddi3 = Module['___umoddi3'] = createExportWrapper('__umoddi3', wasmExports['__umoddi3'], 2);
  ___fixtfsi = Module['___fixtfsi'] = createExportWrapper('__fixtfsi', wasmExports['__fixtfsi'], 2);
  ___rust_u128_add = Module['___rust_u128_add'] = createExportWrapper('__rust_u128_add', wasmExports['__rust_u128_add'], 5);
  _fminimum_num = Module['_fminimum_num'] = createExportWrapper('fminimum_num', wasmExports['fminimum_num'], 2);
  ___divmodti4 = Module['___divmodti4'] = createExportWrapper('__divmodti4', wasmExports['__divmodti4'], 6);
  ___lesf2 = Module['___lesf2'] = createExportWrapper('__lesf2', wasmExports['__lesf2'], 2);
  _memmove = Module['_memmove'] = createExportWrapper('memmove', wasmExports['memmove'], 3);
  ___fixdfti = Module['___fixdfti'] = createExportWrapper('__fixdfti', wasmExports['__fixdfti'], 2);
  ___udivmoddi4 = Module['___udivmoddi4'] = createExportWrapper('__udivmoddi4', wasmExports['__udivmoddi4'], 3);
  ___floatunsisf = Module['___floatunsisf'] = createExportWrapper('__floatunsisf', wasmExports['__floatunsisf'], 1);
  ___unordsf2 = Module['___unordsf2'] = createExportWrapper('__unordsf2', wasmExports['__unordsf2'], 2);
  ___rust_u128_mulo = Module['___rust_u128_mulo'] = createExportWrapper('__rust_u128_mulo', wasmExports['__rust_u128_mulo'], 6);
  _fma = Module['_fma'] = createExportWrapper('fma', wasmExports['fma'], 3);
  _rintf = Module['_rintf'] = createExportWrapper('rintf', wasmExports['rintf'], 1);
  _copysignf = Module['_copysignf'] = createExportWrapper('copysignf', wasmExports['copysignf'], 2);
  ___divsf3 = Module['___divsf3'] = createExportWrapper('__divsf3', wasmExports['__divsf3'], 2);
  ___ashldi3 = Module['___ashldi3'] = createExportWrapper('__ashldi3', wasmExports['__ashldi3'], 2);
  _fmaxf = Module['_fmaxf'] = createExportWrapper('fmaxf', wasmExports['fmaxf'], 2);
  ___gnu_f2h_ieee = Module['___gnu_f2h_ieee'] = createExportWrapper('__gnu_f2h_ieee', wasmExports['__gnu_f2h_ieee'], 1);
  ___fixsfsi = Module['___fixsfsi'] = createExportWrapper('__fixsfsi', wasmExports['__fixsfsi'], 1);
  ___muldf3 = Module['___muldf3'] = createExportWrapper('__muldf3', wasmExports['__muldf3'], 2);
  ___fixunssfsi = Module['___fixunssfsi'] = createExportWrapper('__fixunssfsi', wasmExports['__fixunssfsi'], 1);
  _memcpy = createExportWrapper('memcpy', wasmExports['memcpy'], 3);
  ___fixtfdi = Module['___fixtfdi'] = createExportWrapper('__fixtfdi', wasmExports['__fixtfdi'], 2);
  _ceilf = Module['_ceilf'] = createExportWrapper('ceilf', wasmExports['ceilf'], 1);
  ___extenddftf2 = Module['___extenddftf2'] = createExportWrapper('__extenddftf2', wasmExports['__extenddftf2'], 2);
  ___ctzdi2 = Module['___ctzdi2'] = createExportWrapper('__ctzdi2', wasmExports['__ctzdi2'], 1);
  ___ledf2 = Module['___ledf2'] = createExportWrapper('__ledf2', wasmExports['__ledf2'], 2);
  ___lshrsi3 = Module['___lshrsi3'] = createExportWrapper('__lshrsi3', wasmExports['__lshrsi3'], 2);
  ___clzsi2 = Module['___clzsi2'] = createExportWrapper('__clzsi2', wasmExports['__clzsi2'], 1);
  ___rust_u128_sub = Module['___rust_u128_sub'] = createExportWrapper('__rust_u128_sub', wasmExports['__rust_u128_sub'], 5);
  ___floattidf = Module['___floattidf'] = createExportWrapper('__floattidf', wasmExports['__floattidf'], 2);
  _fmaf = Module['_fmaf'] = createExportWrapper('fmaf', wasmExports['fmaf'], 3);
  ___extendsfdf2 = Module['___extendsfdf2'] = createExportWrapper('__extendsfdf2', wasmExports['__extendsfdf2'], 1);
  ___floatuntidf = Module['___floatuntidf'] = createExportWrapper('__floatuntidf', wasmExports['__floatuntidf'], 2);
  ___nedf2 = Module['___nedf2'] = createExportWrapper('__nedf2', wasmExports['__nedf2'], 2);
  ___ltsf2 = Module['___ltsf2'] = createExportWrapper('__ltsf2', wasmExports['__ltsf2'], 2);
  ___rust_i128_mulo = Module['___rust_i128_mulo'] = createExportWrapper('__rust_i128_mulo', wasmExports['__rust_i128_mulo'], 6);
  _floorf = Module['_floorf'] = createExportWrapper('floorf', wasmExports['floorf'], 1);
  ___fixdfsi = Module['___fixdfsi'] = createExportWrapper('__fixdfsi', wasmExports['__fixdfsi'], 1);
  ___floatsidf = Module['___floatsidf'] = createExportWrapper('__floatsidf', wasmExports['__floatsidf'], 1);
  ___modsi3 = Module['___modsi3'] = createExportWrapper('__modsi3', wasmExports['__modsi3'], 2);
  ___powisf2 = Module['___powisf2'] = createExportWrapper('__powisf2', wasmExports['__powisf2'], 2);
  ___divsi3 = Module['___divsi3'] = createExportWrapper('__divsi3', wasmExports['__divsi3'], 2);
  _roundf = Module['_roundf'] = createExportWrapper('roundf', wasmExports['roundf'], 1);
  ___divdf3 = Module['___divdf3'] = createExportWrapper('__divdf3', wasmExports['__divdf3'], 2);
  ___floatundisf = Module['___floatundisf'] = createExportWrapper('__floatundisf', wasmExports['__floatundisf'], 1);
  _fabs = Module['_fabs'] = createExportWrapper('fabs', wasmExports['fabs'], 1);
  ___rust_i128_subo = Module['___rust_i128_subo'] = createExportWrapper('__rust_i128_subo', wasmExports['__rust_i128_subo'], 6);
  _fmaximumf = Module['_fmaximumf'] = createExportWrapper('fmaximumf', wasmExports['fmaximumf'], 2);
  ___floattisf = Module['___floattisf'] = createExportWrapper('__floattisf', wasmExports['__floattisf'], 2);
  ___ctzsi2 = Module['___ctzsi2'] = createExportWrapper('__ctzsi2', wasmExports['__ctzsi2'], 1);
  _roundeven = Module['_roundeven'] = createExportWrapper('roundeven', wasmExports['roundeven'], 1);
  ___gtsf2 = Module['___gtsf2'] = createExportWrapper('__gtsf2', wasmExports['__gtsf2'], 2);
  ___rust_i128_addo = Module['___rust_i128_addo'] = createExportWrapper('__rust_i128_addo', wasmExports['__rust_i128_addo'], 6);
  _roundevenf = Module['_roundevenf'] = createExportWrapper('roundevenf', wasmExports['roundevenf'], 1);
  ___floatundidf = Module['___floatundidf'] = createExportWrapper('__floatundidf', wasmExports['__floatundidf'], 1);
  ___bswapdi2 = Module['___bswapdi2'] = createExportWrapper('__bswapdi2', wasmExports['__bswapdi2'], 1);
  ___clzdi2 = Module['___clzdi2'] = createExportWrapper('__clzdi2', wasmExports['__clzdi2'], 1);
  ___gnu_h2f_ieee = Module['___gnu_h2f_ieee'] = createExportWrapper('__gnu_h2f_ieee', wasmExports['__gnu_h2f_ieee'], 1);
  ___unorddf2 = Module['___unorddf2'] = createExportWrapper('__unorddf2', wasmExports['__unorddf2'], 2);
  ___bswapti2 = Module['___bswapti2'] = createExportWrapper('__bswapti2', wasmExports['__bswapti2'], 3);
  ___udivmodti4 = Module['___udivmodti4'] = createExportWrapper('__udivmodti4', wasmExports['__udivmodti4'], 6);
  _copysign = Module['_copysign'] = createExportWrapper('copysign', wasmExports['copysign'], 2);
  _emscripten_stack_get_end = wasmExports['emscripten_stack_get_end'];
  _emscripten_stack_get_base = wasmExports['emscripten_stack_get_base'];
  _htonl = createExportWrapper('htonl', wasmExports['htonl'], 1);
  _htons = createExportWrapper('htons', wasmExports['htons'], 1);
  _ntohs = createExportWrapper('ntohs', wasmExports['ntohs'], 1);
  __emscripten_timeout = createExportWrapper('_emscripten_timeout', wasmExports['_emscripten_timeout'], 2);
  _strerror = createExportWrapper('strerror', wasmExports['strerror'], 1);
  _setThrew = createExportWrapper('setThrew', wasmExports['setThrew'], 2);
  _emscripten_stack_init = wasmExports['emscripten_stack_init'];
  _emscripten_stack_get_free = wasmExports['emscripten_stack_get_free'];
  __emscripten_stack_restore = wasmExports['_emscripten_stack_restore'];
  __emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'];
  _emscripten_stack_get_current = wasmExports['emscripten_stack_get_current'];
  ___wbindgen_start = Module['___wbindgen_start'] = createExportWrapper('__wbindgen_start', wasmExports['__wbindgen_start'], 0);
  memory = wasmMemory = wasmExports['memory'];
  _release = Module['_release'] = wasmExports['release'].value;
  _encstr = Module['_encstr'] = wasmExports['encstr'].value;
  _statlist = Module['_statlist'] = wasmExports['statlist'].value;
  _version = Module['_version'] = wasmExports['version'].value;
  _amulet = Module['_amulet'] = wasmExports['amulet'].value;
  _door_stop = Module['_door_stop'] = wasmExports['door_stop'].value;
  _fight_flush = Module['_fight_flush'] = wasmExports['fight_flush'].value;
  _firstmove = Module['_firstmove'] = wasmExports['firstmove'].value;
  _got_ltc = Module['_got_ltc'] = wasmExports['got_ltc'].value;
  _has_hit = Module['_has_hit'] = wasmExports['has_hit'].value;
  _in_shell = Module['_in_shell'] = wasmExports['in_shell'].value;
  _inv_describe = Module['_inv_describe'] = wasmExports['inv_describe'].value;
  _jump = Module['_jump'] = wasmExports['jump'].value;
  _kamikaze = Module['_kamikaze'] = wasmExports['kamikaze'].value;
  _lower_msg = Module['_lower_msg'] = wasmExports['lower_msg'].value;
  _move_on = Module['_move_on'] = wasmExports['move_on'].value;
  _msg_esc = Module['_msg_esc'] = wasmExports['msg_esc'].value;
  _passgo = Module['_passgo'] = wasmExports['passgo'].value;
  _playing = Module['_playing'] = wasmExports['playing'].value;
  _q_comm = Module['_q_comm'] = wasmExports['q_comm'].value;
  _running = Module['_running'] = wasmExports['running'].value;
  _save_msg = Module['_save_msg'] = wasmExports['save_msg'].value;
  _see_floor = Module['_see_floor'] = wasmExports['see_floor'].value;
  _stat_msg = Module['_stat_msg'] = wasmExports['stat_msg'].value;
  _terse = Module['_terse'] = wasmExports['terse'].value;
  _to_death = Module['_to_death'] = wasmExports['to_death'].value;
  _tombstone = Module['_tombstone'] = wasmExports['tombstone'].value;
  _pack_used = Module['_pack_used'] = wasmExports['pack_used'].value;
  _fruit = Module['_fruit'] = wasmExports['fruit'].value;
  _home = Module['_home'] = wasmExports['home'].value;
  _inv_t_name = Module['_inv_t_name'] = wasmExports['inv_t_name'].value;
  _l_last_comm = Module['_l_last_comm'] = wasmExports['l_last_comm'].value;
  _l_last_dir = Module['_l_last_dir'] = wasmExports['l_last_dir'].value;
  _last_comm = Module['_last_comm'] = wasmExports['last_comm'].value;
  _last_dir = Module['_last_dir'] = wasmExports['last_dir'].value;
  _tr_name = Module['_tr_name'] = wasmExports['tr_name'].value;
  _hungry_state = Module['_hungry_state'] = wasmExports['hungry_state'].value;
  _inpack = Module['_inpack'] = wasmExports['inpack'].value;
  _inv_type = Module['_inv_type'] = wasmExports['inv_type'].value;
  _level = Module['_level'] = wasmExports['level'].value;
  _mpos = Module['_mpos'] = wasmExports['mpos'].value;
  _no_food = Module['_no_food'] = wasmExports['no_food'].value;
  _a_class = Module['_a_class'] = wasmExports['a_class'].value;
  _count = Module['_count'] = wasmExports['count'].value;
  _scoreboard = Module['_scoreboard'] = wasmExports['scoreboard'].value;
  _lastscore = Module['_lastscore'] = wasmExports['lastscore'].value;
  _no_command = Module['_no_command'] = wasmExports['no_command'].value;
  _no_move = Module['_no_move'] = wasmExports['no_move'].value;
  _purse = Module['_purse'] = wasmExports['purse'].value;
  _quiet = Module['_quiet'] = wasmExports['quiet'].value;
  _vf_hit = Module['_vf_hit'] = wasmExports['vf_hit'].value;
  _e_levels = Module['_e_levels'] = wasmExports['e_levels'].value;
  _l_last_pick = Module['_l_last_pick'] = wasmExports['l_last_pick'].value;
  _last_pick = Module['_last_pick'] = wasmExports['last_pick'].value;
  _lvl_obj = Module['_lvl_obj'] = wasmExports['lvl_obj'].value;
  _mlist = Module['_mlist'] = wasmExports['mlist'].value;
  _hw = Module['_hw'] = wasmExports['hw'].value;
  _max_stats = Module['_max_stats'] = wasmExports['max_stats'].value;
  _passages = Module['_passages'] = wasmExports['passages'].value;
  _monsters = Module['_monsters'] = wasmExports['monsters'].value;
  _things = Module['_things'] = wasmExports['things'].value;
  _arm_info = Module['_arm_info'] = wasmExports['arm_info'].value;
  _pot_info = Module['_pot_info'] = wasmExports['pot_info'].value;
  _ring_info = Module['_ring_info'] = wasmExports['ring_info'].value;
  _scr_info = Module['_scr_info'] = wasmExports['scr_info'].value;
  _weap_info = Module['_weap_info'] = wasmExports['weap_info'].value;
  _ws_info = Module['_ws_info'] = wasmExports['ws_info'].value;
  _helpstr = Module['_helpstr'] = wasmExports['helpstr'].value;
  _after = Module['_after'] = wasmExports['after'].value;
  _again = Module['_again'] = wasmExports['again'].value;
  _noscore = Module['_noscore'] = wasmExports['noscore'].value;
  _seenstairs = Module['_seenstairs'] = wasmExports['seenstairs'].value;
  _dir_ch = Module['_dir_ch'] = wasmExports['dir_ch'].value;
  _file_name = Module['_file_name'] = wasmExports['file_name'].value;
  _huh = Module['_huh'] = wasmExports['huh'].value;
  _p_colors = Module['_p_colors'] = wasmExports['p_colors'].value;
  _prbuf = Module['_prbuf'] = wasmExports['prbuf'].value;
  _r_stones = Module['_r_stones'] = wasmExports['r_stones'].value;
  _runch = Module['_runch'] = wasmExports['runch'].value;
  _s_names = Module['_s_names'] = wasmExports['s_names'].value;
  _take = Module['_take'] = wasmExports['take'].value;
  _whoami = Module['_whoami'] = wasmExports['whoami'].value;
  _ws_made = Module['_ws_made'] = wasmExports['ws_made'].value;
  _ws_type = Module['_ws_type'] = wasmExports['ws_type'].value;
  _orig_dsusp = Module['_orig_dsusp'] = wasmExports['orig_dsusp'].value;
  _n_objs = Module['_n_objs'] = wasmExports['n_objs'].value;
  _ntraps = Module['_ntraps'] = wasmExports['ntraps'].value;
  _max_hit = Module['_max_hit'] = wasmExports['max_hit'].value;
  _max_level = Module['_max_level'] = wasmExports['max_level'].value;
  _food_left = Module['_food_left'] = wasmExports['food_left'].value;
  _dnum = Module['_dnum'] = wasmExports['dnum'].value;
  _seed = Module['_seed'] = wasmExports['seed'].value;
  _delta = Module['_delta'] = wasmExports['delta'].value;
  _oldpos = Module['_oldpos'] = wasmExports['oldpos'].value;
  _stairs = Module['_stairs'] = wasmExports['stairs'].value;
  _places = Module['_places'] = wasmExports['places'].value;
  _cur_armor = Module['_cur_armor'] = wasmExports['cur_armor'].value;
  _cur_ring = Module['_cur_ring'] = wasmExports['cur_ring'].value;
  _cur_weapon = Module['_cur_weapon'] = wasmExports['cur_weapon'].value;
  _player = Module['_player'] = wasmExports['player'].value;
  _oldrp = Module['_oldrp'] = wasmExports['oldrp'].value;
  _rooms = Module['_rooms'] = wasmExports['rooms'].value;
  _curscr = Module['_curscr'] = wasmExports['curscr'].value;
  _LINES = Module['_LINES'] = wasmExports['LINES'].value;
  _COLS = Module['_COLS'] = wasmExports['COLS'].value;
  _stdscr = Module['_stdscr'] = wasmExports['stdscr'].value;
  _d_list = Module['_d_list'] = wasmExports['d_list'].value;
  __indirect_function_table = wasmTable = wasmExports['__indirect_function_table'];
  _between = Module['_between'] = wasmExports['between'].value;
  _h_names = Module['_h_names'] = wasmExports['h_names'].value;
  _m_names = Module['_m_names'] = wasmExports['m_names'].value;
  _rainbow = Module['_rainbow'] = wasmExports['rainbow'].value;
  _stones = Module['_stones'] = wasmExports['stones'].value;
  _metal = Module['_metal'] = wasmExports['metal'].value;
  _wood = Module['_wood'] = wasmExports['wood'].value;
  _cNCOLORS = Module['_cNCOLORS'] = wasmExports['cNCOLORS'].value;
  _cNSTONES = Module['_cNSTONES'] = wasmExports['cNSTONES'].value;
  _cNWOOD = Module['_cNWOOD'] = wasmExports['cNWOOD'].value;
  _cNMETAL = Module['_cNMETAL'] = wasmExports['cNMETAL'].value;
  _numscores = Module['_numscores'] = wasmExports['numscores'].value;
  _Numname = Module['_Numname'] = wasmExports['Numname'].value;
  _allscore = Module['_allscore'] = wasmExports['allscore'].value;
  _nh = Module['_nh'] = wasmExports['nh'].value;
  _optlist = Module['_optlist'] = wasmExports['optlist'].value;
  _group = Module['_group'] = wasmExports['group'].value;
  _md_endian = Module['_md_endian'] = wasmExports['md_endian'].value;
  ___abort_handler = Module['___abort_handler'] = wasmExports['__abort_handler'].value;
  ___instance_terminated = Module['___instance_terminated'] = wasmExports['__instance_terminated'].value;
  ___wbindgen_externrefs = Module['___wbindgen_externrefs'] = wasmExports['__wbindgen_externrefs'];
}

var wasmImports = {
  /** @export */
  __assert_fail: ___assert_fail,
  /** @export */
  __call_sighandler: ___call_sighandler,
  /** @export */
  __syscall_fstat64: ___syscall_fstat64,
  /** @export */
  __syscall_getcwd: ___syscall_getcwd,
  /** @export */
  __syscall_lstat64: ___syscall_lstat64,
  /** @export */
  __syscall_newfstatat: ___syscall_newfstatat,
  /** @export */
  __syscall_openat: ___syscall_openat,
  /** @export */
  __syscall_stat64: ___syscall_stat64,
  /** @export */
  __wbg_flushInput_61b4a84bc8955703: ___wbg_flushInput_61b4a84bc8955703,
  /** @export */
  __wbg_outcome_2cfb290db6eb2825: ___wbg_outcome_2cfb290db6eb2825,
  /** @export */
  __wbg_present_1f2fedfc793733b8: ___wbg_present_1f2fedfc793733b8,
  /** @export */
  __wbg_readEvent_301bd8e7f56f46db: ___wbg_readEvent_301bd8e7f56f46db,
  /** @export */
  __wbg_store_3bb7af17e4e409d3: ___wbg_store_3bb7af17e4e409d3,
  /** @export */
  __wbindgen_init_externref_table: ___wbindgen_init_externref_table,
  /** @export */
  _abort_js: __abort_js,
  /** @export */
  _emscripten_runtime_keepalive_clear: __emscripten_runtime_keepalive_clear,
  /** @export */
  _emscripten_throw_longjmp: __emscripten_throw_longjmp,
  /** @export */
  _localtime_js: __localtime_js,
  /** @export */
  _setitimer_js: __setitimer_js,
  /** @export */
  _tzset_js: __tzset_js,
  /** @export */
  emscripten_date_now: _emscripten_date_now,
  /** @export */
  emscripten_get_now: _emscripten_get_now,
  /** @export */
  emscripten_resize_heap: _emscripten_resize_heap,
  /** @export */
  environ_get: _environ_get,
  /** @export */
  environ_sizes_get: _environ_sizes_get,
  /** @export */
  fd_close: _fd_close,
  /** @export */
  fd_read: _fd_read,
  /** @export */
  fd_seek: _fd_seek,
  /** @export */
  fd_write: _fd_write,
  /** @export */
  invoke_i,
  /** @export */
  invoke_ii,
  /** @export */
  invoke_iii,
  /** @export */
  invoke_iiii,
  /** @export */
  invoke_iiiii,
  /** @export */
  invoke_v,
  /** @export */
  invoke_vii,
  /** @export */
  invoke_viii,
  /** @export */
  invoke_viiii,
  /** @export */
  proc_exit: _proc_exit
};

function invoke_iiii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_v(index) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)();
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_i(index) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)();
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_vii(index,a1,a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_iiiii(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_iii(index,a1,a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1,a2);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_ii(index,a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_viii(index,a1,a2,a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}

function invoke_viiii(index,a1,a2,a3,a4) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1,a2,a3,a4);
  } catch(e) {
    stackRestore(sp);
    if (!(e instanceof EmscriptenEH)) throw e;
    _setThrew(1, 0);
  }
}


// include: postamble.js
// === Auto-generated postamble setup entry stuff ===

var calledRun;

function stackCheckInit() {
  // This is normally called automatically during __wasm_call_ctors but need to
  // get these values before even running any of the ctors so we call it redundantly
  // here.
  _emscripten_stack_init();
  // TODO(sbc): Move writeStackCookie to native to to avoid this.
  writeStackCookie();
}

async function run() {
  assert(!calledRun);
  calledRun = true;

  stackCheckInit();

  preRun();

  if (runDependencies) {
    await resolveRunDependencies();
  }

  var setStatus = Module['setStatus'];
  if (setStatus) {
    setStatus('Running...');
    // Yield to the event loop to allow the browser to paint "Running..."
    await new Promise((resolve) => setTimeout(resolve, 1));
    // Then we want to clear the status text, but only after the rest of this function runs.
    setTimeout(setStatus, 1, '');
  }

  if (ABORT) return;

  initRuntime();

  Module['onRuntimeInitialized']?.();
  consumedModuleProp('onRuntimeInitialized');

  assert(!Module['_main'], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');

  postRun();
}

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var oldOut = out;
  var oldErr = err;
  var has = false;
  out = err = (x) => {
    has = true;
  }
  try { // it doesn't matter if it fails
    _fflush(0);
    // also flush in the JS FS layer
    for (var name of ['stdout', 'stderr']) {
      var info = FS.analyzePath('/dev/' + name);
      if (!info) return;
      var stream = info.object;
      var rdev = stream.rdev;
      var tty = TTY.ttys[rdev];
      if (tty?.output?.length) {
        has = true;
      }
    }
  } catch(e) {}
  out = oldOut;
  err = oldErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.');
  }
}

var wasmExports;

// In modularize mode the generated code is within a factory function so we
// can use await here (since it's not top-level-await).
wasmExports = await createWasm();
await run();

// end include: postamble.js

// include: postamble_modularize.js
// In MODULARIZE mode we wrap the generated code in a factory function
// and return either the Module itself, or a promise of the module.

// Assertion for attempting to access module properties on the incoming
// moduleArg.  In the past we used this object as the prototype of the module
// and assigned properties to it, but now we return a distinct object.  This
// keeps the instance private until it is ready (i.e the promise has been
// resolved).
for (const prop of Object.keys(Module)) {
  if (!(prop in moduleArg)) {
    Object.defineProperty(moduleArg, prop, {
      configurable: true,
      get() {
        abort(`Access to module property ('${prop}') is no longer possible via the module constructor argument; Instead, use the result of the module constructor.`)
      }
    });
  }
}
// end include: postamble_modularize.js



    return Module;
  };
})();

// Export using a UMD style export, or ES6 exports if selected
if (typeof exports === 'object' && typeof module === 'object') {
  module.exports = createRogueModule;
  // This default export looks redundant, but it allows TS to import this
  // commonjs style module.
  module.exports.default = createRogueModule;
} else if (typeof define === 'function' && define['amd'])
  define([], () => createRogueModule);

