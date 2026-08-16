#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G71_TERRAIN3D_NEAR_DETAIL_POLICY as P,
  buildG71Terrain3DNearDetailProbe,
  g71NearDetailGuardBounds,
  g71NearDetailSignal,
  measureG71Terrain3DNearDetail,
  sampleG71NearDetail,
} from '../godot/terrain-authoring/geocells/ne/g71_near_detail.mjs';
import { sampleG71RoadPath } from '../godot/terrain-authoring/geocells/ne/g71_road_path.mjs';
import { sampleG70NearDetail } from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';
import { measureG61Hydrology } from '../godot/terrain-authoring/geocells/ne/g61_hydrology.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const tintDelta = (a,b) => Math.max(Math.abs(a.tintR-b.tintR),Math.abs(a.tintG-b.tintG),Math.abs(a.tintB-b.tintB));
const normalDelta = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.z-b.z));
const hash = (state, value) => { let q=Math.round(value*1e6)|0; for(const s of [0,8,16,24]) state=Math.imul((state^(q>>>s))>>>0,16777619)>>>0; return state>>>0; };

assert.equal(P.sourceMapSha256, MAP_SHA); assert.equal(P.geoCell,'G71'); assert.equal(P.layer,'Near Detail');
assert.equal(P.sourceGridSize,129); assert.equal(P.denseEnvelopeSize,193); assert.equal(P.terrain3dImportSize,257); assert.equal(P.terrain3dRegionSize,256);
assert.deepEqual(P.microWavelengthMeters,[47,71,109,163]); assert.equal(P.foliageDensity,0); assert.equal(P.eastWorldBoundaryX,1); assert.equal(P.eastGuardAllowed,false);
const sourceText=fs.readFileSync(path.join(ROOT,'godot/terrain-authoring/geocells/ne/g71_near_detail.mjs'),'utf8');
const signalBody=sourceText.match(/export function g71NearDetailSignal\([\s\S]*?\n}/)?.[0]??'';
assert.match(signalBody,/physicalCoordinates/); assert.doesNotMatch(signalBody,/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy|Math\.floor|Math\.round/);

const a=measureG71Terrain3DNearDetail(), b=measureG71Terrain3DNearDetail(); assert.deepEqual(a,b);
assert.equal(a.canonicalWaterCells,96); assert.equal(a.canonicalLandCells,0); assert.equal(a.sourceSamples,16641);
assert.equal(a.maxHeightDelta,0); assert.equal(a.maxControlDelta,0); assert.equal(a.maxRoadPathDelta,0); assert.equal(a.maxFoliageDensity,0); assert.equal(a.maxMacroColorDelta,0);
assert.ok(a.minSignal < -0.70 && a.maxSignal > 0.70); assert.ok(a.minTint>=P.tintFloor&&a.maxTint<=P.tintCeiling&&a.maxTint-a.minTint>=0.018);
assert.ok(a.minRoughness>=P.roughnessFloor&&a.maxRoughness<=P.roughnessCeiling&&a.maxRoughness-a.minRoughness>=0.06);
assert.ok(a.maxAdjacentTintDelta<=0.025&&a.maxAdjacentRoughnessDelta<=0.08);

// 193x193 owner+guard audit: west/north/south only; east is clipped to the world boundary.
const e=g71NearDetailGuardBounds(); let guardSamples=0, maxGuardHeight=0, maxGuardControl=0, maxGuardRoad=0, maxGuardFoliage=0, guardChecksum=2166136261;
for(let y=0;y<193;y++)for(let x=0;x<193;x++){
  const nx=e.xMin+(e.xMax-e.xMin)*x/192, ny=e.yMin+(e.yMax-e.yMin)*y/192;
  const s=sampleG71NearDetail(nx,ny), p=sampleG71RoadPath(nx,ny);
  maxGuardHeight=Math.max(maxGuardHeight,Math.abs(s.authoredHeight-p.authoredHeight));
  maxGuardControl=Math.max(maxGuardControl,Math.abs(s.controlBlend-p.controlBlend));
  maxGuardRoad=Math.max(maxGuardRoad,Math.abs(s.coverage-p.coverage)); maxGuardFoliage=Math.max(maxGuardFoliage,Math.abs(s.foliageDensity));
  for(const v of [s.tintR,s.tintG,s.tintB,s.roughness]) guardChecksum=hash(guardChecksum,v); guardSamples++;
}
assert.equal(guardSamples,37249); assert.equal(maxGuardHeight,0); assert.equal(maxGuardControl,0); assert.equal(maxGuardRoad,0); assert.equal(maxGuardFoliage,0);

// 257x257 filtered preflight + source LOD chain. No grid coordinate enters the detail phase.
const core=P.normalizedBounds; const lod={}; let preflightSamples=0, maxPreflightTintStep=0, maxPreflightRoughStep=0, previous=null, preflightChecksum=2166136261;
for(let y=0;y<257;y++){
  const ny=core.yMin+(core.yMax-core.yMin)*y/256,row=[];
  for(let x=0;x<257;x++){
    const nx=core.xMin+(core.xMax-core.xMin)*x/256,s=sampleG71NearDetail(nx,ny);
    if(x){maxPreflightTintStep=Math.max(maxPreflightTintStep,tintDelta(s,row[x-1]));maxPreflightRoughStep=Math.max(maxPreflightRoughStep,Math.abs(s.roughness-row[x-1].roughness));}
    if(previous){maxPreflightTintStep=Math.max(maxPreflightTintStep,tintDelta(s,previous[x]));maxPreflightRoughStep=Math.max(maxPreflightRoughStep,Math.abs(s.roughness-previous[x].roughness));}
    for(const v of [s.tintR,s.tintG,s.tintB,s.roughness])preflightChecksum=hash(preflightChecksum,v);row.push(s);preflightSamples++;
  } previous=row;
}
assert.equal(preflightSamples,66049); assert.ok(maxPreflightTintStep<=0.015); assert.ok(maxPreflightRoughStep<=0.05);
for(const size of [257,129,65,33]){let min=1,max=-1,checksum=2166136261;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const nx=core.xMin+(core.xMax-core.xMin)*x/(size-1),ny=core.yMin+(core.yMax-core.yMin)*y/(size-1),v=g71NearDetailSignal(nx,ny);min=Math.min(min,v);max=Math.max(max,v);checksum=hash(checksum,v);}lod[size]={samples:size*size,min:Number(min.toFixed(8)),max:Number(max.toFixed(8)),checksum};assert.ok(min<-.65&&max>.65);}

// Exact G70/G71 Near Detail seam at y=0.125. Same global physical phase must match exactly.
let northPairs=0,maxSignal=0,maxTint=0,maxRough=0,maxHeight=0,maxNormal=0,maxControl=0,maxRoad=0;
for(let i=0;i<=256;i++){
  const nx=core.xMin+(core.xMax-core.xMin)*i/256, ny=core.yMin;
  const s=sampleG71NearDetail(nx,ny), n=sampleG70NearDetail(nx,ny);
  maxSignal=Math.max(maxSignal,Math.abs(s.detailSignal-n.detailSignal));maxTint=Math.max(maxTint,tintDelta(s,n));maxRough=Math.max(maxRough,Math.abs(s.roughness-n.roughness));
  maxHeight=Math.max(maxHeight,Math.abs(s.authoredHeight-n.authoredHeight));maxNormal=Math.max(maxNormal,normalDelta(s.normal,n.normal));maxControl=Math.max(maxControl,Math.abs(s.controlBlend-n.controlBlend));maxRoad=Math.max(maxRoad,Math.abs(s.coverage-n.coverage));northPairs++;
}
assert.equal(northPairs,257); assert.equal(maxSignal,0); assert.equal(maxTint,0); assert.equal(maxRough,0); assert.equal(maxHeight,0); assert.equal(maxNormal,0); assert.equal(maxControl,0); assert.equal(maxRoad,0);
const west=measureG61Hydrology(); assert.equal(west.waterCells,96); assert.equal(west.landCells,0); assert.equal(west.seaCells,96);
for(let i=0;i<=256;i++){const ny=core.yMin+(core.yMax-core.yMin)*i/256;sampleG71NearDetail(1,ny);assert.throws(()=>sampleG71NearDetail(1+1e-6,ny),RangeError);}

const probeA=buildG71Terrain3DNearDetailProbe(), probeB=buildG71Terrain3DNearDetailProbe(); assert.deepEqual(probeA,probeB);
const report={...a,guardSamples,maxGuardHeight,maxGuardControl,maxGuardRoad,maxGuardFoliage,guardChecksum:guardChecksum>>>0,preflightSamples,maxPreflightTintStep,maxPreflightRoughStep,preflightChecksum:preflightChecksum>>>0,lod,northNeighbor:'G70',northPairs,maxSignal,maxTint,maxRough,maxHeight,maxNormal,maxControl,maxRoad,westNeighbor:'G61',eastBoundarySamples:257};
console.log(`G71_NEAR_DETAIL_METRICS=${JSON.stringify(report)}`); console.log('NE_G71_NEAR_DETAIL_VALIDATION_OK');
const emit=process.argv.find(v=>v.startsWith('--emit-probe='));if(emit){const out=path.resolve(ROOT,emit.slice('--emit-probe='.length));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,`${JSON.stringify(probeA)}\n`,'utf8');}
