import assert from 'node:assert/strict';
import { resolvePlayerCombatFeedbackRoute, isPlayerCombatFeedbackRoute } from '../src/3d/gameplay/playerCombatFeedbackRoute.ts';

const hit = resolvePlayerCombatFeedbackRoute({ outcome: 'hit', severity: 0.8, poiseAfter: 42, cameraImpulse: 0.3, impactDirection: { x: 2, z: -0.5 } });
assert.equal(hit.family, 'hit');
assert.equal(hit.vfx, 'impact-hit');
assert.equal(hit.sfx, 'combat-hit');
assert.deepEqual(hit, resolvePlayerCombatFeedbackRoute({ outcome: 'hit', severity: 0.8, poiseAfter: 42, cameraImpulse: 0.3, impactDirection: { x: 2, z: -0.5 } }));
assert.equal(hit.impactDirection.x, 1);
assert.equal(Object.isFrozen(hit), true);
assert.equal(Object.isFrozen(hit.impactDirection), true);
assert.equal(isPlayerCombatFeedbackRoute(hit), true);

const parry = resolvePlayerCombatFeedbackRoute({ outcome: 'parried', severity: 2, poiseAfter: -10, cameraImpulse: 2 });
assert.equal(parry.family, 'parry');
assert.equal(parry.haptic, 'heavy');
assert.equal(parry.poiseAfter, 0);

const guardBreak = resolvePlayerCombatFeedbackRoute({ outcome: 'guard-break', severity: 0.4 });
assert.equal(guardBreak.family, 'stagger');
assert.equal(guardBreak.sfx, 'combat-guard-break');

assert.equal(isPlayerCombatFeedbackRoute({ ...hit, replayKey: 'tampered' }), true);
console.log('player combat feedback route proof: PASS');
