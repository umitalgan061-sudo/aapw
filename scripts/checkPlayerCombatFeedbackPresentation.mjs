import assert from 'node:assert/strict';
import { buildCombatFeedbackVfxCue, resolveCombatFeedbackCue } from '../src/3d/gameplay/playerCombatFeedbackPresentation.js';

const hit = resolveCombatFeedbackCue({ outcome: 'hit', appliedAmount: 30, stamina: 72, poise: 40, serial: 4, position: { x: 1, y: 2, z: 3 } });
assert.equal(hit.cue, 'impact');
assert.equal(hit.serial, 4);
assert.equal(hit.position.x, 1);
assert(hit.intensity > 0 && hit.intensity < 1);

const blocked = buildCombatFeedbackVfxCue({ outcome: 'blocked', blockedAmount: 50, stamina: 0, poise: 100 });
assert.equal(blocked.cue, 'guard-impact');
assert.equal(blocked.staminaRatio, 0);
assert(blocked.flashStrength >= 0.18 && blocked.flashStrength <= 0.9);
assert(blocked.shakeMeters <= 0.045);

const invalid = resolveCombatFeedbackCue({ outcome: 'unknown', appliedAmount: NaN, position: { x: Infinity } });
assert.equal(invalid.cue, 'none');
assert.equal(invalid.intensity, 0);
assert.equal(invalid.position.x, 0);

console.log('PLAYER_COMBAT_FEEDBACK_PRESENTATION_OK');
