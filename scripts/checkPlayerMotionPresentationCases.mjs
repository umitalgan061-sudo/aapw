import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { PLAYER_MOTION_PRESENTATION_CASES } from '../src/3d/gameplay/fixtures/playerMotionPresentationCases.js';
for(const fixture of PLAYER_MOTION_PRESENTATION_CASES){
 const state=buildPlayerMotionPresentationState(null,fixture.input);
 assert.equal(state.domain,fixture.domain,fixture.id);
 assert.ok(state.channels.traversal>=0&&state.channels.traversal<=1,fixture.id);
 assert.ok(state.channels.confidence>=0&&state.channels.confidence<=1,fixture.id);
}
console.log(`composite player motion cases passed: ${PLAYER_MOTION_PRESENTATION_CASES.length}`);
