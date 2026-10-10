import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const harness = process.env.ROGUE_ARTIFACT_BUILD ? resolve(process.env.ROGUE_ARTIFACT_BUILD, 'message-capture.cjs') : fileURLToPath(new URL('../build/message-capture.cjs', import.meta.url));
const lines = execFileSync(process.execPath, [harness], { encoding: 'utf8' }).trim().split(/\r?\n/).map(JSON.parse);
assert.deepEqual(lines[0], [
  { kind: 'signed', value: 7 }, { kind: 'signed', value: 3 },
  { kind: 'signed', value: -12 }, { kind: 'string', value: '日本語"\\\n\t' },
  { kind: 'signed', value: 90 }, { kind: 'signed', value: 123456 },
]);
assert.equal(lines[1][0].value, -1);
assert.equal(lines[1][1].value, -1);
assert.deepEqual(lines[1].slice(3).map(arg => arg.value), [-123, -456, 789]);
assert.deepEqual(lines[2].map(arg => arg.value), [0, 0, 4294967295, 123456789012345, 42]);
assert.deepEqual(lines[3].map(arg => arg.value), [1.25, -0.5, null]);
assert.deepEqual(lines[4], [{ kind: 'string', value: '(null)' }]);
assert.equal(lines[5].length, 2);
for (const part of lines[5]) {
  assert.equal(part.kind, 'message_part');
  assert.equal(part.value.id, 'message.legacy');
  assert.equal(part.value.fallback, "user's 100% name %n");
  assert.deepEqual(part.value.args, []);
}
assert.deepEqual(lines[6], { checks: 'pass' });
console.log(JSON.stringify({ typedArguments: 'pass', utf8AndEscaping: 'pass', boundedFallback: 'pass', messageSequence: 'pass' }));
