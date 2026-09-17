import assert from 'node:assert/strict';
import { buildPlayerEquipmentActionQueue, resolvePlayerEquipmentActionGate, validatePlayerEquipmentActionGateReceipt } from '../src/3d/gameplay/playerEquipmentActionGate.js';

const base = { grounded: true, alive: true, staminaRatio: 0.8, animationInterruptible: true, combatState: 'neutral', currentSlot: 'mainHand' };
const requestSet = [
  { action: 'swap', targetSlot: 'offHand' },
  { action: 'draw', targetSlot: 'back' },
  { action: 'swap', targetSlot: 'offHand' },
];

function run() {
  const accepted = resolvePlayerEquipmentActionGate(base, { action: 'equip', targetSlot: 'offHand' });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.action, 'swap');
  assert.equal(validatePlayerEquipmentActionGateReceipt(accepted).ok, true);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(Object.isFrozen(accepted.state), true);

  const blocked = resolvePlayerEquipmentActionGate({ ...base, combatState: 'heavy-attack' }, { action: 'swap', targetSlot: 'offHand' });
  assert.equal(blocked.accepted, false);
  assert.ok(blocked.reasons.includes('combat-state-blocked'));

  const soft = resolvePlayerEquipmentActionGate({ ...base, combatState: 'guard' }, { action: 'swap', targetSlot: 'offHand' });
  assert.equal(soft.accepted, false);
  const softAllowed = resolvePlayerEquipmentActionGate({ ...base, combatState: 'guard' }, { action: 'swap', targetSlot: 'offHand', allowSoftInterrupt: true });
  assert.equal(softAllowed.accepted, true);

  const queue = buildPlayerEquipmentActionQueue(base, requestSet);
  assert.equal(queue.accepted.length, 2);
  assert.equal(queue.rejected[0].reason, 'duplicate-slot-request');
  assert.equal(queue.nextAction.targetSlot, 'offHand');
  assert.equal(queue.totalDurationSeconds, 0.72);
  assert.equal(Object.isFrozen(queue), true);

  const runA = JSON.stringify(buildPlayerEquipmentActionQueue(base, requestSet));
  const runB = JSON.stringify(buildPlayerEquipmentActionQueue(base, requestSet));
  assert.equal(runA, runB);

  const dead = resolvePlayerEquipmentActionGate({ ...base, alive: false }, { action: 'holster', targetSlot: 'mainHand' });
  assert.equal(dead.accepted, false);
  assert.ok(dead.reasons.includes('not-alive'));

  const invalid = validatePlayerEquipmentActionGateReceipt({ accepted: true, reasons: [] });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes('accepted-without-transition'));

  console.log('Kızıl Ufuk equipment action gate proof passed');
}

run();
