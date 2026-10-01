import assert from 'node:assert/strict';
import {
  resolvePlayerHitboxHurtbox,
  serializePlayerHitboxHurtboxResolution,
} from '../src/3d/gameplay/playerHitboxHurtboxResolution.js';

const input = {
  overlapBudget: 2,
  damageMultiplier: 1.5,
  entries: [
    { id: 'enemy-chest', kind: 'hurtbox', shape: 'capsule', radius: 0.4, height: 1.6, priority: 2 },
    { id: 'sword-edge', kind: 'hitbox', shape: 'box', radius: 0.2, priority: 5 },
    { id: 'disabled', kind: 'hitbox', enabled: false },
  ],
};

const first = resolvePlayerHitboxHurtbox(input);
const second = resolvePlayerHitboxHurtbox(input);
assert.equal(first.counts.hitboxes, 2);
assert.equal(first.counts.hurtboxes, 1);
assert.equal(first.counts.activeHitboxes, 1);
assert.equal(first.counts.activeHurtboxes, 1);
assert.equal(first.counts.resolvedPairs, 1);
assert.equal(first.resolvedPairs[0].damageMultiplier, 1.5);
assert.deepEqual(first, second);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.entries[0]), true);
assert.equal(serializePlayerHitboxHurtboxResolution(first), serializePlayerHitboxHurtboxResolution(second));

const invulnerable = resolvePlayerHitboxHurtbox({ ...input, invulnerable: true });
assert.equal(invulnerable.contactPolicy, 'suppress-damage');
assert.equal(invulnerable.counts.resolvedPairs, 0);
assert.equal(invulnerable.readiness.contactReady, false);

const malformed = resolvePlayerHitboxHurtbox({ entries: [{ kind: 'hurtbox', radius: Infinity, priority: NaN }], overlapBudget: NaN });
assert.equal(malformed.entries[0].radius, 0);
assert.equal(malformed.overlapBudget, 0);
assert.equal(malformed.readiness.finite, true);

console.log('checkPlayerHitboxHurtboxResolution: PASS');
