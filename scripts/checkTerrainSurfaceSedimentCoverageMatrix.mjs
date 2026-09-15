#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_SEDIMENT_COVERAGE_NORTH } from './fixtures/terrainSedimentCoverageNorth.js';
import { TERRAIN_SEDIMENT_COVERAGE_SOUTH } from './fixtures/terrainSedimentCoverageSouth.js';
import { TERRAIN_SEDIMENT_COVERAGE_COASTAL } from './fixtures/terrainSedimentCoverageCoastal.js';
import { TERRAIN_SEDIMENT_CALIBRATION, sedimentCalibrationAt } from '../src/3d/world/terrainSurfaceSedimentCalibration.js';
import { TERRAIN_SEDIMENT_POLICY, resolveTerrainSedimentState, sedimentRegionSignature } from '../src/3d/world/terrainSurfaceSediment.js';

const COVERAGES = Object.freeze([
  ['north', TERRAIN_SEDIMENT_COVERAGE_NORTH],
  ['south', TERRAIN_SEDIMENT_COVERAGE_SOUTH],
  ['coastal', TERRAIN_SEDIMENT_COVERAGE_COASTAL],
]);
const bounds = (value, label) => assert(value >= -1e-9 && value <= 1 + 1e-9, `${label}=${value}`);

assert.equal(TERRAIN_SEDIMENT_POLICY.renderOnly, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.deterministic, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalHeightUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalCoastlineUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalColliderUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalVegetationPlacementUnchanged, true);
assert.equal(TERRAIN_SEDIMENT_POLICY.newGeographyIntroduced, false);
assert.equal(TERRAIN_SEDIMENT_POLICY.profileCount, 64);
assert.equal(TERRAIN_SEDIMENT_CALIBRATION.length, 512);

let total = 0;
let checksum = 0;
const profileSeen = new Set();
for (const [region, fixture] of COVERAGES) {
  assert.equal(fixture.length, 256, `${region} coverage size`);
  let previous = null;
  for (const row of fixture) {
    assert.equal(row.length, 6, `${region} row schema`);
    const [id, worldX, worldZ, heightMeters, slopeDegrees, moisture] = row;
    assert(typeof id === 'string' && id.length >= 4, `${region} id must be stable`);
    assert(Number.isFinite(worldX) && Number.isFinite(worldZ), `${region} world coordinates must be finite`);
    assert(Number.isFinite(heightMeters) && Number.isFinite(slopeDegrees) && Number.isFinite(moisture), `${region} scalar inputs must be finite`);
    assert(slopeDegrees >= 0 && slopeDegrees <= 60, `${region} slope outside diagnostic envelope`);
    assert(moisture >= 0 && moisture <= 1, `${region} moisture outside diagnostic envelope`);
    const first = resolveTerrainSedimentState({ worldX, worldZ, heightMeters, slopeDegrees });
    const second = resolveTerrainSedimentState({ worldX, worldZ, heightMeters, slopeDegrees });
    assert.deepEqual(first, second, `${region}:${id} state is not deterministic`);
    for (const key of ['basin','catchment','wash','aggregate','film','crust','pore','sedimentLoad','mineralDeposit','muddyFilm','washBleach','dryCrust','poreRoughness','transient']) bounds(first[key], `${region}:${id}:${key}`);
    assert(Number.isInteger(first.profile.index), `${region}:${id} profile index must be integral`);
    assert(first.profile.index >= 0 && first.profile.index < TERRAIN_SEDIMENT_POLICY.profileCount, `${region}:${id} profile index outside profile table`);
    profileSeen.add(first.profile.index);
    checksum += first.sedimentLoad * 0.31 + first.wash * 0.23 + first.film * 0.17 + first.crust * 0.13 + first.aggregate * 0.11;
    total += 1;
    if (previous) {
      assert(previous.id !== id, `${region} duplicate fixture id ${id}`);
    }
    previous = { id };
  }
}

assert(profileSeen.size >= 24, `coverage only exercised ${profileSeen.size} of 64 sediment profiles`);
assert(total === 768, `expected 768 coverage samples, received ${total}`);
assert(Number.isFinite(checksum));
const signatureA = sedimentRegionSignature(2410.25, -1320.5);
const signatureB = sedimentRegionSignature(2410.25, -1320.5);
assert.deepEqual(signatureA, signatureB, 'regional signature must be deterministic');

for (const calibrationIndex of [0, 1, 63, 127, 255, 383, 511]) {
  const calibration = sedimentCalibrationAt(calibrationIndex);
  assert.equal(calibration.profile, calibrationIndex);
  for (const key of ['deposit','wash','film','crust','cool']) bounds(calibration[key], `calibration:${calibrationIndex}:${key}`);
}

const flat = resolveTerrainSedimentState({ worldX: 410, worldZ: -720, heightMeters: 50, slopeDegrees: 1.5 });
const slope = resolveTerrainSedimentState({ worldX: 410, worldZ: -720, heightMeters: 50, slopeDegrees: 32 });
const steep = resolveTerrainSedimentState({ worldX: 410, worldZ: -720, heightMeters: 50, slopeDegrees: 48 });
assert(slope.wash >= flat.wash, 'rainwash must increase from flat to sloped terrain');
assert(steep.wash >= slope.wash, 'rainwash must not decrease at the steep end');
const low = resolveTerrainSedimentState({ worldX: -820, worldZ: 330, heightMeters: 28, slopeDegrees: 2 });
const high = resolveTerrainSedimentState({ worldX: -820, worldZ: 330, heightMeters: 460, slopeDegrees: 2 });
assert(high.dryCrust >= low.dryCrust, 'higher exposed terrain should support at least as much dry crust');

console.log(JSON.stringify({ policyId: TERRAIN_SEDIMENT_POLICY.id, regions: COVERAGES.length, samples: total, profilesSeen: profileSeen.size, checksum: Number(checksum.toFixed(8)), pass: true }));
