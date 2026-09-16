import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState, createPlayerMotionPresentationController, projectPlayerMotionPresentationState, validatePlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { createPlayerMotionPresentationRecorder, compareMotionPresentationRecordStreams, summarizeMotionPresentationRecording } from '../src/3d/gameplay/playerMotionPresentationRecorder.js';

const inputs=[
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,deltaSeconds:1/60,traversalWeight:0},
 {velocity:{x:0.2,y:1},facing:{x:0,y:1},planarSpeedMps:2,deltaSeconds:1/60,traversalWeight:.3,traversalForwardDistance:4},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:3,deltaSeconds:1/60,traversalWeight:.7,traversalForwardDistance:2.2},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:4,deltaSeconds:1/60,traversalWeight:.9,traversalForwardDistance:1.2},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,deltaSeconds:1/60,traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1},
 {velocity:{x:0,y:1},facing:{x:0,y:1},planarSpeedMps:0,deltaSeconds:1/60,traversalWeight:0},
];
const one=createPlayerMotionPresentationController();
const two=createPlayerMotionPresentationController();
const recorderA=createPlayerMotionPresentationRecorder();
const recorderB=createPlayerMotionPresentationRecorder();
for(const input of inputs){
 const a=one.update(input); const b=two.update(input);
 assert.equal(validatePlayerMotionPresentationState(a.state).valid,true);
 assert.equal(validatePlayerMotionPresentationState(b.state).valid,true);
 assert.equal(JSON.stringify(a.state),JSON.stringify(b.state));
 assert.equal(projectPlayerMotionPresentationState(a.state).animation.domain,a.state.domain);
 recorderA.record(a.state,a.tickIndex/60); recorderB.record(b.state,b.tickIndex/60);
}
const recordsA=recorderA.exportRecords(); const recordsB=recorderB.exportRecords();
assert.equal(compareMotionPresentationRecordStreams(recordsA,recordsB),true);
assert.equal(summarizeMotionPresentationRecording(recordsA).entries,inputs.length);
console.log('player motion presentation composite passed');
