#!/usr/bin/env node
import {
  G60_TERRAIN3D_NEAR_DETAIL_POLICY,
  sampleG60NearDetail,
} from '../godot/terrain-authoring/geocells/ne/g60_near_detail.mjs';
import { sampleG70NearDetail } from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';

const fail = (message) => { console.error(`[checkNEG60NearDetailEnvelope] FAIL: ${message}`); process.exit(1); };
const requireCondition = (condition, message) => { if (!condition) fail(message); };
const p = G60_TERRAIN3D_NEAR_DETAIL_POLICY, b = p.normalizedBounds, g = p.guardNormalized;
const tintDelta = (a, c) => Math.max(Math.abs(a.tintR-c.tintR), Math.abs(a.tintG-c.tintG), Math.abs(a.tintB-c.tintB));
const normalDelta = (a, c) => Math.max(Math.abs(a.normal.x-c.normal.x), Math.abs(a.normal.y-c.normal.y), Math.abs(a.normal.z-c.normal.z));

let maxTintStep=0, maxRoughnessStep=0, minTint=1, maxTint=0, minRoughness=1, maxRoughness=0, previousRow=null;
for (let y=0;y<p.denseEnvelopeSize;y+=1) {
  const ny=b.yMin+(b.yMax-b.yMin)*y/(p.denseEnvelopeSize-1), row=[];
  for (let x=0;x<p.denseEnvelopeSize;x+=1) {
    const nx=b.xMin+(b.xMax-b.xMin)*x/(p.denseEnvelopeSize-1), s=sampleG60NearDetail(nx,ny);
    minTint=Math.min(minTint,s.tintR,s.tintG,s.tintB); maxTint=Math.max(maxTint,s.tintR,s.tintG,s.tintB);
    minRoughness=Math.min(minRoughness,s.roughness); maxRoughness=Math.max(maxRoughness,s.roughness);
    if (x) { maxTintStep=Math.max(maxTintStep,tintDelta(s,row[x-1])); maxRoughnessStep=Math.max(maxRoughnessStep,Math.abs(s.roughness-row[x-1].roughness)); }
    if (previousRow) { maxTintStep=Math.max(maxTintStep,tintDelta(s,previousRow[x])); maxRoughnessStep=Math.max(maxRoughnessStep,Math.abs(s.roughness-previousRow[x].roughness)); }
    row.push(s);
  }
  previousRow=row;
}

let maxGuardTint=0, maxGuardRoughness=0;
for (let i=0;i<p.denseEnvelopeSize;i+=1) {
  const t=i/(p.denseEnvelopeSize-1), nx=b.xMin+(b.xMax-b.xMin)*t, ny=b.yMin+(b.yMax-b.yMin)*t;
  for (const [a,c] of [
    [sampleG60NearDetail(b.xMin,ny),sampleG60NearDetail(b.xMin-g,ny)],
    [sampleG60NearDetail(b.xMax,ny),sampleG60NearDetail(b.xMax+g,ny)],
    [sampleG60NearDetail(nx,b.yMax),sampleG60NearDetail(nx,b.yMax+g)],
  ]) {
    maxGuardTint=Math.max(maxGuardTint,tintDelta(a,c));
    maxGuardRoughness=Math.max(maxGuardRoughness,Math.abs(a.roughness-c.roughness));
  }
}

let maxEastTint=0, maxEastRoughness=0, maxEastSignal=0, maxEastHeight=0, maxEastNormal=0, maxEastControl=0;
const seamSamples=257;
for (let i=0;i<seamSamples;i+=1) {
  const ny=b.yMin+(b.yMax-b.yMin)*i/(seamSamples-1);
  const a=sampleG60NearDetail(b.xMax,ny), c=sampleG70NearDetail(b.xMax,ny);
  maxEastTint=Math.max(maxEastTint,tintDelta(a,c));
  maxEastRoughness=Math.max(maxEastRoughness,Math.abs(a.roughness-c.roughness));
  maxEastSignal=Math.max(maxEastSignal,Math.abs(a.detailSignal-c.detailSignal));
  maxEastHeight=Math.max(maxEastHeight,Math.abs(a.authoredHeight-c.authoredHeight));
  maxEastNormal=Math.max(maxEastNormal,normalDelta(a,c));
  maxEastControl=Math.max(maxEastControl,Math.abs(a.controlBlend-c.controlBlend),Math.abs(a.coverage-c.coverage));
}
const g61=measureG61Hydrology();
const metrics={denseSamples:p.denseEnvelopeSize**2,seamSamples,maxTintStep,maxRoughnessStep,maxGuardTint,maxGuardRoughness,
  maxEastTint,maxEastRoughness,maxEastSignal,maxEastHeight,maxEastNormal,maxEastControl,minTint,maxTint,minRoughness,maxRoughness,
  g61Water:g61.waterCells,g61Land:g61.landCells,g61Sea:g61.seaCells,g61Lake:g61.lakeCells};

requireCondition(g61.waterCells===96 && g61.landCells===0 && g61.seaCells===96 && g61.lakeCells===0,'G61 south neighbor is no longer canonical open sea');
requireCondition(maxTintStep<=0.018 && maxRoughnessStep<=0.06,`dense internal continuity failed: tint=${maxTintStep} rough=${maxRoughnessStep}`);
requireCondition(maxGuardTint<=0.025 && maxGuardRoughness<=0.08,`owner guard continuity failed: tint=${maxGuardTint} rough=${maxGuardRoughness}`);
requireCondition(maxEastTint<=1e-8 && maxEastRoughness<=1e-8 && maxEastSignal<=1e-8,'G60/G70 Near Detail material phase seam mismatch');
requireCondition(maxEastHeight<=1e-9 && maxEastNormal<=1e-9 && maxEastControl<=1e-9,'G60/G70 physical/control seam mismatch');
requireCondition(maxTint-minTint>=0.018 && maxRoughness-minRoughness>=0.06,'dense envelope lost meaningful microvariation');
console.log(`G60_NEAR_DETAIL_ENVELOPE=${JSON.stringify(metrics)}`);
console.log('NE_G60_NEAR_DETAIL_ENVELOPE_OK');
