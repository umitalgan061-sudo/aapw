import assert from 'node:assert/strict';
import { PlayerCombatDecisionV6 } from '../src/3d/gameplay/playerCombatDecisionV6.ts';
import { projectPlayerCombatRuntimeFrameV7, submitPlayerCombatRuntimeFrameV7 } from '../src/3d/gameplay/playerCombatRuntimeContractV7.ts';

const player = {
  id: 'player-v7',
  objectId: 'player-object-v7',
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  yaw: 0,
  grounded: true,
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  sprinting: false,
  alive: true,
};

const firstDecision = new PlayerCombatDecisionV6();
const firstFrame = submitPlayerCombatRuntimeFrameV7(firstDecision, player, 'lightAttack', 1);
assert.equal(firstFrame.version, 7);
assert.equal(firstFrame.action, 'light');
assert.equal(firstFrame.animationLocked, true);
assert.equal(firstFrame.hitboxActive, false);
assert.equal(firstFrame.stamina01, 1);
assert.match(firstFrame.checksum, /^[0-9a-f]{8}$/);
assert(Object.isFrozen(firstFrame));

const activeReceipt = firstDecision.tick(player, 0.16, 2);
const activeFrame = projectPlayerCombatRuntimeFrameV7(player, 2, activeReceipt);
assert.equal(activeFrame.phase, 'active');
assert.equal(activeFrame.hitboxActive, true);
assert.equal(activeFrame.locomotionWeight, 0.1);

const secondDecision = new PlayerCombatDecisionV6();
const secondFrame = submitPlayerCombatRuntimeFrameV7(secondDecision, player, 'light', 1);
assert.equal(firstFrame.checksum, secondFrame.checksum);
assert.deepEqual(firstFrame, secondFrame);

console.log(JSON.stringify({
  contract: 'player-combat-runtime-v7',
  checks: 12,
  initial: firstFrame,
  active: activeFrame,
  deterministic: firstFrame.checksum === secondFrame.checksum,
}));
