import assert from 'node:assert/strict';

const moduleUrl = new URL('../src/3d/gameplay/playerEquipmentIntegrityReceipt.ts', import.meta.url);
const { resolvePlayerEquipmentIntegrityReceipt, isPlayerEquipmentIntegrityReceipt } = await import(moduleUrl);

const readyInput = {
  head: { id: 'helm-01' },
  chest: { id: 'mail-01', materialSurfaces: ['metal', 'cloth'] },
  back: { id: 'bow-01' },
  mainHand: { id: 'bow-01', projectile: true, damageMultiplier: 1.2, materialSurfaces: ['wood', 'weapon'] },
  offHand: { id: '' },
  ranged: true,
  twoHanded: true,
  shieldEquipped: false,
  armor: { movementMultiplier: 1 },
};

const ready = resolvePlayerEquipmentIntegrityReceipt(readyInput);
assert.equal(ready.status, 'ready');
assert.equal(ready.ready, true);
assert.equal(isPlayerEquipmentIntegrityReceipt(ready), true);
assert.deepEqual(ready.materialSurfaces, ['cloth', 'metal', 'weapon']);

const degraded = resolvePlayerEquipmentIntegrityReceipt({ mainHand: { id: 'sword', damageMultiplier: 1 }, armor: { movementMultiplier: 1 } });
assert.equal(degraded.status, 'degraded');
assert.ok(degraded.warnings.includes('no-named-material-surfaces'));

const invalid = resolvePlayerEquipmentIntegrityReceipt({
  mainHand: { id: 'greatsword', damageMultiplier: 1 },
  offHand: { id: 'shield' },
  twoHanded: true,
  armor: { movementMultiplier: 1 },
});
assert.equal(invalid.status, 'invalid');
assert.ok(invalid.errors.includes('two-handed-offhand-conflict'));

const reordered = resolvePlayerEquipmentIntegrityReceipt({
  mainHand: { id: 'bow-01', projectile: true, damageMultiplier: 1.2, materialSurfaces: ['weapon', 'wood'] },
  chest: { id: 'mail-01', materialSurfaces: ['cloth', 'metal'] },
  back: { id: 'bow-01' },
  ranged: true,
  twoHanded: true,
  armor: { movementMultiplier: 1 },
});
assert.equal(reordered.receiptKey, ready.receiptKey);
assert.throws(() => { ready.errors.push('tampered'); }, TypeError);
console.log('player equipment integrity receipt proof: ok');
