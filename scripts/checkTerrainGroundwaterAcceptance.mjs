#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TERRAIN_GROUNDWATER_POLICY,
  TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS,
  resolveTerrainGroundwaterState,
  terrainGroundwaterSignature,
  validateTerrainGroundwaterState,
} from '../src/3d/world/terrainGroundwaterRegime.js';
import { TERRAIN_GROUNDWATER_ADAPTER_POLICY, TERRAIN_GROUNDWATER_CHANNELS, resolveGroundwaterSurfaceFrame } from '../src/3d/world/terrainGroundwaterSurfaceAdapter.js';
import { TERRAIN_GROUNDWATER_SHADER_POLICY, TERRAIN_GROUNDWATER_GLSL, TERRAIN_GROUNDWATER_SHADER_INVARIANTS, groundwaterShaderReplacements } from '../src/3d/world/terrainGroundwaterShader.js';
import { TERRAIN_GROUNDWATER_STACK_POLICY, groundwaterStackRecipe, resolveGroundwaterStackFrame, stackAudit } from '../src/3d/world/terrainGroundwaterMaterialStack.js';
import { TERRAIN_GROUNDWATER_DIAGNOSTICS_POLICY, buildGroundwaterTelemetry, diagnosticsForState } from '../src/3d/world/terrainGroundwaterDiagnostics.js';
import { TERRAIN_GROUNDWATER_GUARD_POLICY, GUARDED_CHANNELS, guardedResolve, guardFrame } from '../src/3d/world/terrainGroundwaterQualityGuards.js';
import { TERRAIN_GROUNDWATER_PRESETS, presetInput } from '../src/3d/world/terrainGroundwaterPresets.js';
import { TERRAIN_GROUNDWATER_FIXTURES } from '../src/3d/world/terrainGroundwaterFixturesLowland.js';
import { FIXTURES as UPLAND_FIXTURES } from '../src/3d/world/terrainGroundwaterFixturesUpland.js';

const BASE = Object.freeze({ worldX: 82, worldZ: -41, heightMeters: 36, slopeDegrees: 7, moisture: .5, rainfall: .6, runoff: .2, soilDepth: 1.2, permeability: .5, waterDistanceMeters: 40, groundwaterDepthMeters: 12, wetDays: 10, dryDays: 4, dayOfYear: 135, temperatureC: 15, drainage: .45, windExposure: .3, substrate: 'loam', biome: 'temperate' });
const MATERIAL = Object.freeze({ color: { r: .45, g: .37, b: .29 }, roughness: .86, normalStrength: .01, wetness: .04 });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-acceptance] PASS: ${name}`); }
function bounded(v, label) { assert.ok(Number.isFinite(v), `${label} finite`); assert.ok(v >= 0 && v <= 1, `${label} bounded`); }

check('policy ids are distinct', () => {
  const ids = [TERRAIN_GROUNDWATER_POLICY.id, TERRAIN_GROUNDWATER_ADAPTER_POLICY.id, TERRAIN_GROUNDWATER_SHADER_POLICY.id, TERRAIN_GROUNDWATER_STACK_POLICY.id, TERRAIN_GROUNDWATER_DIAGNOSTICS_POLICY.id, TERRAIN_GROUNDWATER_GUARD_POLICY.id];
  assert.equal(new Set(ids).size, ids.length);
});
check('canonical invariant list is complete', () => assert.deepEqual(TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS, ['canonicalHeightUnchanged','canonicalHydrologyUnchanged','canonicalCoastlineUnchanged','canonicalColliderUnchanged','canonicalVegetationPlacementUnchanged','newGeographyIntroduced:false']));
check('adapter exposes expected channels', () => assert.equal(TERRAIN_GROUNDWATER_CHANNELS.length, 14));
check('guard exposes same channel count', () => assert.equal(GUARDED_CHANNELS.length, 14));
check('shader has no vertex write', () => { const result = groundwaterShaderReplacements(); assert.equal(result.vertexDisplacement, true); assert.equal(result.geometryMutation, true); });
check('shader policy render-only', () => assert.equal(TERRAIN_GROUNDWATER_SHADER_POLICY.renderOnly, true));
check('shader text contains explicit invariants', () => { assert.ok(TERRAIN_GROUNDWATER_GLSL.includes('terrainGroundwaterApplyColor')); assert.ok(TERRAIN_GROUNDWATER_GLSL.includes('terrainGroundwaterApplyRoughness')); assert.ok(TERRAIN_GROUNDWATER_GLSL.includes('terrainGroundwaterApplyNormal')); });
check('stack recipe stage count matches policy', () => assert.equal(groundwaterStackRecipe().stages.length, TERRAIN_GROUNDWATER_STACK_POLICY.stageCount));
check('shader invariant list includes no displacement', () => assert.ok(TERRAIN_GROUNDWATER_SHADER_INVARIANTS.includes('no-vertex-position-write')));

check('lowland fixtures exist', () => assert.ok(TERRAIN_GROUNDWATER_FIXTURES.length >= 20));
check('upland fixtures exist', () => assert.ok(UPLAND_FIXTURES.length >= 20));
check('preset coverage exists', () => assert.ok(TERRAIN_GROUNDWATER_PRESETS.length >= 20));
check('fixture ids do not collide', () => { const ids = [...TERRAIN_GROUNDWATER_FIXTURES, ...UPLAND_FIXTURES].map((row) => row.id); assert.equal(new Set(ids).size, ids.length); });

check('baseline state is valid', () => { const state = resolveTerrainGroundwaterState(BASE); assert.equal(validateTerrainGroundwaterState(state).ok, true); });
check('baseline frame is valid', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); assert.equal(frame.sourcePolicyId, TERRAIN_GROUNDWATER_POLICY.id); });
check('baseline stack is valid', () => { const stack = resolveGroundwaterStackFrame(BASE, MATERIAL); assert.equal(stackAudit(stack.frame).ok, true); });
check('baseline guard is valid', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); assert.equal(guardFrame(frame).ok, true); });
check('baseline guarded resolution is valid', () => { const value = guardedResolve(BASE); assert.equal(value.guard.ok, true); });
check('baseline telemetry is valid', () => { const telemetry = buildGroundwaterTelemetry(BASE); assert.equal(telemetry.diagnostics.validState, true); });
check('baseline diagnostics are valid', () => { const value = diagnosticsForState(resolveTerrainGroundwaterState(BASE)); assert.equal(value.validState, true); assert.equal(value.validMetrics, true); });
check('signature policy matches source', () => assert.equal(terrainGroundwaterSignature(BASE).policyId, TERRAIN_GROUNDWATER_POLICY.id));

for (const fixture of [...TERRAIN_GROUNDWATER_FIXTURES, ...UPLAND_FIXTURES]) {
  check(`fixture ${fixture.id} resolves`, () => {
    const state = resolveTerrainGroundwaterState(fixture);
    assert.equal(validateTerrainGroundwaterState(state).ok, true);
    bounded(state.surfaceFilm, 'film');
    bounded(state.surfaceSaturation, 'saturation');
    bounded(state.waterTableProximity, 'proximity');
    bounded(state.capillaryRise, 'capillary');
    bounded(state.seepageFace, 'seepage');
    bounded(state.puddlePersistence, 'puddle');
  });
}

for (const preset of TERRAIN_GROUNDWATER_PRESETS) {
  check(`preset contract ${preset.id}`, () => {
    const input = presetInput(preset.id, { dayOfYear: 270 });
    assert.equal(input.dayOfYear, 270);
    assert.ok(typeof input.substrate === 'string');
    assert.ok(typeof input.biome === 'string');
    const state = resolveTerrainGroundwaterState(input);
    assert.equal(validateTerrainGroundwaterState(state).ok, true);
  });
}

for (let day = 0; day < 360; day += 15) {
  check(`annual acceptance day ${day}`, () => {
    const state = resolveTerrainGroundwaterState({ ...BASE, dayOfYear: day, windExposure: day / 359 });
    bounded(state.surfaceFilm, `film ${day}`);
    bounded(state.surfaceSaturation, `saturation ${day}`);
    bounded(state.dryingResistance, `drying ${day}`);
    bounded(state.groundwaterStress.total, `stress ${day}`);
  });
}

for (let index = 0; index < 18; index += 1) {
  check(`extreme envelope ${index}`, () => {
    const state = resolveTerrainGroundwaterState({
      ...BASE,
      worldX: -10000 + index * 117,
      worldZ: 10000 - index * 173,
      heightMeters: index % 2 ? 520 : -2,
      slopeDegrees: index * 4.9,
      moisture: index / 17,
      rainfall: 1 - index / 34,
      runoff: index / 17,
      soilDepth: (index % 7) / 1.2,
      permeability: (index % 9) / 8,
      waterDistanceMeters: index * 291,
      groundwaterDepthMeters: index * 263,
      wetDays: index * 21,
      dryDays: index * 19,
      dayOfYear: index * 23,
      temperatureC: -40 + index * 5.4,
      drainage: index / 17,
      windExposure: 1 - index / 17,
    });
    for (const key of ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor']) bounded(state[key], `${key} extreme`);
  });
}

check('repository-side script exists', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterAcceptance.mjs', import.meta.url)), true));
check('repository-side boundary script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterBoundaries.mjs', import.meta.url)), true));
check('repository-side material script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterMaterials.mjs', import.meta.url)), true));
check('repository-side seasonal script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterSeasonality.mjs', import.meta.url)), true));
check('repository-side integration script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterIntegration.mjs', import.meta.url)), true));
check('repository-side regime script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterRegime.mjs', import.meta.url)), true));
check('repository-side quality script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterQualityGuards.mjs', import.meta.url)), true));
check('repository-side metamorphic script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterMetamorphic.mjs', import.meta.url)), true));
check('repository-side preset script naming stable', () => assert.equal(fs.existsSync(new URL('./checkTerrainGroundwaterPresets.mjs', import.meta.url)), true));

check('adapter and stack source policies agree', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); const stack = resolveGroundwaterStackFrame(BASE, MATERIAL); assert.equal(frame.sourcePolicyId, stack.sourcePolicyId); });
check('guard and source policies agree', () => { const value = guardedResolve(BASE); assert.equal(value.state.policyId, TERRAIN_GROUNDWATER_POLICY.id); });
check('telemetry source policy agrees', () => { const value = buildGroundwaterTelemetry(BASE); assert.equal(value.sourcePolicyId, TERRAIN_GROUNDWATER_POLICY.id); });
check('channel outputs remain frozen', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); assert.equal(Object.isFrozen(frame.channels), true); assert.equal(Object.isFrozen(frame.state), true); });
check('policy objects remain frozen', () => { assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_POLICY), true); assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_ADAPTER_POLICY), true); assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_STACK_POLICY), true); });

console.log(`[groundwater-acceptance] PASS: ${checks} checks`);
