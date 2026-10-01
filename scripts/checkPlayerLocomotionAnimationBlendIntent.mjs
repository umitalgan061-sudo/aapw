import assert from 'node:assert/strict';
import { createPlayerLocomotionAnimationBlendIntent, isPlayerLocomotionAnimationBlendIntent } from '../src/3d/gameplay/playerLocomotionAnimationBlendIntent.ts';

const idle = createPlayerLocomotionAnimationBlendIntent();
assert.equal(idle.locomotion, 'idle');
assert.equal(idle.primaryClip, 'locomotion.idle');
assert.equal(idle.direction, 'none');
assert.ok(Object.isFrozen(idle));

const combat = createPlayerLocomotionAnimationBlendIntent({ moveX: 0.8, moveY: 0.1, speed: 0.9, grounded: true, sprinting: true, combatMode: true, attackBusy: true });
assert.equal(combat.locomotion, 'sprint');
assert.equal(combat.direction, 'strafe-right');
assert.equal(combat.secondaryClip, 'combat.ready');
assert.equal(combat.combatLayerWeight, 1);
assert.ok(isPlayerLocomotionAnimationBlendIntent(combat));

const airborne = createPlayerLocomotionAnimationBlendIntent({ grounded: false, speed: 0.7, combatMode: true });
assert.equal(airborne.locomotion, 'airborne');
assert.equal(airborne.primaryClip, 'locomotion.airborne');

const stagger = createPlayerLocomotionAnimationBlendIntent({ grounded: true, speed: 0.5, hitStaggered: true });
assert.equal(stagger.locomotion, 'stagger');
assert.equal(stagger.primaryClip, 'combat.stagger');

const replayA = createPlayerLocomotionAnimationBlendIntent({ moveX: 0.2, moveY: 0.7, speed: 0.4, combatMode: true });
const replayB = createPlayerLocomotionAnimationBlendIntent({ moveX: 0.2, moveY: 0.7, speed: 0.4, combatMode: true });
assert.deepEqual(replayA, replayB);
assert.equal(isPlayerLocomotionAnimationBlendIntent({ ...replayA, blendKey: 'tampered' }), false);
console.log('[checkPlayerLocomotionAnimationBlendIntent] PASS locomotion state, directional blend, combat layer, airborne/stagger gates, deterministic replay, freeze and shape validation');
