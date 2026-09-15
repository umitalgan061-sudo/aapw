#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  resolveTerrainGroundwaterState,
  groundwaterMaterialResponse,
} from '../src/3d/world/terrainGroundwaterRegime.js';
import {
  resolveGroundwaterSurfaceFrame,
  blendGroundwaterFrames,
  accumulateGroundwaterNeighborhood,
  sharpenGroundwaterEdge,
  applyGroundwaterBudget,
  classifyGroundwaterPresentation,
  groundwaterDebugChannels,
  groundwaterSurfaceSignature,
  TERRAIN_GROUNDWATER_CHANNELS,
  TERRAIN_GROUNDWATER_ADAPTER_POLICY,
} from '../src/3d/world/terrainGroundwaterSurfaceAdapter.js';
import {
  TERRAIN_GROUNDWATER_GLSL,
  TERRAIN_GROUNDWATER_SHADER_INVARIANTS,
  groundwaterShaderReplacements,
  installTerrainGroundwaterShader,
} from '../src/3d/world/terrainGroundwaterShader.js';

const BASE = Object.freeze({ worldX: 73, worldZ: -191, heightMeters: 31, slopeDegrees: 7, moisture: .52, rainfall: .55, runoff: .16, soilDepth: 1.18, permeability: .48, waterDistanceMeters: 46, groundwaterDepthMeters: 14, wetDays: 12, dryDays: 3, dayOfYear: 124, temperatureC: 16, drainage: .44, windExposure: .35, substrate: 'loam', biome: 'temperate' });
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-materials] PASS: ${name}`); }
function bounded(value, label) { assert.ok(Number.isFinite(value), `${label} finite`); assert.ok(value >= 0 && value <= 1, `${label} bounded`); }
function frame(overrides = {}) { return resolveGroundwaterSurfaceFrame({ ...BASE, ...overrides, baseColor: { r: .42, g: .36, b: .29 }, baseRoughness: .86 }); }

check('channel contract has fourteen channels', () => {
  assert.equal(TERRAIN_GROUNDWATER_CHANNELS.length, 14);
  assert.equal(new Set(TERRAIN_GROUNDWATER_CHANNELS).size, 14);
});
check('adapter policy is render-only', () => {
  assert.equal(TERRAIN_GROUNDWATER_ADAPTER_POLICY.renderOnly, true);
  assert.equal(TERRAIN_GROUNDWATER_ADAPTER_POLICY.deterministic, true);
});
check('GLSL exists', () => assert.ok(TERRAIN_GROUNDWATER_GLSL.length > 100));
check('GLSL has all application hooks', () => {
  const replacements = groundwaterShaderReplacements();
  assert.equal(replacements.common, true);
  assert.equal(replacements.color, true);
  assert.equal(replacements.roughness, true);
  assert.equal(replacements.normal, true);
  assert.equal(replacements.vertexDisplacement, true);
  assert.equal(replacements.geometryMutation, true);
});
check('shader invariants are explicit', () => {
  assert.ok(TERRAIN_GROUNDWATER_SHADER_INVARIANTS.includes('no-vertex-position-write'));
  assert.ok(TERRAIN_GROUNDWATER_SHADER_INVARIANTS.includes('no-height-map-write'));
});

for (const day of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]) {
  check(`frame day ${day} bounded`, () => {
    const value = frame({ dayOfYear: day });
    for (const key of TERRAIN_GROUNDWATER_CHANNELS) bounded(value.channels[key], `${key} day ${day}`);
    bounded(value.material.color.r, 'r');
    bounded(value.material.color.g, 'g');
    bounded(value.material.color.b, 'b');
    bounded(value.material.roughness, 'roughness');
    bounded(value.material.normalStrength, 'normalStrength');
    bounded(value.material.wetness, 'wetness');
  });
}

for (const groundwaterDepthMeters of [0, 2, 5, 9, 14, 22, 35, 55, 90, 160, 350]) {
  check(`depth material ${groundwaterDepthMeters}`, () => {
    const value = frame({ groundwaterDepthMeters });
    bounded(value.channels.waterTableProximity, 'table');
    bounded(value.channels.wetness, 'wetness');
    bounded(value.channels.capillaryRise, 'capillary');
  });
}

for (const slopeDegrees of [0, 1, 4, 8, 12, 18, 25, 34, 44, 57, 73, 89]) {
  check(`slope material ${slopeDegrees}`, () => {
    const value = frame({ slopeDegrees });
    bounded(value.channels.seepageFace, 'seepage');
    bounded(value.channels.puddlePersistence, 'puddle');
    bounded(value.material.normalStrength, 'normal');
  });
}

const classifications = new Set();
for (const scenario of [
  { name: 'puddle', puddlePersistence: .9, wetness: .9 },
  { name: 'marsh', marshEdge: .9, saturation: .9 },
  { name: 'seepage', seepageFace: .9 },
  { name: 'salt', saltRing: .9, wetness: .1 },
]) {
  check(`classification surface ${scenario.name}`, () => {
    const base = frame();
    const altered = { ...base, channels: { ...base.channels, ...scenario } };
    const label = classifyGroundwaterPresentation(altered);
    classifications.add(label);
    assert.equal(typeof label, 'string');
  });
}
check('classification returns a known label', () => {
  for (const value of classifications) assert.ok(['persistent-puddle','marsh-edge','seepage-face','evaporative-ring','capillary-damp','damp-soil','dry-recession','neutral'].includes(value));
});

check('debug channels are fourteen entries', () => {
  const debug = groundwaterDebugChannels(frame());
  assert.equal(debug.length, 13);
  for (const row of debug) { assert.ok(row.id); bounded(row.value, row.id); }
});

check('surface signature is stable', () => {
  const a = groundwaterSurfaceSignature(frame());
  const b = groundwaterSurfaceSignature(frame());
  assert.deepEqual(a, b);
});

check('blend at zero equals first', () => {
  const a = frame({ worldX: -50 });
  const b = frame({ worldX: 450 });
  const blended = blendGroundwaterFrames(a, b, 0);
  assert.equal(blended.channels.wetness, a.channels.wetness);
  assert.equal(blended.material.roughness, a.material.roughness);
});
check('blend at one equals second', () => {
  const a = frame({ worldX: -50 });
  const b = frame({ worldX: 450 });
  const blended = blendGroundwaterFrames(a, b, 1);
  assert.equal(blended.channels.wetness, b.channels.wetness);
  assert.equal(blended.material.roughness, b.material.roughness);
});
check('blend midpoint is bounded', () => {
  const blended = blendGroundwaterFrames(frame({ worldX: -50 }), frame({ worldX: 450 }), .5);
  for (const key of TERRAIN_GROUNDWATER_CHANNELS) bounded(blended.channels[key], `blend ${key}`);
  bounded(blended.material.roughness, 'blend roughness');
  bounded(blended.material.normalStrength, 'blend normal');
});

const neighborhoodSamples = [
  frame({ worldX: 0, worldZ: 0 }),
  frame({ worldX: 37, worldZ: 0 }),
  frame({ worldX: -37, worldZ: 0 }),
  frame({ worldX: 0, worldZ: 37 }),
  frame({ worldX: 0, worldZ: -37 }),
  frame({ worldX: 74, worldZ: 74 }),
  frame({ worldX: -74, worldZ: -74 }),
];
check('neighborhood accumulation', () => {
  const result = accumulateGroundwaterNeighborhood(neighborhoodSamples);
  assert.equal(result.count, neighborhoodSamples.length);
  bounded(result.meanWetness, 'meanWetness');
  bounded(result.meanSaturation, 'meanSaturation');
  bounded(result.meanSeepage, 'meanSeepage');
  bounded(result.meanCapillary, 'meanCapillary');
  bounded(result.meanPuddle, 'meanPuddle');
  bounded(result.edgeContrast, 'edgeContrast');
});
check('empty neighborhood is safe', () => {
  assert.deepEqual(accumulateGroundwaterNeighborhood([]), { count: 0, meanWetness: 0, meanSaturation: 0, meanSeepage: 0, meanCapillary: 0, meanPuddle: 0, edgeContrast: 0 });
});
check('edge sharpening remains bounded', () => {
  const result = sharpenGroundwaterEdge(frame(), accumulateGroundwaterNeighborhood(neighborhoodSamples), .75);
  for (const key of TERRAIN_GROUNDWATER_CHANNELS) bounded(result.channels[key], `sharp ${key}`);
});
check('edge sharpening at zero is identity', () => {
  const original = frame();
  const result = sharpenGroundwaterEdge(original, accumulateGroundwaterNeighborhood(neighborhoodSamples), 0);
  assert.deepEqual(result.channels, original.channels);
});
check('budget wrapper keeps material in range', () => {
  const result = applyGroundwaterBudget(frame());
  bounded(result.material.color.r, 'budget r');
  bounded(result.material.color.g, 'budget g');
  bounded(result.material.color.b, 'budget b');
  bounded(result.material.roughness, 'budget roughness');
  bounded(result.material.normalStrength, 'budget normal');
});

check('material response uses supplied base color', () => {
  const state = resolveTerrainGroundwaterState(BASE);
  const result = groundwaterMaterialResponse({ state, baseColor: { r: .2, g: .3, b: .4 }, baseRoughness: .9 });
  assert.notEqual(result.color.r, .5);
  assert.ok(result.roughness <= 1);
});

check('shader installer idempotence', () => {
  const calls = [];
  const material = {
    userData: {},
    onBeforeCompile(shader) { calls.push(shader); },
    customProgramCacheKey() { return 'base'; },
  };
  const first = installTerrainGroundwaterShader(material);
  const second = installTerrainGroundwaterShader(material);
  assert.equal(first, material);
  assert.equal(second, material);
  assert.equal(material.userData.terrainGroundwaterShaderInstalled, true);
  const shader = { fragmentShader: '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>' };
  material.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes('terrainGroundwaterApplyColor'));
  assert.ok(shader.fragmentShader.includes('terrainGroundwaterApplyRoughness'));
  assert.ok(shader.fragmentShader.includes('terrainGroundwaterApplyNormal'));
  assert.equal(calls.length, 1);
});

check('shader installer works without prior cache key', () => {
  const material = { userData: {} };
  installTerrainGroundwaterShader(material);
  assert.equal(typeof material.customProgramCacheKey, 'function');
});

for (let i = 0; i < 25; i += 1) {
  check(`material grid ${i}`, () => {
    const value = frame({ worldX: -500 + i * 41, worldZ: 120 - i * 23, moisture: i / 24, rainfall: 1 - i / 48, groundwaterDepthMeters: i * 7, waterDistanceMeters: i * 9, slopeDegrees: i * 3.1, drainage: i / 24, temperatureC: -10 + i * 2 });
    bounded(value.channels.wetness, 'grid wetness');
    bounded(value.channels.saturation, 'grid saturation');
    bounded(value.channels.saltRing, 'grid salt');
    bounded(value.material.roughness, 'grid roughness');
  });
}

console.log(`[groundwater-materials] PASS: ${checks} checks`);
