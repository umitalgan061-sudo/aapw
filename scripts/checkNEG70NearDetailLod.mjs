#!/usr/bin/env node
import { sampleG70NearDetail, G70_TERRAIN3D_NEAR_DETAIL_POLICY } from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';

const p = G70_TERRAIN3D_NEAR_DETAIL_POLICY;
const b = p.normalizedBounds;
const fail = (message) => { console.error(`[checkNEG70NearDetailLod] FAIL: ${message}`); process.exit(1); };
const requireCondition = (condition, message) => { if (!condition) fail(message); };
function measure(size) {
  let tintSum=0, roughnessSum=0, minTint=1, maxTint=0, minRoughness=1, maxRoughness=0, samples=0;
  for (let y=0;y<size;y+=1) for (let x=0;x<size;x+=1) {
    const nx=b.xMin+(b.xMax-b.xMin)*x/(size-1), ny=b.yMin+(b.yMax-b.yMin)*y/(size-1); const s=sampleG70NearDetail(nx,ny);
    const tint=(s.tintR+s.tintG+s.tintB)/3; tintSum+=tint; roughnessSum+=s.roughness; samples+=1;
    minTint=Math.min(minTint,s.tintR,s.tintG,s.tintB); maxTint=Math.max(maxTint,s.tintR,s.tintG,s.tintB);
    minRoughness=Math.min(minRoughness,s.roughness); maxRoughness=Math.max(maxRoughness,s.roughness);
  }
  return {size,samples,meanTint:tintSum/samples,meanRoughness:roughnessSum/samples,minTint,maxTint,minRoughness,maxRoughness};
}
const lods=[257,129,65,33].map(measure); const reference=lods[0];
for (const lod of lods) {
  requireCondition(Math.abs(lod.meanTint-reference.meanTint)<=0.0025,`LOD ${lod.size} mean tint drifted`);
  requireCondition(Math.abs(lod.meanRoughness-reference.meanRoughness)<=0.006,`LOD ${lod.size} mean roughness drifted`);
  requireCondition(lod.maxTint-lod.minTint>=0.015,`LOD ${lod.size} lost tint variation`);
  requireCondition(lod.maxRoughness-lod.minRoughness>=0.05,`LOD ${lod.size} lost roughness variation`);
}
console.log(`G70_NEAR_DETAIL_LOD=${JSON.stringify(lods)}`);
console.log('NE_G70_NEAR_DETAIL_LOD_OK');
