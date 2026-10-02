import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(new URL('../web/event-queue.js', import.meta.url));
const require = createRequire(import.meta.url);
const EventQueue = require(modulePath);

test('a full queue preserves all unread input and reports backpressure', () => {
  const queue = new EventQueue(null, 2);
  assert.equal(queue.push(0x0100006a), true);
  assert.equal(queue.push(0x110001), true);
  assert.equal(queue.push(99), false);
  assert.equal(queue.pending, 2);
  assert.equal(queue.take(), 0x0100006a);
  assert.equal(queue.push(99), true);
  assert.equal(queue.take(), 0x110001);
  assert.equal(queue.take(), 99);
  assert.equal(queue.pending, 0);
});

test('power-of-two queue preserves order across uint32 counter rollover', () => {
  const queue = new EventQueue(null, 4);
  Atomics.store(queue.words, 0, -1);
  Atomics.store(queue.words, 1, -1);
  queue.push(104);
  queue.push(108);
  assert.equal(queue.pending, 2);
  assert.equal(queue.take(), 104);
  assert.equal(queue.take(), 108);
  assert.equal(queue.pending, 0);
});

test('closing drains existing input, then reports closure without inventing ESC', () => {
  const queue = new EventQueue(null, 2);
  queue.push(108);
  queue.close();
  assert.equal(queue.push(104), false);
  assert.equal(queue.take(), 108);
  assert.throws(() => queue.take(), /closed/i);
});

test('an empty queue waits until another thread supplies actual input', { timeout: 5000 }, async () => {
  const queue = new EventQueue(null, 2);
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Queue = require(workerData.modulePath);
    const queue = new Queue(workerData.buffer, workerData.capacity);
    parentPort.postMessage('ready');
    try { parentPort.postMessage({ event: queue.take() }); }
    catch (error) { parentPort.postMessage({ error: error.message }); }
  `, { eval: true, workerData: { modulePath, buffer: queue.buffer, capacity: 2 } });
  const messages = [];
  worker.on('message', (message) => messages.push(message));
  const result = new Promise((resolve, reject) => {
    worker.on('message', (message) => { if (typeof message === 'object') resolve(message); });
    worker.on('error', reject);
  });
  try {
    await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(messages, ['ready']);
    assert.equal(queue.push(0x0100006a), true);
    assert.deepEqual(await result, { event: 0x0100006a });
  } finally {
    queue.close();
    await worker.terminate();
  }
});
