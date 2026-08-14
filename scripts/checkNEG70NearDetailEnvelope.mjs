#!/usr/bin/env node
import {
  G70_TERRAIN3D_NEAR_DETAIL_POLICY,
  sampleG70NearDetail,
} from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';

const fail = (message) => { console.error(`[checkNEG70NearDetailEnvelope] FAIL: ${message}`); process.exit(1); };
const requireCondition = (condition, message) => { if (!condition) fail(message); };
const p = G70_TERRAIN3D_NEAR_DETAIL_POLICY;
const b = p.normalizedBounds;
const size = 193;
const guard = p.guardBandNormalized;
let maxTintStep = 0, maxRoughnessStep = 0, maxWestGuardTint = 0, maxSouthGuardTint = 0;
let maxWestGuardRoughness = 0, maxSouthGuardRoughness = 0, maxHeightDelta = 0, maxControlDelta = 0;
let minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0, previousRow = null;
const tintDelta = (a, c) => Math.max(Math.abs(a.tintR-c.tintR), Math.abs(a.tintG-c.tintG), Math.abs(a.tintB-c.tintB));
for (let y = 0; y < size; y += 1) {
  const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1);
  const row = [];
  for (let x = 0; x < size; x += 1) {
    const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1);
    const s = sampleG70NearDetail(nx, ny);
    minTint = Math.min(minTint, s.tintR, s.tintG, s.tintB); maxTint = Math.max(maxTint, s.tintR, s.tintG, s.tintB);
    minRoughness = Math.min(minRoughness, s.roughness); maxRoughness = Math.max(maxRoughness, s.roughness);
    maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - s.heightMeters));
    maxControlDelta = Math.max(maxControlDelta, Math.abs(s.controlBlend), Math.abs(s.roadPathControlBlend), Math.abs(s.rockWeight), Math.abs(s.snowWeight));
    if (x) { maxTintStep = Math.max(maxTintStep, tintDelta(s, row[x-1])); maxRoughnessStep = Math.max(maxRoughnessStep, Math.abs(s.roughness-row[x-1].roughness)); }
    if (previousRow) { maxTintStep = Math.max(maxTintStep, tintDelta(s, previousRow[x])); maxRoughnessStep = Math.max(maxRoughnessStep, Math.abs(s.roughness-previousRow[x].roughness)); }
    row.push(s);
  }
  previousRow = row;
}
for (let i = 0; i < size; i += 1) {
  const t = i / (size - 1); const nx = b.xMin + (b.xMax - b.xMin) * t; const ny = b.yMin + (b.yMax - b.yMin) * t;
  const westA = sampleG70NearDetail(b.xMin, ny), westB = sampleG70NearDetail(b.xMin - guard, ny);
  const southA = sampleG70NearDetail(nx, b.yMax), southB = sampleG70NearDetail(nx, b.yMax + guard);
  maxWestGuardTint = Math.max(maxWestGuardTint, tintDelta(westA, westB)); maxWestGuardRoughness = Math.max(maxWestGuardRoughness, Math.abs(westA.roughness-westB.roughness));
  maxSouthGuardTint = Math.max(maxSouthGuardTint, tintDelta(southA, southB)); maxSouthGuardRoughness = Math.max(maxSouthGuardRoughness, Math.abs(southA.roughness-southB.roughness));
}
const metrics = {
  gridSize:size, samples:size*size, minTint, maxTint, minRoughness, maxRoughness,
  maxTintStep, maxRoughnessStep, maxWestGuardTint, maxSouthGuardTint, maxWestGuardRoughness, maxSouthGuardRoughness,
  maxHeightDelta, maxControlDelta,
};
requireCondition(maxHeightDelta === 0 && maxControlDelta === 0, 'dense envelope changed height/control/road substrate');
requireCondition(maxTintStep <= 0.018 && maxRoughnessStep <= 0.06, `dense internal seam too large: tint=${maxTintStep} roughness=${maxRoughnessStep}`);
requireCondition(maxWestGuardTint <= 0.025 && maxSouthGuardTint <= 0.025, `G60/G71 tint guard seam too large: west=${maxWestGuardTint} south=${maxSouthGuardTint}`);
requireCondition(maxWestGuardRoughness <= 0.08 && maxSouthGuardRoughness <= 0.08, `G60/G71 roughness guard seam too large: west=${maxWestGuardRoughness} south=${maxSouthGuardRoughness}`);
requireCondition(maxTint-minTint >= 0.018 && maxRoughness-minRoughness >= 0.06, 'dense envelope lost meaningful microvariation');
console.log(`G70_NEAR_DETAIL_ENVELOPE=${JSON.stringify(metrics)}`);
console.log('NE_G70_NEAR_DETAIL_ENVELOPE_OK');
