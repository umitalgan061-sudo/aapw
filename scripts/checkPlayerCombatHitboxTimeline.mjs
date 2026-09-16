import assert from 'node:assert/strict';
import { createPlayerCombatHitboxTimeline, validatePlayerCombatHitboxTimeline } from '../src/3d/gameplay/playerCombatHitboxTimeline.js';

const profile = {
  mainHand: { id: 'iron-sword', damageMultiplier: 1, reachMultiplier: 1, poiseMultiplier: 1, projectile: false },
  armor: { staminaDrainMultiplier: 1, poiseBonus: 0, movementMultiplier: 1, dodgeDistanceMultiplier: 1 },
  shieldEquipped: false,
  ranged: false,
  twoHanded: false,
};

const timeline = createPlayerCombatHitboxTimeline(profile, { historyLimit: 3 });
const windup = timeline.snapshot({ progress: 0.05, kind: 'light', targetPresent: true });
const active = timeline.snapshot({ progress: 0.42, kind: 'light', targetPresent: true });
const miss = timeline.snapshot({ progress: 0.42, kind: 'light', targetPresent: false });
const defeated = timeline.snapshot({ progress: 0.42, kind: 'light', defeated: true });

assert.equal(windup.phase, 'windup');
assert.equal(windup.hitboxActive, false);
assert.equal(active.phase, 'active');
assert.equal(active.canConfirmHit, true);
assert.equal(miss.hitboxActive, false);
assert.equal(defeated.hurtboxActive, false);
assert.equal(timeline.getHistory().length, 3);
assert.deepEqual(timeline.snapshot({ progress: 0.42, kind: 'light' }), timeline.snapshot({ progress: 0.42, kind: 'light' }));

timeline.dispose();
const disposed = timeline.snapshot({ progress: 0.42, kind: 'light' });
assert.equal(disposed.disposed, true);
assert.equal(disposed.canConfirmHit, false);

const validation = validatePlayerCombatHitboxTimeline({ profile, kind: 'light' });
assert.equal(validation.ok, true, validation.errors.join(', '));
console.log('[checkPlayerCombatHitboxTimeline] PASS deterministic windows, target gating, defeated gating, bounded history and disposal');
