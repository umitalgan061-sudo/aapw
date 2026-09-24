import assert from 'node:assert/strict';
import { createPlayerCombatAcceptanceReceipt, isPlayerCombatAcceptanceReceipt } from '../src/3d/gameplay/playerCombatAcceptance.ts';

const frame = {
  version: 1,
  revision: 4,
  phase: 'active',
  attack: { kind: 'heavy' },
  movement: { state: 'attack-heavy', grounded: true, staminaRatio: 0.72, poiseRatio: 0.84 },
  animation: { action: 'heavy', family: 'greatsword' },
  equipment: { mainHandId: 'iron-greatsword', offHandId: 'none', chestId: 'mail', headId: 'helm' },
  sockets: { mainHand: { attached: true } },
};

const receipt = createPlayerCombatAcceptanceReceipt(frame, { expectedPhase: 'active' });
assert.equal(receipt.passed, true);
assert.deepEqual(receipt.failedStages, []);
assert.ok(isPlayerCombatAcceptanceReceipt(receipt));
assert.ok(Object.isFrozen(receipt));
assert.ok(Object.isFrozen(receipt.checks));

const replay = createPlayerCombatAcceptanceReceipt({ ...frame, equipment: { ...frame.equipment } }, { expectedPhase: 'active' });
assert.equal(replay.acceptanceKey, receipt.acceptanceKey);

const airborne = createPlayerCombatAcceptanceReceipt({ ...frame, movement: { ...frame.movement, grounded: false } });
assert.equal(airborne.passed, false);
assert.ok(airborne.failedStages.includes('combat'));

const broken = { ...receipt, acceptanceKey: 'tampered' };
assert.equal(isPlayerCombatAcceptanceReceipt(broken), false);

console.log('player combat acceptance checks passed');
