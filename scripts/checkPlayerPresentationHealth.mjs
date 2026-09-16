import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { buildTraversalTimelineEntry } from '../src/3d/gameplay/playerTraversalPresentationTimeline.js';
import { evaluatePlayerPresentationHealth, isPlayerPresentationHealthy } from '../src/3d/gameplay/playerPresentationHealth.js';

const inputs=[
 {planarSpeedMps:0,traversalWeight:0,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:2.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
 {planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}},
];
let previous=null;const timeline=[];
for(let i=0;i<inputs.length;i+=1){const state=buildPlayerMotionPresentationState(previous,inputs[i]);timeline.push(buildTraversalTimelineEntry(previous?.traversal??null,inputs[i]));const health=evaluatePlayerPresentationHealth(state,previous,timeline);assert.equal(typeof health.healthy,'boolean');assert.ok(health.score>=0&&health.score<=1);previous=state;}
const final=evaluatePlayerPresentationHealth(previous,undefined,timeline);assert.equal(isPlayerPresentationHealthy(final),true);
console.log('player presentation health passed');
