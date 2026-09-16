import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/dragonSpawns.js', import.meta.url), 'utf8');
const match = source.match(/export function resolveConfiguredDragonSpawnCenter\(([^)]*)\) \{([\s\S]*?)\n\}\n\n\/\*\*/);
assert.ok(match, 'resolveConfiguredDragonSpawnCenter implementation not found');

const resolveConfiguredDragonSpawnCenter = Function(
  `return function resolveConfiguredDragonSpawnCenter(${match[1]}) {${match[2]}\n}`,
)();

const poison = new Error('poison-config-accessor');
let groundSamples = 0;
const sampleGroundY = () => {
  groundSamples += 1;
  return 12;
};

const throwingSeatX = resolveConfiguredDragonSpawnCenter({
  spawn: { altitudeMeters: 5 },
  seat: { get x() { throw poison; }, z: 4 },
  sampleGroundY,
});
assert.equal(throwingSeatX.ok, false);
assert.equal(throwingSeatX.reason, 'config-read-error');
assert.equal(throwingSeatX.error, poison);
assert.equal(groundSamples, 0, 'throwing config access must fail before terrain sampling');

const throwingSeatZ = resolveConfiguredDragonSpawnCenter({
  spawn: { altitudeMeters: 5 },
  seat: { x: 2, get z() { throw poison; } },
  sampleGroundY,
});
assert.equal(throwingSeatZ.reason, 'config-read-error');
assert.equal(groundSamples, 0);

const throwingAltitude = resolveConfiguredDragonSpawnCenter({
  spawn: { get altitudeMeters() { throw poison; } },
  seat: { x: 2, z: 4 },
  sampleGroundY,
});
assert.equal(throwingAltitude.reason, 'config-read-error');
assert.equal(groundSamples, 0);

const valid = resolveConfiguredDragonSpawnCenter({
  spawn: { altitudeMeters: 5 },
  seat: { x: 2, z: 4 },
  sampleGroundY,
});
assert.deepEqual(valid, { ok: true, centerX: 2, centerY: 17, centerZ: 4, groundY: 12 });
assert.equal(groundSamples, 1);

console.log('CONFIGURED_DRAGON_CONFIG_READ_SAFETY_PASS');
