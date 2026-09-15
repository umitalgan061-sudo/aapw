import assert from 'node:assert/strict';
import { resolvePlayerMotionPresentation, validatePlayerMotionPresentation } from '../src/3d/gameplay/playerMotionPresentationPolicy.js';
import { isPlayerMotionPresentationDomainTransitionAllowed } from '../src/3d/gameplay/playerMotionPresentationTransitionPolicy.js';
import { resolveTraversalContactPresentation, validateTraversalContactPresentation } from '../src/3d/gameplay/playerTraversalPresentationContactPolicy.js';
import { buildTraversalRecoveryPresentation, isTraversalRecoveryComplete } from '../src/3d/gameplay/playerTraversalPresentationRecoveryPolicy.js';
import { resolveTraversalAudioIntent } from '../src/3d/gameplay/playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent } from '../src/3d/gameplay/playerTraversalPresentationVfxPolicy.js';

const normal=resolvePlayerMotionPresentation(null,{planarSpeedMps:3,traversalWeight:.8,traversalForwardDistance:1.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}});
assert.equal(validatePlayerMotionPresentation(normal).valid,true);
assert.ok(normal.state.channels.confidence>=0&&normal.state.channels.confidence<=1);
assert.equal(isPlayerMotionPresentationDomainTransitionAllowed('locomotion','traversal'),true);
const contact=resolveTraversalContactPresentation(normal.state.traversal);assert.equal(validateTraversalContactPresentation(contact).valid,true);
const recovery=buildTraversalRecoveryPresentation({state:'vault'},{state:'clear'},1);assert.equal(typeof isTraversalRecoveryComplete(recovery),'boolean');
assert.equal(typeof resolveTraversalAudioIntent(normal.state.traversal).cue,'string');
assert.equal(typeof resolveTraversalVfxIntent(normal.state.traversal).effect==='string'||resolveTraversalVfxIntent(normal.state.traversal).effect===null,true);
console.log('player presentation owner handoff smoke check passed');
