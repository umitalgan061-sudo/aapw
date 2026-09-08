#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sampleWorldAssetGeographyProfile } from '../src/3d/world/worldAssetGeographyProfile.js';
import { sampleWorldAssetTransitionField } from '../src/3d/world/worldAssetTransitionField.js';
import { sampleWorldAssetGeographyMaterialResponse } from '../src/3d/world/worldAssetGeographyMaterialBridge.js';

const biomes = [
  ['woodland', 0.72, 8, 0.0, 360, 500],
  ['meadow', 0.56, 6, 0.0, 500, 500],
  ['dry heath', 0.20, 18, 0.0, 500, 500],
  ['wetland marsh', 0.90, 4, 0.0, 18, 500],
  ['riparian meadow', 0.82, 6, 0.0, 7, 500],
  ['coastal grass', 0.66, 7, 0.0, 500, 9],
  ['alpine ridge', 0.42, 44, 0.50, 500, 500],
  ['scree', 0.36, 48, 0.36, 500, 500],
  ['snowfield', 0.46, 32, 0.90, 500, 500],
  ['volcanic', 0.24, 27, 0.08, 500, 500],
];
const families = ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'building', 'settlement', 'waterside'];

function point(biome, moisture, slope, snow, riverDistance, coastDistance, x, z, normalizedX = 0.5, normalizedY = 0.5) {
  return {
    x,
    z,
    normalizedX,
    normalizedY,
    height: 80 + Math.sin(x * 0.02) * 4 + Math.cos(z * 0.017) * 5,
    slopeDegrees: slope,
    aspectRadians: Math.atan2(z, x),
    moisture,
    biome,
    snow,
    waterDepth: biome.includes('wetland') ? 0.20 : 0,
    riverDistance,
    lakeDistance: biome.includes('wetland') ? 18 : 500,
    coastDistance,
    roadDistance: 70,
    settlementDistance: 90,
    shelter: Math.max(0.08, 0.72 - slope * 0.010),
    erosion: /scree|alpine|coast|volcanic/.test(biome) ? 0.68 : 0.28,
    deposition: /meadow|wetland|riparian/.test(biome) ? 0.72 : 0.36,
    lithic: /scree|alpine|coast|volcanic/.test(biome) ? 0.78 : 0.28,
  };
}

function bounded(value, label) {
  assert.ok(Number.isFinite(value), `${label} finite`);
  assert.ok(value >= 0 && value <= 1, `${label} bounded`);
}

let profilePairs = 0;
let transitionPairs = 0;
let materialPairs = 0;
let maxProfileJump = 0;
let maxTransitionJump = 0;
let maxMaterialJump = 0;

for (const [biome, moisture, slope, snow, riverDistance, coastDistance] of biomes) {
  const surfaceA = point(biome, moisture, slope, snow, riverDistance, coastDistance, 100, 200);
  const surfaceB = point(biome, Math.min(1, moisture + 0.018), slope + 0.8, Math.min(1, snow + 0.012), riverDistance + 2, coastDistance + 2, 103, 201);
  const profileA = sampleWorldAssetGeographyProfile(surfaceA, { id: `continuity-a-${biome}`, family: 'tree' });
  const profileB = sampleWorldAssetGeographyProfile(surfaceB, { id: `continuity-b-${biome}`, family: 'tree' });
  maxProfileJump = Math.max(maxProfileJump, Math.abs(profileA.placementScore - profileB.placementScore));
  assert.ok(maxProfileJump <= 0.44, `profile field jumps too sharply for ${biome}`);
  profilePairs++;

  const transitionA = sampleWorldAssetTransitionField(surfaceA);
  const transitionB = sampleWorldAssetTransitionField(surfaceB);
  for (const key of ['wetland', 'meadow', 'heath', 'alpine', 'talus', 'riparian', 'maritime', 'dryness', 'frost']) {
    const jump = Math.abs(transitionA[key] - transitionB[key]);
    maxTransitionJump = Math.max(maxTransitionJump, jump);
    assert.ok(jump <= 0.36, `transition field jump too large for ${biome}/${key}`);
  }
  transitionPairs++;

  for (const family of families) {
    const materialA = sampleWorldAssetGeographyMaterialResponse({ surface: surfaceA, metadata: { family }, materialName: family });
    const materialB = sampleWorldAssetGeographyMaterialResponse({ surface: surfaceB, metadata: { family }, materialName: family });
    const colorA = materialA.response.color;
    const colorB = materialB.response.color;
    for (let channel = 0; channel < 3; channel++) {
      const jump = Math.abs(colorA[channel] - colorB[channel]);
      maxMaterialJump = Math.max(maxMaterialJump, jump);
      assert.ok(jump <= 0.30, `material color seam too strong for ${biome}/${family}`);
    }
    const roughnessJump = Math.abs(materialA.base.roughness - materialB.base.roughness);
    assert.ok(roughnessJump <= 0.26, `roughness seam too strong for ${biome}/${family}`);
    bounded(materialA.base.roughness, `${biome}/${family}.roughness`);
    bounded(materialA.base.metalness, `${biome}/${family}.metalness`);
    bounded(materialA.base.normalScale, `${biome}/${family}.normalScale`);
    materialPairs++;
  }
}

const coastNear = sampleWorldAssetTransitionField(point('coastal grass', 0.62, 6, 0.02, 500, 8));
const coastFar = sampleWorldAssetTransitionField(point('coastal grass', 0.62, 6, 0.02, 500, 170));
assert.ok(coastNear.maritime > coastFar.maritime, 'maritime influence must decay toward inland');
assert.ok(coastNear.material.salt > coastFar.material.salt, 'salt response must decay toward inland');

const riverNear = sampleWorldAssetTransitionField(point('riparian meadow', 0.84, 6, 0.0, 6, 500));
const riverFar = sampleWorldAssetTransitionField(point('riparian meadow', 0.70, 6, 0.0, 85, 500));
assert.ok(riverNear.riparian > riverFar.riparian, 'riparian influence must decay away from river');
assert.ok(riverNear.material.damp > riverFar.material.damp, 'damp response must decay away from river');

const dryNear = sampleWorldAssetTransitionField(point('dry heath', 0.16, 20, 0.0, 500, 500));
const wetNear = sampleWorldAssetTransitionField(point('wetland marsh', 0.92, 5, 0.0, 8, 500));
assert.ok(dryNear.dryness > wetNear.dryness, 'dry and wet transition fields should remain semantically separated');
assert.ok(dryNear.heath > wetNear.heath, 'dry heath should dominate heath more than wetland');
assert.ok(wetNear.wetland > dryNear.wetland, 'wetland should dominate wetland more than dry heath');

console.log(JSON.stringify({
  ok: true,
  profilePairs,
  transitionPairs,
  materialPairs,
  maxProfileJump,
  maxTransitionJump,
  maxMaterialJump,
  coastMaritimeNear: coastNear.maritime,
  coastMaritimeFar: coastFar.maritime,
  riverDampNear: riverNear.material.damp,
  riverDampFar: riverFar.material.damp,
}, null, 2));
