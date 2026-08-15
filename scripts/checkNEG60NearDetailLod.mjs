#!/usr/bin/env node
import { G60_TERRAIN3D_NEAR_DETAIL_POLICY, sampleG60NearDetail } from '../godot/terrain-authoring/geocells/ne/g60_near_detail.mjs';

const p=G60_TERRAIN3D_NEAR_DETAIL_POLICY,b=p.normalizedBounds;
const fail=(m)=>{console.error(`[checkNEG60NearDetailLod] FAIL: ${m}`);process.exit(1);};
const requireCondition=(ok,m)=>{if(!ok)fail(m);};
function measure(size){
  let tintSum=0,roughnessSum=0,minTint=1,maxTint=0,minRoughness=1,maxRoughness=0,samples=0;
  for(let y=0;y<size;y+=1)for(let x=0;x<size;x+=1){
    const nx=b.xMin+(b.xMax-b.xMin)*x/(size-1),ny=b.yMin+(b.yMax-b.yMin)*y/(size-1),s=sampleG60NearDetail(nx,ny);
    const tint=(s.tintR+s.tintG+s.tintB)/3;tintSum+=tint;roughnessSum+=s.roughness;samples+=1;
    minTint=Math.min(minTint,s.tintR,s.tintG,s.tintB);maxTint=Math.max(maxTint,s.tintR,s.tintG,s.tintB);
    minRoughness=Math.min(minRoughness,s.roughness);maxRoughness=Math.max(maxRoughness,s.roughness);
  }
  return {size,samples,meanTint:tintSum/samples,meanRoughness:roughnessSum/samples,minTint,maxTint,minRoughness,maxRoughness};
}
const lods=[257,129,65,33].map(measure),reference=lods[0];
for(const current of lods){
  requireCondition(Math.abs(current.meanTint-reference.meanTint)<=0.0025,`LOD ${current.size} mean tint drifted`);
  requireCondition(Math.abs(current.meanRoughness-reference.meanRoughness)<=0.006,`LOD ${current.size} mean roughness drifted`);
  requireCondition(current.maxTint-current.minTint>=0.015,`LOD ${current.size} lost tint variation`);
  requireCondition(current.maxRoughness-current.minRoughness>=0.05,`LOD ${current.size} lost roughness variation`);
}
console.log(`G60_NEAR_DETAIL_LOD=${JSON.stringify(lods)}`);
console.log('NE_G60_NEAR_DETAIL_LOD_OK');
