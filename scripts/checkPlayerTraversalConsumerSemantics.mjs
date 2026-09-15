import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { buildTraversalConsumerSemantics, validateTraversalConsumerSemantics, compareTraversalConsumerSemantics, summarizeTraversalConsumerSemantics } from '../src/3d/gameplay/playerTraversalPresentationConsumerSemantics.js';
const cues=[
 {traversalWeight:0},
 {traversalWeight:.4,traversalForwardDistance:4},
 {traversalWeight:.8,traversalForwardDistance:2.4},
 {traversalWeight:.9,traversalForwardDistance:1.2},
 {traversalWeight:.9,traversalForwardDistance:1.2,grounded:false,traversalHeight:1.2},
 {traversalWeight:.9,traversalForwardDistance:1.2,grounded:false,traversalHeight:-1},
 {traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1},
 {traversalWeight:.8,traversalBlocked:true},
 {traversalWeight:.8,cancelRequested:true},
];
for(const cue of cues){
 const presentation=buildPlayerTraversalPresentationState(null,cue);
 const first=buildTraversalConsumerSemantics(presentation);
 const second=buildTraversalConsumerSemantics(presentation);
 assert.equal(validateTraversalConsumerSemantics(first).valid,true);
 assert.equal(compareTraversalConsumerSemantics(first,second),true);
 const summary=summarizeTraversalConsumerSemantics(first);
 assert.equal(typeof summary.state,'string');
 assert.ok(first.audio.intensity>=0&&first.audio.intensity<=1);
 assert.ok(first.vfx.weight>=0&&first.vfx.weight<=1);
 assert.ok(first.contact.weight>=0&&first.contact.weight<=1);
}
console.log(`traversal consumer semantics passed: ${cues.length}`);
