import assert from 'node:assert/strict';
import { createRangedChargeState } from '../src/3d/gameplay/playerRangedChargeDirector.js';

const bow = { family: 'archery', ranged: true, projectile: true };
const base = { equipment: bow, stamina: 100 };

const early = createRangedChargeState({ ...base, charging: true, elapsedSeconds: 0.4 });
assert.equal(early.accepted, true);
assert.equal(early.charging, true);
assert.equal(early.release, false);
assert.ok(early.progress > 0 && early.progress < 1);
assert.ok(early.spreadDegrees > 0);

const full = createRangedChargeState({ ...base, released: true, elapsedSeconds: 1.15 });
assert.equal(full.accepted, true);
assert.equal(full.release, true);
assert.equal(full.fullCharge, true);
assert.equal(full.staminaCost, 10);
assert.ok(full.damageMultiplier > early.damageMultiplier);
assert.ok(full.projectileSpeedMultiplier > early.projectileSpeedMultiplier);
assert.ok(full.spreadDegrees < early.spreadDegrees);

const tooEarly = createRangedChargeState({ ...base, released: true, elapsedSeconds: 0.01 });
assert.equal(tooEarly.accepted, false);
assert.equal(tooEarly.rejectedReason, 'release-too-early');

const melee = createRangedChargeState({ equipment: { family: 'sword' }, stamina: 100, charging: true, elapsedSeconds: 0.4 });
assert.equal(melee.accepted, false);
assert.equal(melee.rejectedReason, 'not-ranged');

const exhausted = createRangedChargeState({ ...base, stamina: 3, charging: true, elapsedSeconds: 0.4 });
assert.equal(exhausted.accepted, false);
assert.equal(exhausted.rejectedReason, 'insufficient-stamina');

const malformed = createRangedChargeState({ equipment: bow, stamina: 'bad', charging: true, elapsedSeconds: 'bad' });
assert.equal(malformed.accepted, true);
assert.equal(malformed.progress, 0);
assert.ok(Number.isFinite(malformed.damageMultiplier));

const first = JSON.stringify(createRangedChargeState({ ...base, released: true, elapsedSeconds: 0.9 }));
const second = JSON.stringify(createRangedChargeState({ ...base, released: true, elapsedSeconds: 0.9 }));
assert.equal(first, second);

console.log('PLAYER_RANGED_CHARGE_DIRECTOR_OK');
