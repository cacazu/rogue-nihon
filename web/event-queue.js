/* SharedArrayBuffer/Atomics transport only. Raw values are opaque to this file. */
(function (scope) {
  "use strict";
  const WRITE = 0, READ = 1, CLOSED = 2, HEADER = 3;
  class EventQueue {
    constructor(buffer, capacity = 128) {
      if (!Number.isInteger(capacity) || capacity < 2 || capacity > 65536 || (capacity & (capacity - 1))) throw new Error("Queue capacity must be a power of two from 2 to 65536");
      this.capacity = capacity;
      this.mask = capacity - 1;
      this.buffer = buffer || new SharedArrayBuffer((HEADER + capacity) * Int32Array.BYTES_PER_ELEMENT);
      if (this.buffer.byteLength !== (HEADER + capacity) * Int32Array.BYTES_PER_ELEMENT) throw new Error("Queue size mismatch");
      this.words = new Int32Array(this.buffer);
    }
    push(event) {
      if (Atomics.load(this.words, CLOSED)) return false;
      const write = Atomics.load(this.words, WRITE) >>> 0;
      const read = Atomics.load(this.words, READ) >>> 0;
      if (((write - read) >>> 0) >= this.capacity) return false;
      Atomics.store(this.words, HEADER + (write & this.mask), event | 0);
      Atomics.store(this.words, WRITE, (write + 1) | 0);
      Atomics.notify(this.words, WRITE, 1);
      return true;
    }
    take() {
      for (;;) {
        const read = Atomics.load(this.words, READ) >>> 0;
        const write = Atomics.load(this.words, WRITE) >>> 0;
        if (read !== write) {
          const event = Atomics.load(this.words, HEADER + (read & this.mask));
          Atomics.store(this.words, READ, (read + 1) | 0);
          return event;
        }
        if (Atomics.load(this.words, CLOSED)) throw new Error("Input queue closed");
        Atomics.wait(this.words, WRITE, write | 0);
      }
    }
    close() {
      Atomics.store(this.words, CLOSED, 1);
      Atomics.notify(this.words, WRITE, 1);
    }
    pushMany(events) {
      if (!Array.isArray(events) || events.length > this.capacity) return false;
      if (Atomics.load(this.words, CLOSED)) return false;
      const write = Atomics.load(this.words, WRITE) >>> 0;
      const read = Atomics.load(this.words, READ) >>> 0;
      if (((write - read) >>> 0) + events.length > this.capacity) return false;
      for (let index = 0; index < events.length; index++) Atomics.store(this.words, HEADER + ((write + index) & this.mask), events[index] | 0);
      Atomics.store(this.words, WRITE, (write + events.length) | 0);
      if (events.length) Atomics.notify(this.words, WRITE, 1);
      return true;
    }
    discardPending(visitor) {
      const read = Atomics.load(this.words, READ) >>> 0;
      const write = Atomics.load(this.words, WRITE) >>> 0;
      if (visitor) {
        for (let cursor = read; cursor !== write; cursor = (cursor + 1) >>> 0) visitor(Atomics.load(this.words, HEADER + (cursor & this.mask)));
      }
      Atomics.store(this.words, READ, write | 0);
      return (write - read) >>> 0;
    }
    get pending() {
      return ((Atomics.load(this.words, WRITE) >>> 0) - (Atomics.load(this.words, READ) >>> 0)) >>> 0;
    }
  }
  scope.RogueEventQueue = EventQueue;
  if (typeof module !== "undefined" && module.exports) module.exports = EventQueue;
})(typeof globalThis !== "undefined" ? globalThis : this);
