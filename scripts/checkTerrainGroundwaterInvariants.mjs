#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_POLICY, TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS, resolveTerrainGroundwaterState } from '../src/3d/world/terrainGroundwaterRegime.js';
import { resolveGroundwaterSurfaceFrame } from '../src/3d/world/terrainGroundwaterSurfaceAdapter.js';
import { resolveGroundwaterStackFrame, stackCanonicalInvariantReport } from '../src/3d/world/terrainGroundwaterMaterialStack.js';
import { buildGroundwaterTelemetry } from '../src/3d/world/terrainGroundwaterDiagnostics.js';

const BASE = Object.freeze({ worldX: 0, worldZ: 0, heightMeters: 42, slopeDegrees: 8, moisture: .5, rainfall: .55, runoff: .15, soilDepth: 1.2, permeability: .48, waterDistanceMeters: 45, groundwaterDepthMeters: 15, wetDays: 8, dryDays: 4, dayOfYear: 135, temperatureC: 14, drainage: .45, windExposure: .3, substrate: 'loam', biome: 'temperate' });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-invariants] PASS: ${name}`); }

check('policy height invariant is true', () => assert.equal(TERRAIN_GROUNDWATER_POLICY.canonicalHeightUnchanged, true));
check('policy hydrology invariant is true', () => assert.equal(TERRAIN_GROUNDWATER_POLICY.canonicalHydrologyUnchanged, true));
check('policy coastline invariant is true', () => assert.equal(TERRAIN_GROUNDWATER_POLICY.canonicalCoastlineUnchanged, true));
check('policy collider invariant is true', () => assert.equal(TERRAIN_GROUNDWATER_POLICY.canonicalColliderUnchanged, true));
check('policy vegetation invariant is true', () => assert.equal(TERRAIN_GROUNDWATER_POLICY.canonicalVegetationPlacementUnchanged, true));
check('policy introduces no new geography', () => assert.equal(TERRAIN_GROUNDWATER_POLICY.newGeographyIntroduced, false));
check('canonical invariant list has six entries', () => assert.equal(TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS.length, 6));
check('state preserves immutable source sample', () => { const input = { ...BASE }; const state = resolveTerrainGroundwaterState(input); assert.deepEqual(input, BASE); assert.equal(Object.isFrozen(state.sample), true); });
check('frame canonical report all true/false correctly', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); assert.equal(frame.canonical.heightUnchanged, true); assert.equal(frame.canonical.hydrologyUnchanged, true); assert.equal(frame.canonical.coastlineUnchanged, true); assert.equal(frame.canonical.colliderUnchanged, true); assert.equal(frame.canonical.vegetationPlacementUnchanged, true); assert.equal(frame.canonical.newGeographyIntroduced, false); });
check('stack canonical report matches policy', () => { const stack = resolveGroundwaterStackFrame(BASE, { color: { r: .5, g: .4, b: .3 }, roughness: .86 }); assert.deepEqual(stackCanonicalInvariantReport(stack), { heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true, newGeographyIntroduced: false }); });
check('telemetry canonical report is immutable', () => { const telemetry = buildGroundwaterTelemetry(BASE); assert.equal(Object.isFrozen(telemetry.canonical), true); });
check('policy remains frozen', () => assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_POLICY), true));

for (let index = 0; index < 32; index += 1) {
  check(`invariant coordinate ${index}`, () => {
    const frame = resolveGroundwaterSurfaceFrame({ ...BASE, worldX: -900 + index * 61, worldZ: 700 - index * 43, heightMeters: -10 + index * 17, slopeDegrees: (index * 4.7) % 89 });
    assert.equal(frame.canonical.heightUnchanged, true);
    assert.equal(frame.canonical.hydrologyUnchanged, true);
    assert.equal(frame.canonical.coastlineUnchanged, true);
    assert.equal(frame.canonical.colliderUnchanged, true);
    assert.equal(frame.canonical.vegetationPlacementUnchanged, true);
    assert.equal(frame.canonical.newGeographyIntroduced, false);
  });
}

console.log(`[groundwater-invariants] PASS: ${checks} checks`);
