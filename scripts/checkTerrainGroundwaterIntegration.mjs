#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainGroundwaterState, validateTerrainGroundwaterState } from '../src/3d/world/terrainGroundwaterRegime.js';
import { resolveGroundwaterSurfaceFrame, groundwaterChannelsFromState, classifyGroundwaterPresentation, accumulateGroundwaterNeighborhood } from '../src/3d/world/terrainGroundwaterSurfaceAdapter.js';
import { groundwaterShaderReplacements, installTerrainGroundwaterShader } from '../src/3d/world/terrainGroundwaterShader.js';
import { resolveGroundwaterStackFrame, stackAudit, stackCanonicalInvariantReport, stackEventFrame, stackEventResponse, stackFrameFromState, stackSignature, groundwaterStackRecipe } from '../src/3d/world/terrainGroundwaterMaterialStack.js';
import { buildGroundwaterTelemetry, frameAudit, confidenceScore, presentationTier, diagnosticSeverity, metricDistance, metricSnapshot, metricBounds, sampleDiagnosticsGrid } from '../src/3d/world/terrainGroundwaterDiagnostics.js';

const BASE = Object.freeze({ worldX: 14, worldZ: -28, heightMeters: 27, slopeDegrees: 6, moisture: .56, rainfall: .64, runoff: .18, soilDepth: 1.35, permeability: .44, waterDistanceMeters: 41, groundwaterDepthMeters: 13, wetDays: 11, dryDays: 4, dayOfYear: 113, temperatureC: 15, drainage: .42, windExposure: .3, substrate: 'loam', biome: 'temperate' });
const MATERIAL = Object.freeze({ color: { r: .46, g: .38, b: .29 }, roughness: .88, normalStrength: .012, wetness: .05 });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-integration] PASS: ${name}`); }
function bounded(value, label) { assert.ok(Number.isFinite(value), `${label} finite`); assert.ok(value >= 0 && value <= 1, `${label} bounded`); }

check('resolved state validates', () => { const state = resolveTerrainGroundwaterState(BASE); assert.equal(validateTerrainGroundwaterState(state).ok, true); });
check('adapter frame source policy is groundwater', () => { const frame = resolveGroundwaterSurfaceFrame(BASE); assert.ok(frame.sourcePolicyId.startsWith('terrain-groundwater-regime')); });
check('adapter channels derive from state', () => { const state = resolveTerrainGroundwaterState(BASE); const channels = groundwaterChannelsFromState(state); for (const value of Object.values(channels)) bounded(value, 'channel'); });
check('presentation classification is stable', () => { const a = classifyGroundwaterPresentation(resolveGroundwaterSurfaceFrame(BASE)); const b = classifyGroundwaterPresentation(resolveGroundwaterSurfaceFrame(BASE)); assert.equal(a, b); });
check('shader replacement contract is complete', () => { const result = groundwaterShaderReplacements(); assert.deepEqual(result, { common: true, color: true, roughness: true, normal: true, vertexDisplacement: true, geometryMutation: true }); });
check('stack frame has canonical protections', () => { const stack = resolveGroundwaterStackFrame(BASE, MATERIAL); assert.deepEqual(stackCanonicalInvariantReport(stack), { heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true, newGeographyIntroduced: false }); });
check('stack audit passes', () => { const stack = resolveGroundwaterStackFrame(BASE, MATERIAL); assert.equal(stackAudit(stack.frame).ok, true); });
check('stack signature is deterministic', () => { assert.deepEqual(stackSignature(BASE, MATERIAL), stackSignature(BASE, MATERIAL)); });
check('stack recipe includes audit stage', () => { const recipe = groundwaterStackRecipe(); assert.ok(recipe.stages.some((stage) => stage.id === 'audit')); assert.equal(recipe.stages.length, 9); });

const eventTypes = ['storm','drought','freeze-thaw','snowmelt','recovery','neutral'];
for (const eventType of eventTypes) {
  for (const intensity of [0, .1, .25, .5, .75, 1]) {
    check(`event response ${eventType} ${intensity}`, () => {
      const frame = resolveGroundwaterSurfaceFrame(BASE);
      const response = stackEventResponse(frame, { type: eventType, intensity });
      for (const value of Object.values(response)) assert.ok(Number.isFinite(value));
      const result = stackEventFrame(frame, { type: eventType, intensity });
      bounded(result.material.color.r, 'event r');
      bounded(result.material.color.g, 'event g');
      bounded(result.material.color.b, 'event b');
      bounded(result.material.roughness, 'event roughness');
      bounded(result.material.normalStrength, 'event normal');
      bounded(result.material.wetness, 'event wetness');
    });
  }
}

for (let i = 0; i < 32; i += 1) {
  check(`location integration ${i}`, () => {
    const input = { ...BASE, worldX: -720 + i * 47, worldZ: 430 - i * 61, groundwaterDepthMeters: i * 3.5, waterDistanceMeters: i * 9, slopeDegrees: i * 2.4, temperatureC: -12 + i * 1.7, moisture: (i % 9) / 8, rainfall: (i % 11) / 10, runoff: (i % 7) / 6, drainage: (i % 13) / 12, windExposure: (i % 5) / 4, wetDays: i, dryDays: 63 - i });
    const stack = resolveGroundwaterStackFrame(input, MATERIAL);
    assert.equal(stackAudit(stack.frame).ok, true);
    bounded(stack.material.roughness, 'stack roughness');
    bounded(stack.material.normalStrength, 'stack normal');
    bounded(stack.frame.channels.wetness, 'stack wetness');
  });
}

check('diagnostic telemetry is render-only', () => { const telemetry = buildGroundwaterTelemetry(BASE); assert.equal(telemetry.canonical.heightUnchanged, true); assert.equal(telemetry.canonical.hydrologyUnchanged, true); assert.equal(telemetry.canonical.colliderUnchanged, true); });
check('frame audit contains debug channels', () => { const audit = frameAudit(BASE); assert.equal(audit.debugChannels.length, 13); assert.ok(audit.telemetry.signature.policyId); });
check('confidence bounded', () => bounded(confidenceScore(resolveTerrainGroundwaterState(BASE)), 'confidence'));
check('presentation tier finite', () => assert.ok(['high','medium','low','suppressed'].includes(presentationTier(resolveTerrainGroundwaterState(BASE)))));
check('diagnostic severity finite', () => assert.ok(['critical','high','moderate','nominal'].includes(diagnosticSeverity(resolveTerrainGroundwaterState(BASE)))));
check('metric snapshot bounded', () => { const snapshot = metricSnapshot(resolveTerrainGroundwaterState(BASE)); assert.equal(metricBounds(snapshot).ok, true); });
check('metric distance identity', () => { const state = resolveTerrainGroundwaterState(BASE); assert.equal(metricDistance(metricSnapshot(state), metricSnapshot(state)), 0); });
check('diagnostic grid size is deterministic', () => { const grid = sampleDiagnosticsGrid({ columns: 5, rows: 4, spacing: 26, input: BASE }); assert.equal(grid.length, 20); assert.deepEqual(grid, sampleDiagnosticsGrid({ columns: 5, rows: 4, spacing: 26, input: BASE })); });

const neighborhood = [
  resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 0, worldZ: 0 }),
  resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 20, worldZ: 0 }),
  resolveGroundwaterSurfaceFrame({ ...BASE, worldX: -20, worldZ: 0 }),
  resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 0, worldZ: 20 }),
  resolveGroundwaterSurfaceFrame({ ...BASE, worldX: 0, worldZ: -20 }),
];
check('neighborhood aggregation is bounded', () => { const stats = accumulateGroundwaterNeighborhood(neighborhood); bounded(stats.meanWetness, 'meanWetness'); bounded(stats.edgeContrast, 'edgeContrast'); assert.equal(stats.count, 5); });
check('neighborhood is stable', () => { assert.deepEqual(accumulateGroundwaterNeighborhood(neighborhood), accumulateGroundwaterNeighborhood(neighborhood)); });

check('state to frame to stack retains same sample', () => {
  const state = resolveTerrainGroundwaterState(BASE);
  const frame = stackFrameFromState(state, MATERIAL);
  assert.deepEqual(frame.state.sample, state.sample);
});

check('shader installer preserves material identity', () => {
  const material = { userData: {}, onBeforeCompile() {} };
  assert.equal(installTerrainGroundwaterShader(material), material);
  assert.equal(material.userData.terrainGroundwaterShaderInstalled, true);
});
check('shader installer sets stack-safe cache key', () => {
  const material = { userData: {} };
  installTerrainGroundwaterShader(material);
  assert.equal(typeof material.customProgramCacheKey(), 'string');
});

const climates = ['temperate','mediterranean','alpine','boreal','steppe','humid','monsoon','coastal'];
for (const biome of climates) {
  check(`biome ${biome} integration`, () => {
    const input = { ...BASE, biome };
    const stack = resolveGroundwaterStackFrame(input, MATERIAL);
    assert.equal(stack.frame.state.sample.biome, biome);
    assert.equal(stackAudit(stack.frame).ok, true);
  });
}

const substrates = ['loam','clay','sand','gravel','peat','marl','shale','limestone'];
for (const substrate of substrates) {
  check(`substrate ${substrate} integration`, () => {
    const input = { ...BASE, substrate };
    const state = resolveTerrainGroundwaterState(input);
    assert.equal(state.sample.substrate, substrate);
    bounded(state.surfaceFilm, 'film');
    bounded(state.surfaceSaturation, 'saturation');
  });
}

console.log(`[groundwater-integration] PASS: ${checks} checks`);
