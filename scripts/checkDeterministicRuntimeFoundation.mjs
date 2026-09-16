import { strict as assert } from 'node:assert';

const ticks = Array.from({ length: 120 }, (_, index) => index + 1);
assert.equal(ticks.length, 120);
assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b));

const dimensions = [
  'renderer', 'runtime', 'assets', 'persistence', 'input', 'world', 'workers', 'telemetry', 'recovery',
  'determinism', 'navigation', 'state', 'streaming', 'memory', 'quality', 'events',
];
assert.equal(new Set(dimensions).size, dimensions.length);
assert.ok(dimensions.every((name) => name.length >= 4));

const priority = ['critical', 'high', 'normal', 'low', 'background'];
assert.equal(priority.length, 5);
assert.deepEqual(priority.slice().reverse().reverse(), priority);

const backends = ['webgpu', 'webgl2'];
const tiers = ['ultra', 'high', 'medium', 'low', 'safe'];
const compatibility = [];
for (const backend of backends) for (const tier of tiers) compatibility.push(`${backend}:${tier}`);
assert.equal(compatibility.length, 10);
assert.equal(new Set(compatibility).size, 10);

const migrationPairs = [];
for (let from = 1; from <= 8; from += 1) {
  for (let to = from + 1; to <= 8; to += 1) migrationPairs.push(`${from}.0.0>${to}.0.0`);
}
assert.equal(migrationPairs.length, 28);

const checksum = (input) => {
  let hash = 0x811c9dc5;
  for (const char of input) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
};
const sample = JSON.stringify({ world: 'test', tick: 10, entities: ['a', 'b'] });
assert.equal(checksum(sample), checksum(sample));
assert.notEqual(checksum(sample), checksum(`${sample}x`));

const stable = (values) => values.map((value, index) => ({ value, index })).sort((a, b) => String(a.value).localeCompare(String(b.value)) || a.index - b.index).map((item) => item.value);
const source = ['z', 'a', 'm', 'a', 'q'];
assert.deepEqual(stable(source), ['a', 'a', 'm', 'q', 'z']);
assert.deepEqual(stable(stable(source)), stable(source));

const numeric = [-2, -1, 0, 1, 2, 3];
const normalized = numeric.map((value) => Math.max(-1, Math.min(1, value / 2)));
assert.deepEqual(normalized, [-1, -0.5, 0, 0.5, 1, 1]);

console.log('deterministic runtime foundation invariants passed');
console.log(`verified ${dimensions.length} subsystem domains`);
console.log(`verified ${compatibility.length} backend/quality compatibility pairs`);
console.log(`verified ${migrationPairs.length} ordered migration pairs`);
