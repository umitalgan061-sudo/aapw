import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { diagnosePlayerMotionPresentation, summarizePlayerMotionDiagnostics } from '../src/3d/gameplay/playerMotionPresentationDiagnostics.js';
const inputs=[
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:2,traversalWeight:.4,traversalForwardDistance:4,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:2,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1,deltaSeconds:1/60},
];
let previous=null;const reports=[];
for(const input of inputs){const state=buildPlayerMotionPresentationState(previous,input);const report=diagnosePlayerMotionPresentation(state,previous);reports.push(report);assert.equal(typeof report.healthy,'boolean');previous=state;}
assert.equal(summarizePlayerMotionDiagnostics(reports).reports,inputs.length);
console.log('player motion presentation diagnostics passed');
