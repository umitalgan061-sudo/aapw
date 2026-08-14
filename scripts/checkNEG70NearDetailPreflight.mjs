#!/usr/bin/env node
import { sampleG70NearDetail, G70_TERRAIN3D_NEAR_DETAIL_POLICY } from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';

const p = G70_TERRAIN3D_NEAR_DETAIL_POLICY;
const b = p.normalizedBounds;
const size = 257;
const fail = (message) => { console.error(`[checkNEG70NearDetailPreflight] FAIL: ${message}`); process.exit(1); };
const requireCondition = (condition, message) => { if (!condition) fail(message); };
const tintDelta = (a, c) => Math.max(Math.abs(a.tintR-c.tintR), Math.abs(a.tintG-c.tintG), Math.abs(a.tintB-c.tintB));
let maxTintStep = 0, maxRoughnessStep = 0, maxBlend = 0, maxCoverage = 0, maxFoliage = 0;
let minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0, previousRow = null;
let checksum = 2166136261;
for (let y = 0; y < size; y += 1) {
  const ny = b.yMin + (b.yMax-b.yMin) * y/(size-1); const row = [];
  for (let x = 0; x < size; x += 1) {
    const nx = b.xMin + (b.xMax-b.xMin) * x/(size-1); const s = sampleG70NearDetail(nx, ny);
    requireCondition(s.water && s.body === 'sea', `non-sea sample at ${x},${y}`);
    minTint = Math.min(minTint,s.tintR,s.tintG,s.tintB); maxTint = Math.max(maxTint,s.tintR,s.tintG,s.tintB);
    minRoughness = Math.min(minRoughness,s.roughness); maxRoughness = Math.max(maxRoughness,s.roughness);
    maxBlend = Math.max(maxBlend,Math.abs(s.controlBlend),Math.abs(s.roadPathControlBlend),Math.abs(s.rockWeight),Math.abs(s.snowWeight));
    maxCoverage = Math.max(maxCoverage,Math.abs(s.coverage),Math.abs(s.roadCoverage),Math.abs(s.pathCoverage)); maxFoliage = Math.max(maxFoliage,Math.abs(s.foliageDensity));
    if (x) { maxTintStep=Math.max(maxTintStep,tintDelta(s,row[x-1])); maxRoughnessStep=Math.max(maxRoughnessStep,Math.abs(s.roughness-row[x-1].roughness)); }
    if (previousRow) { maxTintStep=Math.max(maxTintStep,tintDelta(s,previousRow[x])); maxRoughnessStep=Math.max(maxRoughnessStep,Math.abs(s.roughness-previousRow[x].roughness)); }
    for (const value of [s.tintR,s.tintG,s.tintB,s.roughness]) checksum=Math.imul((checksum^Math.round(value*255))>>>0,16777619)>>>0;
    row.push(s);
  }
  previousRow=row;
}
const metrics={size,samples:size*size,minTint,maxTint,minRoughness,maxRoughness,maxTintStep,maxRoughnessStep,maxBlend,maxCoverage,maxFoliage,checksum:checksum>>>0};
requireCondition(maxBlend===0 && maxCoverage===0 && maxFoliage===0,'257 preflight leaked control/road/foliage');
requireCondition(maxTintStep<=0.014 && maxRoughnessStep<=0.045,`257 preflight continuity too rough: tint=${maxTintStep} roughness=${maxRoughnessStep}`);
requireCondition(maxTint-minTint>=0.018 && maxRoughness-minRoughness>=0.06,'257 preflight lost meaningful microvariation');
console.log(`G70_NEAR_DETAIL_PREFLIGHT=${JSON.stringify(metrics)}`);
console.log('NE_G70_NEAR_DETAIL_PREFLIGHT_OK');
