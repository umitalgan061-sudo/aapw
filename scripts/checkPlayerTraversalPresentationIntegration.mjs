import assert from 'node:assert/strict';
import { buildPlayerTraversalPresentationState } from '../src/3d/gameplay/playerTraversalPresentationPolicy.js';
import { createPlayerTraversalPresentationContract, toAnimationTraversalSignal, toAudioTraversalSignal, toVfxTraversalSignal } from '../src/3d/gameplay/playerTraversalPresentationContract.js';
import { buildPlayerTraversalConsumerPacket, createTraversalConsumerSnapshot } from '../src/3d/gameplay/playerTraversalPresentationBridge.js';
import { createTraversalPresentationTelemetry } from '../src/3d/gameplay/playerTraversalPresentationTelemetry.js';
import { validateTraversalPresentationQuality } from '../src/3d/gameplay/playerTraversalPresentationQuality.js';
import { createPlayerTraversalPresentationRuntime } from '../src/3d/gameplay/playerTraversalPresentationRuntime.js';

const runtime=createPlayerTraversalPresentationRuntime({audio:true,vfx:true,debug:true});
const inputs=[
 {traversalWeight:.2,traversalForwardDistance:5,clockSeconds:.1},
 {traversalWeight:.7,traversalForwardDistance:2.4,clockSeconds:.2},
 {traversalWeight:.9,traversalForwardDistance:1.2,clockSeconds:.3},
 {traversalWeight:.2,landingImpactMps:2,elapsedSeconds:.1,clockSeconds:.5},
 {traversalWeight:0,clockSeconds:.7},
];
const telemetry=createTraversalPresentationTelemetry();
let previous=null;
for(const input of inputs){
 const result=runtime.tick(input);
 telemetry.observe(result.state);
 const contract=createPlayerTraversalPresentationContract(result.state);
 assert.equal(contract.state,result.state.state);
 assert.equal(typeof toAnimationTraversalSignal(contract).locomotionState,'string');
 assert.equal(typeof toAudioTraversalSignal(contract).cue,'string');
 assert.equal(typeof toVfxTraversalSignal(contract).cue,'string');
 const packet=buildPlayerTraversalConsumerPacket(result.state);
 assert.equal(packet.valid,true);
 assert.equal(typeof createTraversalConsumerSnapshot(packet).state,'string');
 const quality=validateTraversalPresentationQuality(result.state,previous);
 assert.ok(quality.score>=0&&quality.score<=1);
 previous=result.state;
}
assert.equal(telemetry.snapshot().samples,inputs.length);
assert.equal(runtime.snapshot().tickIndex,inputs.length);
console.log('traversal presentation integration passed');
