import assert from 'node:assert/strict';
import { resolvePlayerCombatHitboxHurtbox, stableSerializePlayerCombatHitboxHurtbox } from '../src/3d/gameplay/playerCombatHitboxHurtboxDirector.js';

const input = {
  action: 'light',
  origin: { x: 0, y: 0, z: 0 },
  hitboxes: [{ id: 'blade', kind: 'hitbox', center: { x: 0, y: 1, z: 1 }, radius: 0.8, halfHeight: 0.7 }],
  hurtboxes: [
    { id: 'wolf-core', kind: 'hurtbox', center: { x: 0.2, y: 1, z: 1.4 }, radius: 0.6, halfHeight: 0.8 },
    { id: 'far', kind: 'hurtbox', center: { x: 0, y: 1, z: 5 }, radius: 0.4, halfHeight: 0.4 },
  ],
};

const first = resolvePlayerCombatHitboxHurtbox(input);
const second = resolvePlayerCombatHitboxHurtbox(input);
assert.deepEqual(first, second, 'resolution must be deterministic');
assert.equal(first.contactCount, 1, 'only overlapping hurtbox should contact');
assert.equal(first.contacts[0].hurtboxId, 'wolf-core');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.contacts), true);
assert.equal(stableSerializePlayerCombatHitboxHurtbox(first), stableSerializePlayerCombatHitboxHurtbox(second));

const disabled = resolvePlayerCombatHitboxHurtbox({ ...input, hitboxes: [{ ...input.hitboxes[0], enabled: false }] });
assert.equal(disabled.active, false);
assert.equal(disabled.contactCount, 0);

const malformed = resolvePlayerCombatHitboxHurtbox({ action: 'unknown', hitboxes: null, hurtboxes: null, origin: { x: NaN, y: Infinity, z: 'bad' } });
assert.equal(malformed.action, 'light');
assert.equal(malformed.failClosed, true);
assert.equal(Number.isFinite(malformed.origin.x), true);
assert.equal(Number.isFinite(malformed.origin.y), true);
assert.equal(Number.isFinite(malformed.origin.z), true);

console.log('[checkPlayerCombatHitboxHurtboxDirector] PASS');
