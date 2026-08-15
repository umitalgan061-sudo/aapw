#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { G60_TERRAIN3D_ROAD_PATH_POLICY as P, findG60CrossingEdges, sampleG60RoadPath } from '../godot/terrain-authoring/geocells/ne/g60_road_path.mjs';
import { sampleG60RockSnow } from '../godot/terrain-authoring/geocells/ne/g60_rock_snow.mjs';

const N = 257, b = P.normalizedBounds;
let samples = 0, maxHeightDelta = 0, maxControlDelta = 0, maxMaterialDelta = 0;
let maxCoverage = 0, maxNeighborCoverageStep = 0, previous = null, checksum = 2166136261;
const hash = (v) => { let q=Math.round(v*1e6)|0; for(const s of [0,8,16,24]) checksum=Math.imul((checksum^(q>>>s))>>>0,16777619)>>>0; };
for (let y = 0; y < N; y += 1) {
  const ny = b.yMin + (b.yMax - b.yMin) * y / (N - 1), row = [];
  for (let x = 0; x < N; x += 1) {
    const nx = b.xMin + (b.xMax - b.xMin) * x / (N - 1);
    const s = sampleG60RoadPath(nx, ny), prior = sampleG60RockSnow(nx, ny);
    assert.equal(s.body, 'sea'); assert.equal(s.kind, 0);
    maxCoverage = Math.max(maxCoverage, Math.abs(s.coverage), Math.abs(s.roadCoverage), Math.abs(s.pathCoverage));
    maxHeightDelta = Math.max(maxHeightDelta, Math.abs(s.authoredHeight - prior.heightMeters));
    maxControlDelta = Math.max(maxControlDelta, Math.abs(s.roadPathControlBlend - prior.controlBlend));
    maxMaterialDelta = Math.max(maxMaterialDelta,
      Math.abs(s.rockWeight-prior.rockWeight), Math.abs(s.snowWeight-prior.snowWeight),
      ...s.color.map((v,i)=>Math.abs(v-prior.color[i])), Math.abs(s.roughness-prior.roughness));
    if (x) maxNeighborCoverageStep = Math.max(maxNeighborCoverageStep, Math.abs(s.coverage-row[x-1]));
    if (previous) maxNeighborCoverageStep = Math.max(maxNeighborCoverageStep, Math.abs(s.coverage-previous[x]));
    for (const value of [s.authoredHeight,s.coverage,s.roadPathControlBlend,...s.color,s.roughness]) hash(value);
    row.push(s.coverage); samples += 1;
  }
  previous = row;
}
assert.equal(samples, N*N); assert.equal(maxCoverage, 0); assert.equal(maxNeighborCoverageStep, 0);
assert.equal(maxHeightDelta, 0); assert.equal(maxControlDelta, 0); assert.equal(maxMaterialDelta, 0);

// Independent 193x193 owner+guard audit proves the negative route field does not form a cell rim.
const G = 193, guard = P.guardNormalized;
const e = { xMin:b.xMin-guard, xMax:b.xMax+guard, yMin:b.yMin, yMax:b.yMax+guard };
let guardSamples=0, guardMaxCoverage=0, guardMaxHeightError=0;
for(let y=0;y<G;y+=1) for(let x=0;x<G;x+=1){
  const nx=e.xMin+(e.xMax-e.xMin)*x/(G-1), ny=e.yMin+(e.yMax-e.yMin)*y/(G-1);
  const s=sampleG60RoadPath(nx,ny), prior=sampleG60RockSnow(nx,ny);
  guardMaxCoverage=Math.max(guardMaxCoverage,Math.abs(s.coverage),Math.abs(s.roadPathControlBlend));
  guardMaxHeightError=Math.max(guardMaxHeightError,Math.abs(s.authoredHeight-prior.heightMeters)); guardSamples+=1;
}
assert.equal(guardSamples,G*G); assert.equal(guardMaxCoverage,0); assert.equal(guardMaxHeightError,0);

// Segment clipping regression: endpoints can both sit outside while the segment crosses G60.
const syntheticBounds={minX:0,maxX:9000,minY:0,maxY:7000}, metersPerMapUnit=1;
const pt=(nx,ny)=>{const p=normalizedReferenceToWorldXZ(nx,ny,syntheticBounds,metersPerMapUnit);return{x:p.x,y:0,z:p.z};};
const network=(pairs)=>({mapBounds:syntheticBounds,metersPerMapUnit,mainEdges:pairs.map(([a,c],i)=>({fromId:`a${i}`,toId:`b${i}`,points:[pt(...a),pt(...c)]})),footpathEdges:[]});
const crossingCases=[
  [[[0.70,0.06],[0.90,0.06]]],
  [[[0.80,0.18],[0.80,0.00]]],
  [[[0.70,0.00],[0.90,0.00]]],
  [[[b.xMin-guard-0.01,0.10],[b.xMax+guard+0.01,0.10]]],
];
for(const pairs of crossingCases) assert.equal(findG60CrossingEdges(network(pairs)).length,1,'crossing segment escaped guard clipping');
const missCases=[
  [[[0.60,0.06],[b.xMin-guard-0.01,0.06]]],
  [[[0.60,0.20],[0.90,0.20]]],
  [[[b.xMax+guard+0.01,0.02],[0.99,0.02]]],
];
for(const pairs of missCases) assert.equal(findG60CrossingEdges(network(pairs)).length,0,'non-crossing segment falsely entered G60');
const metrics={samples,guardSamples,maxCoverage,maxNeighborCoverageStep,maxHeightDelta,maxControlDelta,maxMaterialDelta,guardMaxCoverage,guardMaxHeightError,intersectionCrossingCases:crossingCases.length,intersectionMissCases:missCases.length,checksum:checksum>>>0};
console.log(`NE_G60_ROAD_PATH_CONTROL_PREFLIGHT=${JSON.stringify(metrics)}`);
console.log('NE_G60_ROAD_PATH_CONTROL_PREFLIGHT_OK');
