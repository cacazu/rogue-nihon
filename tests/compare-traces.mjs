import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function describe(value) {
  const text = value === undefined ? '<missing>' : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

/** Compare JSON snapshots without masking RNG, turn, input, or visibility fields. */
export function firstDifference(expected, actual, path = '$') {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== typeof actual) {
    return { path, expected, actual };
  }
  if (typeof expected !== 'object') return { path, expected, actual };
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    return { path, expected, actual };
  }
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) {
      return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  const keys = [...new Set([...expectedKeys, ...actualKeys])].sort();
  for (const key of keys) {
    const memberPath = `${path}[${JSON.stringify(key)}]`;
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
      return { path: memberPath, expected: expected[key], actual: actual[key] };
    }
    const difference = firstDifference(expected[key], actual[key], memberPath);
    if (difference) return difference;
  }
  return null;
}

export function assertEquivalent(expected, actual, label = 'trace') {
  const difference = firstDifference(expected, actual);
  if (difference) {
    const error = new Error(`${label} differs at ${difference.path}: expected ${describe(difference.expected)}, got ${describe(difference.actual)}`);
    error.difference = difference;
    throw error;
  }
}

/** Capture C-owned state before and after host-only repaint/language/input-focus work. */
export function assertHostWorkIsPure(before, after, label = 'host-only work') {
  assertEquivalent(before, after, label);
}

export async function readTrace(file) {
  const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error(`Empty trace: ${file}`);
  if (raw.startsWith('[')) {
    const trace = JSON.parse(raw);
    if (!Array.isArray(trace)) throw new Error(`Expected an array in ${file}`);
    return trace;
  }
  return raw.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , baselineFile, separatedFile, ...extra] = process.argv;
  if (!baselineFile || !separatedFile || extra.length) {
    process.stderr.write('Usage: node compare-traces.mjs BASELINE.jsonl SEPARATED.jsonl\n');
    process.exitCode = 2;
  } else {
    try {
      const [baseline, separated] = await Promise.all([readTrace(baselineFile), readTrace(separatedFile)]);
      assertEquivalent(baseline, separated);
      process.stdout.write(`Equivalent: ${baseline.length} checkpoints\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
