import assert from 'node:assert/strict';
import { resolvePlayerDefenseReactionWindow, validatePlayerDefenseReactionWindow } from '../src/3d/gameplay/playerDefenseReactionWindow.js';

const profile = { mainHand: { reachMultiplier: 1, damageMultiplier: 1, poiseMultiplier: 1 }, armor: { staminaDrainMultiplier: 1 }, shieldEquipped: true };

const parried = resolvePlayerDefenseReactionWindow(profile, {
  nowSeconds: 1.04,
  incoming: { active: true, impactTimeSeconds: 1, distanceMeters: 1.2, reachMeters: 2, damageScale: 1.4 },
  defense: { staminaRatio: 0.8, poiseRatio: 0.9, guardInput: true, parryInput: true, dodgeInvulnerable: false },
});
assert.equal(parried.outcome, 'parried');
assert.equal(parried.damageMultiplier, 0);

const blocked = resolvePlayerDefenseReactionWindow(profile, {
  nowSeconds: 1.18,
  incoming: { active: true, impactTimeSeconds: 1, distanceMeters: 1.2, reachMeters: 2, damageScale: 1.4 },
  defense: { staminaRatio: 0.8, poiseRatio: 0.9, guardInput: true },
});
assert.equal(blocked.outcome, 'blocked');
assert.ok(blocked.damageMultiplier > 0 && blocked.damageMultiplier < 1);

const dodged = resolvePlayerDefenseReactionWindow(profile, {
  nowSeconds: 1.2,
  incoming: { active: true, impactTimeSeconds: 1, distanceMeters: 1.2, reachMeters: 2 },
  defense: { dodgeInvulnerable: true },
});
assert.equal(dodged.outcome, 'dodged');

const missed = resolvePlayerDefenseReactionWindow(profile, {
  nowSeconds: 2,
  incoming: { active: true, impactTimeSeconds: 1, distanceMeters: 1.2, reachMeters: 2 },
  defense: { staminaRatio: 1, poiseRatio: 1 },
});
assert.equal(missed.outcome, 'hit');
assert.equal(missed.reason, 'reaction-window-expired');

const malformed = validatePlayerDefenseReactionWindow({
  equipment: profile,
  nowSeconds: 'bad',
  incoming: { active: true, impactTimeSeconds: Infinity, distanceMeters: NaN },
  defense: { staminaRatio: 'bad', poiseRatio: null },
});
assert.equal(malformed.ok, true);
assert.ok(Object.isFrozen(malformed));
assert.ok(Object.isFrozen(malformed.result));

const reversed = validatePlayerDefenseReactionWindow({
  defense: { guardInput: true, staminaRatio: 0.8, poiseRatio: 0.9 },
  incoming: { reachMeters: 2, distanceMeters: 1.2, impactTimeSeconds: 1, active: true, damageScale: 1.4 },
  nowSeconds: 1.18,
  equipment: profile,
});
assert.equal(malformed.digest, JSON.stringify(malformed.result, Object.keys(malformed.result).sort()));
assert.equal(reversed.result.outcome, 'blocked');
console.log('[checkPlayerDefenseReactionWindow] PASS reaction outcomes, windows, fail-closed normalization, freeze and stable digest');
