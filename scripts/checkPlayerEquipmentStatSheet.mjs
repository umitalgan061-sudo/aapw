import assert from 'node:assert/strict';
import { buildPlayerEquipmentStatSheet, serializePlayerEquipmentStatSheet, digestPlayerEquipmentStatSheet } from '../src/3d/gameplay/playerEquipmentStatSheet.js';

const bow = buildPlayerEquipmentStatSheet({ weapon: 'bow', armor: 'ranger' });
const bowAgain = buildPlayerEquipmentStatSheet({ weapon: 'bow', armor: 'ranger' });
assert.deepEqual(bow, bowAgain);
assert.equal(serializePlayerEquipmentStatSheet(bow), serializePlayerEquipmentStatSheet(bowAgain));
assert.equal(digestPlayerEquipmentStatSheet(bow), digestPlayerEquipmentStatSheet(bowAgain));
assert.equal(bow.capabilities.ranged, true);
assert.equal(bow.capabilities.canParry, false);
assert.equal(bow.materialIntent.sharedValidationRequired, true);
assert.equal(bow.materialIntent.editorRuntimeImportForbidden, true);

const plate = buildPlayerEquipmentStatSheet({ weapon: 'greatsword', armor: 'plate' });
assert.equal(plate.capabilities.melee, true);
assert.equal(plate.capabilities.twoHanded, true);
assert.ok(plate.stats.poiseMax > bow.stats.poiseMax);
assert.ok(plate.stats.mobility < bow.stats.mobility);

const malformed = buildPlayerEquipmentStatSheet({ weapon: { damageMultiplier: Infinity }, armor: { movementMultiplier: NaN } });
for (const value of Object.values(malformed.stats)) assert.equal(Number.isFinite(value), true);
assert.equal(Object.isFrozen(malformed), true);
assert.equal(Object.isFrozen(malformed.stats), true);
console.log('player equipment stat sheet: ok');
