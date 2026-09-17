import assert from 'node:assert/strict';
import { PlayerCombatDecisionV6 } from '../src/3d/gameplay/playerCombatDecisionV6.ts';
import { projectPlayerCombatRuntimeFrameV7 } from '../src/3d/gameplay/playerCombatRuntimeContractV7.ts';
import {
  freezePlayerCombatRuntimeFrameV7,
  freezeValidatedPlayerCombatRuntimeFrameV7,
  isPlayerCombatRuntimeFrameDeeplyFrozenV7,
} from '../src/3d/gameplay/playerCombatRuntimeFrameSafetyV7.ts';

const player = {
  id: 'safety-v7', objectId: 'safety-object-v7', position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 }, yaw: 0, grounded: true,
  health: 100, maxHealth: 100, stamina: 100, maxStamina: 100,
  sprinting: false, alive: true,
};
const decision = new PlayerCombatDecisionV6();
const receipt = decision.tick(player, 0.16, 2);
const frame = projectPlayerCombatRuntimeFrameV7(player, 2, receipt);
const safe = freezePlayerCombatRuntimeFrameV7(frame);
const validatedSafe = freezeValidatedPlayerCombatRuntimeFrameV7(projectPlayerCombatRuntimeFrameV7(player, 2, receipt));

assert(Object.isFrozen(safe));
assert(isPlayerCombatRuntimeFrameDeeplyFrozenV7(safe));
assert(isPlayerCombatRuntimeFrameDeeplyFrozenV7(validatedSafe));
assert.throws(() => {
  if (safe.feedback && typeof safe.feedback === 'object') safe.feedback.kind = 'tampered';
}, TypeError);
assert.throws(() => {
  freezeValidatedPlayerCombatRuntimeFrameV7({ ...frame, checksum: '00000000' });
}, /Invalid player combat runtime frame/);
assert.equal(isPlayerCombatRuntimeFrameDeeplyFrozenV7(safe), true);

console.log(JSON.stringify({
  contract: 'player-combat-runtime-frame-safety-v7',
  checks: 6,
  deeplyFrozen: isPlayerCombatRuntimeFrameDeeplyFrozenV7(validatedSafe),
  validated: true,
}));
