#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainGroundwaterState } from '../src/3d/world/terrainGroundwaterRegime.js';
import { resolveGroundwaterSurfaceFrame } from '../src/3d/world/terrainGroundwaterSurfaceAdapter.js';
import { TERRAIN_GROUNDWATER_POLICY } from '../src/3d/world/terrainGroundwaterRegime.js';
import {
  TERRAIN_GROUNDWATER_GUARD_POLICY,
  GUARDED_CHANNELS,
  sanitizeChannelSet,
  sanitizeMaterial,
  guardFrame,
  guardedResolve,
  canonicalPayloadSignature,
  validateMaterialDelta,
  stateInputGuard,
  assertRenderOnlyUserData,
  clampBlendMix,
  clampEventIntensity,
  clampEdgeStrength,
  compareGuardedOutputs,
  guardGrid,
  guardReport,
  enforceBudgetOrFallback,
  guardedStateSignature,
} from '../src/3d/world/terrainGroundwaterQualityGuards.js';

const BASE = Object.freeze({ worldX: 40, worldZ: -60, heightMeters: 35, slopeDegrees: 7, moisture: .58, rainfall: .62, runoff: .18, soilDepth: 1.3, permeability: .46, waterDistanceMeters: 42, groundwaterDepthMeters: 15, wetDays: 9, dryDays: 3, dayOfYear: 142, temperatureC: 16, drainage: .44, windExposure: .31, substrate: 'loam', biome: 'temperate' });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-guards] PASS: ${name}`); }
function bounded(v, label) { assert.ok(Number.isFinite(v), `${label} finite`); assert.ok(v >= 0 && v <= 1, `${label} bounded`); }

check('guard policy is deterministic', () => { assert.equal(TERRAIN_GROUNDWATER_GUARD_POLICY.deterministic, true); assert.equal(TERRAIN_GROUNDWATER_GUARD_POLICY.renderOnly, true); });
check('guard channel count is explicit', () => assert.equal(GUARDED_CHANNELS.length, 14));
check('sanitize channels fills every channel', () => { const result = sanitizeChannelSet({}); for (const key of GUARDED_CHANNELS) bounded(result.channels[key], key); assert.equal(result.changed, false); });
check('sanitize channels clamps high values', () => { const result = sanitizeChannelSet(Object.fromEntries(GUARDED_CHANNELS.map((key) => [key, 4]))); for (const key of GUARDED_CHANNELS) assert.equal(result.channels[key], 1); assert.equal(result.changed, true); });
check('sanitize channels clamps low values', () => { const result = sanitizeChannelSet(Object.fromEntries(GUARDED_CHANNELS.map((key) => [key, -4]))); for (const key of GUARDED_CHANNELS) assert.equal(result.channels[key], 0); assert.equal(result.changed, true); });
check('sanitize channels handles non numeric', () => { const result = sanitizeChannelSet({ wetness: 'bad', saturation: Infinity }); assert.equal(result.channels.wetness, 0); assert.equal(result.channels.saturation, 0); });
check('sanitize material defaults', () => { const material = sanitizeMaterial({}); bounded(material.color.r, 'r'); bounded(material.color.g, 'g'); bounded(material.color.b, 'b'); bounded(material.roughness, 'roughness'); bounded(material.normalStrength, 'normal'); bounded(material.wetness, 'wetness'); });
check('sanitize material clamps roughness', () => { assert.equal(sanitizeMaterial({ roughness: 99 }).roughness, 1); assert.equal(sanitizeMaterial({ roughness: -2 }).roughness, .42); });
check('sanitize material clamps normal', () => assert.equal(sanitizeMaterial({ normalStrength: 2 }).normalStrength, TERRAIN_GROUNDWATER_POLICY.maxNormalStrength));
check('guard frame passes a real frame', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); const guard = guardFrame(frame); assert.equal(guard.ok, true); assert.equal(guard.failures.length, 0); });
check('guarded resolve passes', () => { const frame = guardedResolve(BASE); assert.equal(frame.guard.ok, true); assert.equal(frame.state.policyId, TERRAIN_GROUNDWATER_POLICY.id); });
check('canonical payload signature passes', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); const signature = canonicalPayloadSignature(frame); assert.equal(signature.ok, true); assert.equal(signature.channelCount, 14); });
check('material delta baseline', () => { const material = sanitizeMaterial({}); const report = validateMaterialDelta(material, material); assert.equal(report.ok, true); assert.equal(report.colorMagnitude, 0); });
check('state input guard passes baseline', () => assert.equal(stateInputGuard(BASE).ok, true));
check('render only guard rejects height mutation', () => { assert.equal(assertRenderOnlyUserData({ terrainGroundwaterHeightMutation: true }).ok, false); });
check('render only guard accepts clean userdata', () => assert.equal(assertRenderOnlyUserData({ terrainGroundwaterRenderOnly: true }).ok, true));
check('mix clamps low', () => assert.equal(clampBlendMix(-2), 0));
check('mix clamps high', () => assert.equal(clampBlendMix(2), 1));
check('event intensity clamps', () => { assert.equal(clampEventIntensity(-1), 0); assert.equal(clampEventIntensity(2), 1); });
check('edge strength clamps', () => { assert.equal(clampEdgeStrength(-1), 0); assert.equal(clampEdgeStrength(2), 1); });
check('guarded outputs are equal for same input', () => { const a = resolveGroundwaterSurfaceFrame(BASE); const b = resolveGroundwaterSurfaceFrame(BASE); const report = compareGuardedOutputs(a, b); for (const value of Object.values(report.channelDelta)) assert.equal(value, 0); assert.equal(report.equalCanonical, true); });
check('guard grid size', () => { const inputs = Array.from({ length: 16 }, (_, index) => ({ ...BASE, worldX: index * 31, worldZ: -index * 17 })); const grid = guardGrid(inputs); assert.equal(grid.length, 16); for (const row of grid) assert.equal(row.signature.ok, true); });
check('guard report contains policy', () => { const report = guardReport(BASE); assert.equal(report.policyId, TERRAIN_GROUNDWATER_GUARD_POLICY.id); assert.equal(report.guard.ok, true); });
check('budget fallback keeps safe material', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); const result = enforceBudgetOrFallback(frame, { color: { r: .5, g: .42, b: .32 }, roughness: .86, normalStrength: 0, wetness: 0 }); assert.equal(result.fallbackUsed, false); bounded(result.material.roughness, 'safe roughness'); });
check('guarded signature is stable', () => { assert.deepEqual(guardedStateSignature(BASE), guardedStateSignature(BASE)); });

for (let i = 0; i < 50; i += 1) {
  check(`guard stress ${i}`, () => {
    const input = { ...BASE, worldX: -1500 + i * 61, worldZ: 800 - i * 37, heightMeters: -20 + i * 11, slopeDegrees: (i * 7.3) % 89, rainfall: (i % 17) / 16, runoff: (i % 13) / 12, moisture: (i % 19) / 18, soilDepth: (i % 8) / 2.4, permeability: (i % 23) / 22, waterDistanceMeters: i * 91, groundwaterDepthMeters: i * 77, wetDays: i * 3, dryDays: i * 5, dayOfYear: i * 29, temperatureC: -40 + i * 1.9, drainage: (i % 11) / 10, windExposure: (i % 9) / 8 };
    const result = guardedResolve(input);
    for (const key of GUARDED_CHANNELS) bounded(result.channels[key], key);
    bounded(result.material.roughness, 'roughness');
    bounded(result.material.normalStrength, 'normal');
    bounded(result.material.wetness, 'wetness');
    assert.equal(result.guard.ok, true);
  });
}

console.log(`[groundwater-guards] PASS: ${checks} checks`);
