import assert from 'node:assert/strict';
import { buildPlayerMotionPresentationState } from '../src/3d/gameplay/playerMotionPresentationState.js';
import { buildTraversalConsumerSemantics, validateTraversalConsumerSemantics } from '../src/3d/gameplay/playerTraversalPresentationConsumerSemantics.js';
import { applyTraversalSurfacePresentation, isTraversalSurfaceKnown, listTraversalSurfaceProfiles } from '../src/3d/gameplay/playerTraversalPresentationSurfacePolicy.js';
import { resolveTraversalContactPresentation, resolveTraversalContactAnimationEmphasis } from '../src/3d/gameplay/playerTraversalPresentationContactPolicy.js';
import { resolveTraversalAudioIntent } from '../src/3d/gameplay/playerTraversalPresentationAudioPolicy.js';
import { resolveTraversalVfxIntent } from '../src/3d/gameplay/playerTraversalPresentationVfxPolicy.js';

const surfaces=listTraversalSurfaceProfiles();
assert.ok(surfaces.length>=7);
for(const surface of surfaces){
  assert.equal(isTraversalSurfaceKnown(surface),true);
  const state=buildPlayerMotionPresentationState(null,{planarSpeedMps:4,traversalWeight:.9,traversalForwardDistance:1.2,deltaSeconds:1/60,velocity:{x:0,y:1},facing:{x:0,y:1}});
  const adapted=applyTraversalSurfacePresentation(state.traversal,surface);
  const semantics=buildTraversalConsumerSemantics(adapted);
  assert.equal(validateTraversalConsumerSemantics(semantics).valid,true,surface);
  assert.ok(semantics.surface.grip>=0&&semantics.surface.grip<=1);
  assert.ok(semantics.audio.intensity>=0&&semantics.audio.intensity<=1);
  assert.ok(semantics.vfx.weight>=0&&semantics.vfx.weight<=1);
  assert.ok(resolveTraversalContactAnimationEmphasis(resolveTraversalContactPresentation(adapted)).footPlant<=1);
  assert.equal(typeof resolveTraversalAudioIntent(adapted).cue,'string');
  assert.equal(typeof resolveTraversalVfxIntent(adapted).effect==='string'||resolveTraversalVfxIntent(adapted).effect===null,true);
}
const unknown=applyTraversalSurfacePresentation(buildPlayerMotionPresentationState(null,{traversalWeight:.8,traversalForwardDistance:1.3}).traversal,'nonexistent');
assert.equal(unknown.surfaceId,'nonexistent');
console.log(`surface presentation matrix passed: ${surfaces.length} profiles + unknown fallback`);
