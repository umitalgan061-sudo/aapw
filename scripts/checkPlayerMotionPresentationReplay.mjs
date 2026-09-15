import assert from 'node:assert/strict';
import { replayPlayerMotionInputs, comparePlayerMotionReplays, replayEquivalence } from '../src/3d/gameplay/playerMotionPresentationReplay.js';
const inputs=[
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60},
 {velocity:{x:.2,y:1},facing:{x:0,y:1},planarSpeedMps:2,traversalWeight:.3,traversalForwardDistance:4,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:2,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1,deltaSeconds:1/60},
];
const a=replayPlayerMotionInputs(inputs);const b=replayPlayerMotionInputs(inputs);
assert.equal(comparePlayerMotionReplays(a,b),true);
const report=replayEquivalence(inputs);assert.equal(report.equivalent,true);assert.equal(report.sameFinal,true);assert.equal(report.validation.valid,true);
console.log('player motion presentation replay passed');
