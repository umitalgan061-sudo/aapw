import assert from 'node:assert/strict';
import {
  PLAYER_COMBAT_MOMENTUM_CONFIG as C,
  createPlayerCombatMomentumDirector,
} from '../src/3d/gameplay/playerCombatMomentumDirector.js';

const director = createPlayerCombatMomentumDirector({ emit: false });

director.setEquipment({ attack: { damageScale: Number.NaN }, movement: { movementMultiplier: Infinity } });
assert.equal(director.read().equipment.damageScale, 0.1);
assert.equal(director.read().equipment.movementMultiplier, 1.75);

for (const value of [-1, Number.NaN, Infinity, -Infinity, 0.1, 0.5]) {
  director.update(value, 1);
  const snapshot = director.read();
  assert.ok(snapshot.score >= 0 && snapshot.score <= C.maxScore);
  assert.ok(snapshot.finisherWindowRemaining >= 0);
  assert.ok(snapshot.finisherCooldownRemaining >= 0);
}

const event = director.observe({
  type: 'aapw:player-attack-window',
  detail: { phase: 'active-start', confirmed: true, attackKind: 'heavy', comboStep: 3, timestamp: 2 },
});
assert.equal(event.state.totalActions, 1);
assert.equal(event.source, 'combat-feedback');
assert.ok(event.sequence > 0);
console.log('PLAYER_COMBAT_MOMENTUM_BOUNDARY_PASS');
