#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_ASSET_TRANSITION_FIELD_POLICY,
  sampleWorldAssetTransitionField,
  transitionFieldDiagnostics,
  worldAssetTransitionResponse,
} from '../src/3d/world/worldAssetTransitionField.js';

const base = {
  x: 0,
  z: 0,
  moisture: 0.52,
  slopeDegrees: 8,
  shelter: 0.58,
  snow: 0,
  lithic: 0.30,
  erosion: 0.34,
  deposition: 0.56,
  coastDistance: 500,
  riverDistance: 500,
  lakeDistance: 500,
  roadDistance: 80,
  settlementDistance: 120,
  biome: 'meadow',
};

function assertBounded(value, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  assert.ok(value >= 0 && value <= 1, `${label} must be in [0,1], received ${value}`);
}

const inland = sampleWorldAssetTransitionField(base);
for (const key of ['moisture', 'slope', 'snow', 'exposure', 'shelter', 'lithic', 'erosion', 'deposition', 'wetland', 'meadow', 'heath', 'alpine', 'talus', 'riparian', 'maritime', 'dryness', 'frost', 'access']) {
  assertBounded(inland[key], `inland.${key}`);
}
for (const key of ['coast', 'river', 'lake', 'road', 'settlement']) {
  for (const band of ['inner', 'middle', 'outer', 'total']) assertBounded(inland[key][band], `inland.${key}.${band}`);
}
for (const key of ['coastRiver', 'coastInland', 'wetDry', 'roadWild', 'settlementWild', 'relief']) {
  assertBounded(inland.transition[key], `inland.transition.${key}`);
}
for (const key of ['salt', 'damp', 'dust', 'wear', 'weathering', 'albedoShift', 'roughnessShift', 'normalStrength']) {
  assertBounded(inland.material[key], `inland.material.${key}`);
}

const coast = sampleWorldAssetTransitionField({
  ...base,
  coastDistance: 8,
  moisture: 0.66,
  biome: 'coastal meadow',
  lithic: 0.58,
  erosion: 0.58,
});
assert.ok(coast.coast.inner > 0.8, 'coastal inner band should be strong at 8m');
assert.ok(coast.maritime > inland.maritime, 'maritime signal should rise near coast');
assert.ok(coast.material.salt > inland.material.salt, 'salt response should rise near coast');

const river = sampleWorldAssetTransitionField({
  ...base,
  riverDistance: 4,
  moisture: 0.84,
  biome: 'riparian meadow',
});
assert.ok(river.river.inner > 0.85, 'river inner band should be strong at 4m');
assert.ok(river.riparian > inland.riparian, 'riparian signal should rise near river');
assert.ok(river.material.damp > inland.material.damp, 'damp material response should rise near river');

const wetland = sampleWorldAssetTransitionField({
  ...base,
  riverDistance: 10,
  lakeDistance: 12,
  moisture: 0.96,
  biome: 'marsh wetland',
});
assert.ok(wetland.wetland > 0.78, 'marsh wetland should dominate the wetland field');
assert.ok(wetland.dryness < inland.dryness, 'wetland should reduce dryness');

const dryHeath = sampleWorldAssetTransitionField({
  ...base,
  moisture: 0.16,
  shelter: 0.24,
  slopeDegrees: 22,
  biome: 'dry heath',
});
assert.ok(dryHeath.heath > inland.heath, 'dry heath should increase heath domain');
assert.ok(dryHeath.dryness > inland.dryness, 'dry heath should increase dryness');

const alpine = sampleWorldAssetTransitionField({
  ...base,
  moisture: 0.42,
  slopeDegrees: 48,
  shelter: 0.18,
  snow: 0.58,
  lithic: 0.88,
  biome: 'alpine ridge',
});
assert.ok(alpine.alpine > 0.74, 'steep lithic alpine terrain should be alpine-dominant');
assert.ok(alpine.talus > 0.65, 'steep erodible lithic terrain should expose talus signal');

const settlement = sampleWorldAssetTransitionField({
  ...base,
  settlementDistance: 5,
  roadDistance: 3,
});
assert.ok(settlement.settlement.inner > 0.85, 'settlement inner band should be strong at 5m');
assert.ok(settlement.road.inner > 0.85, 'road inner band should be strong at 3m');
assert.ok(settlement.access > inland.access * 0.75, 'near-settlement road surface should retain access signal');

const deterministicA = sampleWorldAssetTransitionField({ ...base, coastDistance: 47.25, riverDistance: 31.5 });
const deterministicB = sampleWorldAssetTransitionField({ ...base, coastDistance: 47.25, riverDistance: 31.5 });
assert.deepEqual(deterministicA, deterministicB, 'transition sampling must be deterministic');

const families = ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'building', 'settlement', 'waterside'];
for (const family of families) {
  const inlandResponse = worldAssetTransitionResponse(inland, family);
  const coastalResponse = worldAssetTransitionResponse(coast, family);
  const alpineResponse = worldAssetTransitionResponse(alpine, family);
  assert.equal(inlandResponse.family, family);
  assertBounded(inlandResponse.response, `${family}.inland.response`);
  assertBounded(inlandResponse.familyScore, `${family}.inland.familyScore`);
  assert.ok(inlandResponse.field.policyId === WORLD_ASSET_TRANSITION_FIELD_POLICY.id);
  if (family === 'waterside') assert.ok(coastalResponse.response > inlandResponse.response, 'waterside family should gain coastal response');
  if (family === 'rock') assert.ok(alpineResponse.response > inlandResponse.response, 'rock family should gain alpine response');
}

const diagnostic = transitionFieldDiagnostics({
  ...coast,
  coastDistance: 4,
  riverDistance: 8,
  settlementDistance: 20,
  roadDistance: 9,
  biome: 'coastal wetland',
}, 'waterside');
assert.ok(diagnostic.requiresTransitionHandling);
assert.ok(diagnostic.flags.includes('coastal-inner-band'));
assert.ok(diagnostic.flags.includes('freshwater-edge'));
assert.ok(diagnostic.flags.includes('wetland-dominant'));

console.log(JSON.stringify({
  ok: true,
  policyId: WORLD_ASSET_TRANSITION_FIELD_POLICY.id,
  familyCoverage: families.length,
  coastalSalt: coast.material.salt,
  riverDamp: river.material.damp,
  alpineTalus: alpine.talus,
  diagnosticFlags: diagnostic.flags,
}, null, 2));
