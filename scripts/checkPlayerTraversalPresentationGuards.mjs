import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { guardTraversalPresentationState, enforceTraversalConsumerSafety, guardTraversalReplayRecord } from '../src/3d/gameplay/playerTraversalPresentationGuards.js';
import { buildPlayerTraversalConsumerPacket } from '../src/3d/gameplay/playerTraversalPresentationBridge.js';

const inputs=[
 {traversalWeight:0},
 {traversalWeight:.2,traversalForwardDistance:5},
 {traversalWeight:.7,traversalForwardDistance:2.4},
 {traversalWeight:.9,traversalForwardDistance:1.2},
 {traversalWeight:.9,traversalForwardDistance:1.2,grounded:false,traversalHeight:1.2},
 {traversalWeight:.9,traversalForwardDistance:1.2,grounded:false,traversalHeight:-1},
 {traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1},
 {traversalWeight:.8,traversalBlocked:true},
 {traversalWeight:.8,cancelRequested:true},
];
let previous=null;
for(const input of inputs){
 const state=buildPlayerTraversalPresentationState(previous,input);
 const guard=guardTraversalPresentationState(state,previous);
 assert.equal(typeof guard.safe,'boolean');
 const packet=buildPlayerTraversalConsumerPacket(state);
 const safe=enforceTraversalConsumerSafety(packet);
 assert.ok(safe.animation===null||safe.animation.weight<=1);
 assert.ok(safe.audio===null||safe.audio.intensity<=1);
 assert.equal(guardTraversalReplayRecord({state:state.state,phase:state.phase,event:state.event,confidence:state.confidence,clockSeconds:0}).valid,true);
 previous=state;
}
console.log('traversal presentation safety guards passed');
