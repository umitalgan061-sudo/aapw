import assert from 'node:assert/strict';
import { projectPlayerCombatFeedback, validatePlayerCombatFeedbackProjection } from '../src/3d/gameplay/playerCombatFeedbackProjection.ts';
const hit=projectPlayerCombatFeedback({revision:7,phase:'active',attack:{kind:'light',comboStep:2},movement:{staminaRatio:.62,poiseRatio:.8},outcome:{outcome:'hit',rawAmount:40,appliedAmount:32,blockedAmount:8}});
assert.equal(hit.cue.vfx,'melee-spark'); assert.equal(hit.cue.sfx,'impact-metal'); assert.equal(validatePlayerCombatFeedbackProjection(hit).ok,true);
const parry=projectPlayerCombatFeedback({revision:8,attack:{kind:'heavy',comboStep:1},movement:{staminaRatio:.4,poiseRatio:.3},outcome:{outcome:'parried'}});
assert.equal(parry.cue.vfx,'parry-ring');
const ranged=projectPlayerCombatFeedback({revision:9,equipment:{ranged:true},attack:{kind:'light',ranged:true},outcome:{outcome:'hit',appliedAmount:55}});
assert.equal(ranged.cue.vfx,'projectile-impact'); assert.equal(ranged.ranged,true);
console.log('player combat feedback projection proof: PASS');
