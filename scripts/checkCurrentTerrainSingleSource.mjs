import fs from 'node:fs';
import {
  CURRENT_TERRAIN_POLICY,
  createCurrentTerrainHeightSampler,
  ownerMapNormalizedToCurrentWorld,
  sampleCurrentTerrainNormalized,
} from '../src/3d/world/currentTerrainRuntime.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage === true, 'full owner-map coverage must be enabled');
assert(CURRENT_TERRAIN_POLICY.legacyProceduralFallback === false, 'legacy FBM fallback must be disabled');

const authoredCenters = Object.freeze({
  G00: [0.5 / 8, 0.5 / 8],
  G01: [0.5 / 8, 1.5 / 8],
  G52: [5.5 / 8, 2.5 / 8],
  G70: [7.5 / 8, 0.5 / 8],
  G07: [0.5 / 8, 7.5 / 8],
  G17: [1.5 / 8, 7.5 / 8],
  G65: [6.5 / 8, 5.5 / 8],
  G75: [7.5 / 8, 5.5 / 8],
  G77: [7.5 / 8, 7.5 / 8],
});
for (const [cell, [nx, ny]] of Object.entries(authoredCenters)) {
  const sample = sampleCurrentTerrainNormalized(nx, ny);
  assert(sample.source === 'terrain3d-authored', `${cell} must use authored Terrain3D source`);
  assert(sample.authoredCell === cell, `${cell} current source mismatch: ${sample.authoredCell}`);
  assert(sample.authoredWeight > 0.99, `${cell} center must have full authored weight`);
  assert(Number.isFinite(sample.heightMeters), `${cell} height must be finite`);
}

// Spawn is in G36; it used to expose the historical FBM fallback immediately at game start.
const spawn = sampleCurrentTerrainNormalized(3885 / 9000, 5404 / 7000);
assert(spawn.source === 'canonical-full-map', `spawn must use canonical current full-map source, got ${spawn.source}`);
assert(Number.isFinite(spawn.heightMeters), 'spawn current height must be finite');

let canonicalSamples = 0;
let authoredSamples = 0;
let minHeight = Infinity;
let maxHeight = -Infinity;
for (let y = 0; y <= 32; y += 1) {
  for (let x = 0; x <= 32; x += 1) {
    const sample = sampleCurrentTerrainNormalized(x / 32, y / 32);
    assert(Number.isFinite(sample.heightMeters), `non-finite full-map height at ${x},${y}`);
    assert(sample.source !== 'legacy-procedural', `legacy fallback reached at ${x},${y}`);
    sample.source === 'terrain3d-authored' ? authoredSamples += 1 : canonicalSamples += 1;
    minHeight = Math.min(minHeight, sample.heightMeters);
    maxHeight = Math.max(maxHeight, sample.heightMeters);
  }
}
assert(canonicalSamples > 0 && authoredSamples > 0, 'full-map probe must exercise canonical and authored sources');

const deterministicA = createCurrentTerrainHeightSampler();
const deterministicB = createCurrentTerrainHeightSampler();
for (const [nx, ny] of [[0.1, 0.1], [0.4316666667, 0.772], [0.7, 0.32], [0.94, 0.93]]) {
  const world = ownerMapNormalizedToCurrentWorld(nx, ny);
  assert(deterministicA(world.x, world.z) === deterministicB(world.x, world.z), `determinism mismatch at ${nx},${ny}`);
}

const anchorWorld = ownerMapNormalizedToCurrentWorld(0.43, 0.51);
const flattened = createCurrentTerrainHeightSampler({
  flattenPads: [{ x: anchorWorld.x, z: anchorWorld.z, innerRadiusMeters: 20, outerRadiusMeters: 40, anchorHeightMeters: 18.25 }],
});
assert(Math.abs(flattened(anchorWorld.x, anchorWorld.z) - 18.25) < 1e-9, 'render/physics flatten pad must resolve through current sampler');

const adapter = fs.readFileSync(new URL('../src/3d/world/currentTerrainAdapter.js', import.meta.url), 'utf8');
assert(adapter.includes("from './terrain.js?legacy=1'"), 'adapter must isolate legacy module behind query URL');
assert(adapter.includes('createCurrentTerrainHeightSampler'), 'adapter must route height API through current sampler');
assert(adapter.includes('position.setY(index, sampleHeightMeters(worldX, worldZ))'), 'adapter must rebake rendered mesh vertices');

for (const htmlFile of ['../game3d.html', '../editor.html']) {
  const html = fs.readFileSync(new URL(htmlFile, import.meta.url), 'utf8');
  assert(html.includes('"./src/3d/world/terrain.js": "./src/3d/world/currentTerrainAdapter.js"'), `${htmlFile} must map live terrain to current adapter`);
}

console.log(`CURRENT_TERRAIN_POLICY=${CURRENT_TERRAIN_POLICY.id}`);
console.log(`CURRENT_TERRAIN_AUTHORED_CELLS=${CURRENT_TERRAIN_POLICY.authoredCells.join(',')}`);
console.log(`CURRENT_TERRAIN_GRID canonical=${canonicalSamples} authored=${authoredSamples} min=${minHeight.toFixed(3)} max=${maxHeight.toFixed(3)}`);
console.log(`CURRENT_TERRAIN_SPAWN source=${spawn.source} height=${spawn.heightMeters.toFixed(3)}`);
console.log('CURRENT_TERRAIN_SINGLE_SOURCE_OK');
