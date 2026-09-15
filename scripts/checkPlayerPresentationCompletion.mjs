import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { buildPlayerPresentationPacket } from '../src/3d/gameplay/playerMotionPresentationOrchestrator.js';
import { validatePlayerMotionPresentation } from '../src/3d/gameplay/playerMotionPresentationPolicy.js';
import { resolveTraversalContactPresentation } from '../src/3d/gameplay/playerTraversalPresentationContactPolicy.js';
import { buildTraversalRecoveryPresentation } from '../src/3d/gameplay/playerTraversalPresentationRecoveryPolicy.js';

const input={planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}};
const state=buildPlayerMotionPresentationState(null,input);
assert.equal(validatePlayerMotionPresentation({state,contract:state.traversalContract,blend:state.blend??{},projection:{}}).state.valid,true);
const packet=buildPlayerPresentationPacket(null,input);
assert.ok(packet.state&&packet.contract&&packet.blend);
const contact=resolveTraversalContactPresentation(packet.state.traversal);
assert.ok(contact.weight>=0&&contact.weight<=1);
const recovery=buildTraversalRecoveryPresentation(packet.state.traversal,{state:'clear'},1);
assert.equal(typeof recovery.readyForReentry,'boolean');
console.log('player presentation completion smoke check passed');
