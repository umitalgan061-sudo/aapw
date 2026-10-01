import assert from 'node:assert/strict';
import {
  buildPlayerAnimationEquipmentSyncSnapshot,
  serializePlayerAnimationEquipmentSyncSnapshot,
  validatePlayerAnimationEquipmentSyncSnapshot,
} from '../src/3d/gameplay/playerAnimationEquipmentSyncDirector.js';

const input = {
  locomotion: 'sprint',
  combatPhase: 'attack',
  upperBodyLock: false,
  crossFadeSeconds: 0.5,
  layers: [
    { id: 'locomotion-a', family: 'locomotion', clip: 'sprint', weight: 0.8, priority: 10 },
    { id: 'locomotion-b', family: 'locomotion', clip: 'run', weight: 0.9, priority: 10 },
    { id: 'attack', family: 'upperBody', clip: 'light-1', weight: 1.2, priority: 80 },
    { id: 'guard', family: 'defense', clip: 'guard', weight: 1, priority: 60, enabled: false },
  ],
  equipment: [
    { id: 'sword-b', slot: 'mainHand', weight: 12, weaponClass: 'sword', ready: true },
    { id: 'sword-a', slot: 'mainHand', weight: 10, weaponClass: 'sword', ready: true },
    { id: 'shield', slot: 'offHand', weight: 8, weaponClass: 'shield', ready: true },
  ],
};

const first = buildPlayerAnimationEquipmentSyncSnapshot(input);
const second = buildPlayerAnimationEquipmentSyncSnapshot(input);
assert.deepEqual(first, second);
assert.equal(first.animation.dominantClip, 'light-1');
assert.equal(first.animation.upperBodyLock, true);
assert.equal(first.animation.crossFadeSeconds, 0.35);
assert.equal(first.equipment.equipped.length, 2);
assert.deepEqual(first.equipment.rejectedItemIds, ['sword-b']);
assert.equal(first.equipment.sockets[0].socket, 'mixamorigLeftHand');
assert.equal(first.equipment.sockets[1].poseFamily, 'melee');
assert.equal(first.readiness.duplicateSocketCount, 1);
assert.equal(first.readiness.animationReady, true);
assert.equal(first.handoff.editorRuntimeImportForbidden, true);
assert.equal(validatePlayerAnimationEquipmentSyncSnapshot(first).valid, true);
assert.throws(() => { first.animation.layers.push({}); }, TypeError);
assert.equal(serializePlayerAnimationEquipmentSyncSnapshot(first), serializePlayerAnimationEquipmentSyncSnapshot(second));

const malformed = buildPlayerAnimationEquipmentSyncSnapshot({ layers: [{ weight: Number.NaN }], equipment: [{ weight: Number.POSITIVE_INFINITY }] });
assert.equal(validatePlayerAnimationEquipmentSyncSnapshot(malformed).valid, true);
assert.equal(malformed.equipment.encumbrance, 0);
console.log(JSON.stringify({ checks: 14, version: first.version, rejected: first.equipment.rejectedItemIds, digest: serializePlayerAnimationEquipmentSyncSnapshot(first).length }));
