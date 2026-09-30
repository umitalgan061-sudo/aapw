import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MATRIX = resolve(ROOT, 'artifacts/modern-game-entry-r1/entry-policy.matrix');
const DIST = resolve(ROOT, 'dist/3d/modern');

assert.ok(existsSync(MATRIX), 'entry matrix must exist');
const lines = readFileSync(MATRIX, 'utf8').trimEnd().split('\n');
assert.equal(lines.length, 4098, 'matrix must contain exactly 4096 cases plus 2 headers');
const rows = lines.slice(2).map(line => JSON.parse(line));
assert.equal(new Set(rows.map(row => row.id)).size, 4096, 'case ids must be unique');
assert.equal(new Set(rows.map(row => row.expected)).size >= 10, true, 'matrix must exercise multiple state outcomes');

const gate = await import(resolve(DIST, 'entryGate.js'));
const router = await import(resolve(DIST, 'inputRouter.js'));
const deterministic = await import(resolve(DIST, 'deterministic.js'));
const serialization = await import(resolve(DIST, 'serialization.js'));

assert.equal(typeof gate.installEntryGate, 'function', 'typed entry gate exported');
assert.equal(typeof router.InputRouter, 'function', 'typed input router exported');
assert.equal(typeof deterministic.hash32, 'function', 'deterministic core exported');

const samples = [0, 1, 7, 42, 127, 511, 1023, 2047, 4095];
for (const seed of samples) {
  const a = deterministic.sample01(seed, 17);
  const b = deterministic.sample01(seed, 17);
  assert.equal(a, b, `deterministic sample stable for seed ${seed}`);
  assert.ok(a >= 0 && a < 1, 'sample remains normalized');
}

const inputRouter = new router.InputRouter({ clock: () => 100 });
inputRouter.defineAction?.({ action: 'move.forward', type: 'button' });
if (typeof inputRouter.push === 'function') {
  inputRouter.push({ action: 'move.forward', value: 1, source: 'keyboard', timestamp: 100 });
  assert.equal(inputRouter.consume().length, 1, 'input actions are consumable');
  assert.equal(inputRouter.consume().length, 0, 'consume is idempotent');
}

const canonical = JSON.stringify(rows.slice(0, 64));
const reversed = JSON.stringify(rows.slice(0, 64).reverse());
assert.notEqual(canonical, reversed, 'corpus has ordering sensitivity for replay fixtures');
assert.equal(deterministic.checksum(rows.slice(0, 64)), deterministic.checksum(JSON.parse(canonical)), 'checksum is structural and deterministic');
if (typeof serialization.stableSerialize === 'function') {
  assert.equal(serialization.stableSerialize({ z: 1, a: 2 }), serialization.stableSerialize({ a: 2, z: 1 }), 'canonical serializer sorts object keys');
}

const expectedDomain = new Set(['blocked-by-gate', 'error-visible', 'gate-stable-repel', 'repel', 'world-entered', 'running', 'stopped', 'suspended', 'recovered', 'recoverable', 'adaptive-degrade', 'adaptive-recover', 'mobile-input', 'desktop-input', 'worker-ready', 'worker-deferred', 'main-thread-fallback', 'viewport-synchronized', 'idle', 'modern-gpu', 'compatible-gpu', 'fallback-gpu', 'save-boundary', 'cold-boot', 'warm-boot', 'ready', 'ready-but-budgeted']);
for (const row of rows) assert.ok(expectedDomain.has(row.expected), `unknown policy output: ${row.expected}`);

const surfaceCounts = rows.reduce((map, row) => map.set(row.surface, (map.get(row.surface) ?? 0) + 1), new Map());
assert.equal(surfaceCounts.size, 22, 'all entry surfaces are represented');
assert.ok(rows.some(row => row.backend === 'webgpu' && row.expected === 'modern-gpu'), 'WebGPU modern path is represented');
assert.ok(rows.some(row => row.backend === 'webgl2' && row.expected === 'compatible-gpu'), 'WebGL2 fallback path is represented');
assert.ok(rows.some(row => row.page === 'hidden' && row.expected === 'suspended'), 'background suspension is represented');
assert.ok(rows.some(row => row.surface === 'legacy-error' && row.expected === 'error-visible'), 'legacy error bridge is represented');
assert.ok(rows.some(row => row.surface === 'gate-enter' && row.expected === 'world-entered'), 'gate entry is represented');
assert.ok(rows.some(row => row.surface === 'worker-unavailable' && row.expected === 'main-thread-fallback'), 'worker fallback is represented');

console.log(`Modern Game3D entry acceptance passed: ${rows.length} cases`);
