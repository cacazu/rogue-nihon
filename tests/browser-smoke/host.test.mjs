import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { createPreviewServer } from "../../../tools/server.mjs";
const require = createRequire(import.meta.url), EventQueue = require("../../web/event-queue.js");

test("bounded transport rejects saturation and preserves command order across uint32 wrap", () => {
  const queue = new EventQueue(null, 4);
  queue.words[0] = -2; queue.words[1] = -2;
  for (const key of [11, 22, 33, 44]) assert.equal(queue.push(key), true);
  assert.equal(queue.pending, 4);
  assert.equal(queue.push(55), false);
  assert.deepEqual([queue.take(), queue.take(), queue.take(), queue.take()], [11, 22, 33, 44]);
  assert.equal(queue.pending, 0);
  assert.equal(queue.push(66), true); assert.equal(queue.take(), 66);
  queue.close(); assert.equal(queue.push(77), false); assert.throws(() => queue.take(), /closed/);
});
test("transport capacity prevents modulo corruption at wrapping counters", () => {
  for (const capacity of [0, 1, 3, 127, 65537, 131072]) assert.throws(() => new EventQueue(null, capacity), /power of two/);
});
test("Unicode text batch publishes all events or none, including counter wrap", () => {
  const queue = new EventQueue(null, 4);
  queue.words[0] = -2; queue.words[1] = -2;
  assert.equal(queue.pushMany([21, 0x52c7, 13]), true);
  assert.equal(queue.pushMany([0x8005, 13]), false);
  assert.equal(queue.pending, 3);
  assert.deepEqual([queue.take(), queue.take(), queue.take()], [21, 0x52c7, 13]);
  assert.equal(queue.pushMany([0x8005, 13]), true);
  assert.deepEqual([queue.take(), queue.take()], [0x8005, 13]);
});
test("original typeahead flush discards only already queued raw events", () => {
  const queue = new EventQueue(null, 4);
  queue.push(11); queue.push(22);
  const discarded = [];
  assert.equal(queue.discardPending((raw) => discarded.push(raw)), 2);
  assert.deepEqual(discarded, [11, 22]);
  assert.equal(queue.pending, 0);
  assert.equal(queue.push(33), true);
  assert.equal(queue.take(), 33);
  assert.equal(queue.discardPending(), 0);
});
test("blocking Worker wakes when the main thread publishes an input", async () => {
  const queue = new EventQueue(null, 4);
  const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');const Queue=require(workerData.module);const queue=new Queue(workerData.buffer,4);parentPort.postMessage('waiting');parentPort.postMessage(queue.take());`, { eval: true, workerData: { module: require.resolve("../../web/event-queue.js"), buffer: queue.buffer } });
  try {
    await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    const response = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    assert.equal(queue.push(1234), true);
    assert.equal(await response, 1234);
  } finally { await worker.terminate(); }
});
test("private server supplies isolation headers and serves the real entry point", async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(response.headers.get("cross-origin-embedder-policy"), "require-corp");
    assert.match(await response.text(), /<canvas id="rogue-canvas"/);
    const denied = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST" });
    assert.equal(denied.status, 405);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("server denies private files even when they exist within the project", async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const resource of ["/.gitignore", "/start.ps1", "/rust/Cargo.toml", "/web/%2e%2e/.gitignore", "/tools/server.mjs"]) {
      const response = await fetch(base + resource);
      assert.equal(response.status, 403, resource);
    }
    assert.equal((await fetch(base + "/web/server.mjs")).status, 404);
    const wasm = await fetch(base + "/build/game.wasm", { method: "HEAD" });
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers.get("content-type"), "application/wasm");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
