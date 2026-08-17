#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');
assert.match(source, /export function deterministicNpcPhaseSeconds/);
assert.match(source, /Math\.imul\(hash, 0x7feb352d\)/);
assert.match(source, /Math\.imul\(hash, 0x846ca68b\)/);
assert.match(source, /hash = \(hash \^ \(hash >>> 16\)\) >>> 0;/,
  'final avalanche must normalize back to uint32 before phase scaling');

function phase(id, intervalSeconds) {
  let hash = 2166136261;
  for (const char of String(id ?? 'npc')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return (hash / 0x100000000) * intervalSeconds;
}

function histogram(ids, intervalSeconds, bins) {
  const counts = Array(bins).fill(0);
  for (const id of ids) {
    const value = phase(id, intervalSeconds);
    assert.ok(value >= 0 && value < intervalSeconds, 'phase must remain inside its cadence interval');
    const index = Math.min(bins - 1, Math.floor((value / intervalSeconds) * bins));
    counts[index] += 1;
  }
  return counts;
}

const population = Array.from({ length: 500 }, (_, index) => `crowd-${index}`);
const farBins = histogram(population, 0.25, 15);
const distantBins = histogram(population.map((id) => `${id}:distant`), 1, 60);

const farPeak = Math.max(...farBins);
const distantPeak = Math.max(...distantBins);
const emptyFarBins = farBins.filter((count) => count === 0).length;
const emptyDistantBins = distantBins.filter((count) => count === 0).length;

assert.ok(farPeak < 55, '500-NPC far phases must not collapse into a render-frame-sized herd');
assert.ok(distantPeak < 20, '500-NPC distant phases must stay spread across the 1Hz dormancy interval');
assert.ok(emptyFarBins <= 1, 'far cadence distribution must not leave broad starvation gaps');
assert.ok(emptyDistantBins < 15, 'distant cadence distribution must cover most 60Hz frame buckets');

for (const id of population.slice(0, 100)) {
  assert.equal(phase(id, 0.25), phase(id, 0.25), 'phase must replay deterministically');
  assert.equal(phase(`${id}:distant`, 1), phase(`${id}:distant`, 1), 'distant phase must replay deterministically');
}

console.log('NPC_SIMULATION_LOD_FAIRNESS_PASS', JSON.stringify({
  population: population.length,
  farPeak,
  distantPeak,
  emptyFarBins,
  emptyDistantBins,
}));
