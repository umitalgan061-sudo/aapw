import assert from 'node:assert/strict';
import {
  PLAYER_COMBAT_IMPACT_OUTCOMES,
  resolvePlayerCombatImpactCue,
  serializePlayerCombatImpactCue,
} from '../src/3d/gameplay/playerCombatImpactCueDirector.js';

const heavy = resolvePlayerCombatImpactCue({
  outcome: 'hit',
  damage: 72,
  poiseDamage: 44,
  comboStep: 3,
  distance: 4.5,
  critical: true,
});
assert.equal(heavy.outcome, 'hit');
assert.equal(heavy.comboStep, 3);
assert.ok(heavy.cues.hitStopMs > 60 && heavy.cues.hitStopMs <= 120);
assert.ok(heavy.cues.cameraImpulse > 0.5 && heavy.cues.cameraImpulse <= 1);
assert.equal(heavy.cues.emitImpact, true);
assert.equal(heavy.cues.emitDefeatBurst, false);

const parry = resolvePlayerCombatImpactCue({ outcome: 'parried', poiseDamage: 30, blockedRatio: 2 });
assert.equal(parry.cues.emitGuardSpark, true);
assert.ok(parry.cues.audioIntensity >= 0.6);

const defeated = resolvePlayerCombatImpactCue({ outcome: 'defeated', damage: 1, airborne: true });
assert.equal(defeated.severity, 1);
assert.equal(defeated.cues.emitDefeatBurst, true);
assert.equal(defeated.cues.vfxIntensity, 0.9);

const malformed = resolvePlayerCombatImpactCue({ outcome: '???', damage: Infinity, poiseDamage: NaN, comboStep: -20, distance: Infinity });
assert.equal(malformed.outcome, 'miss');
assert.equal(malformed.severity, 0);
assert.equal(malformed.comboStep, 0);
assert.equal(malformed.distance, 0);
assert.equal(malformed.cues.hitStopMs, 0);
assert.equal(malformed.cues.emitImpact, false);

assert.equal(PLAYER_COMBAT_IMPACT_OUTCOMES.length, 8);
assert.deepEqual(resolvePlayerCombatImpactCue({ outcome: 'blocked', blockedRatio: 0.5 }), resolvePlayerCombatImpactCue({ outcome: 'blocked', blockedRatio: 0.5 }));
assert.equal(serializePlayerCombatImpactCue(heavy), serializePlayerCombatImpactCue(heavy));
assert.equal(Object.isFrozen(heavy), true);
assert.equal(Object.isFrozen(heavy.cues), true);

console.log('PLAYER_COMBAT_IMPACT_CUE_DIRECTOR_OK');
