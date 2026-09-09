import assert from 'node:assert/strict';
import { resolvePlayerCombatHitStop, serializePlayerCombatHitStop } from '../src/3d/gameplay/playerCombatHitStopDirector.js';

const sample = { outcome: 'critical-hit', impact: 1, damage: 120, poiseDamage: 40, targetDefeated: true, attackerFacing: 1, distance: 2, actor: 'player' };
const first = resolvePlayerCombatHitStop(sample);
const second = resolvePlayerCombatHitStop(sample);
assert.deepEqual(first, second);
assert.equal(first.outcome, 'critical-hit');
assert.equal(first.feedbackTier, 'defeat');
assert.ok(first.durationMs > 0 && first.durationMs <= 140);
assert.ok(first.timeScale >= 0.78 && first.timeScale <= 1);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.audio), true);
assert.equal(serializePlayerCombatHitStop(sample), serializePlayerCombatHitStop(sample));

const blocked = resolvePlayerCombatHitStop({ outcome: 'blocked', impact: 0.6, distance: 1 });
assert.equal(blocked.audio.accent, 'blocked');
assert.equal(blocked.vfx.sparks, true);

const malformed = resolvePlayerCombatHitStop({ outcome: '???', impact: NaN, damage: Infinity, poiseDamage: -4, distance: -2 });
assert.equal(malformed.outcome, 'miss');
assert.equal(malformed.accepted, false);
assert.equal(malformed.durationMs, 0);
assert.equal(malformed.safety.finite, true);

console.log('playerCombatHitStopDirector: OK');
