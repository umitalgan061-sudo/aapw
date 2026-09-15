import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { evaluatePlayerMotionQuality, summarizePlayerMotionQuality, comparePlayerMotionQuality } from '../src/3d/gameplay/playerMotionPresentationQuality.js';
const inputs=[
 {planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:2,traversalWeight:.5,traversalForwardDistance:2.5,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
];
let previous=null;const reports=[];const timeline=[];
for(const input of inputs){const state=buildPlayerMotionPresentationState(previous,input);const report=evaluatePlayerMotionQuality(state,previous,timeline);assert.ok(report.score>=0&&report.score<=1);assert.equal(typeof report.valid,'boolean');reports.push(report);previous=state;}
assert.equal(comparePlayerMotionQuality(reports.at(-1),JSON.parse(JSON.stringify(reports.at(-1)))),true);
assert.equal(summarizePlayerMotionQuality(reports.at(-1)).version,'2026-09-15-v1');
console.log('player motion presentation quality passed');
