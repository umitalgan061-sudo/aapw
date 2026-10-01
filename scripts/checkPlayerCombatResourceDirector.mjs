import assert from 'node:assert/strict';
import { createPlayerCombatResourceDirector } from '../src/3d/gameplay/playerCombatResourceDirector.js';

const run = () => {
  const director = createPlayerCombatResourceDirector({ maxHealth: 100, maxStamina: 50, maxPoise: 40 });
  const initial = director.snapshot();
  assert.equal(initial.health, 100);
  assert.equal(initial.stamina, 50);
  assert.equal(director.spendStamina(12, 'dodge'), true);
  assert.equal(director.spendStamina(1000, 'heavy'), false);
  director.setGuard(true);
  const hit = director.applyDamage(20, 10);
  assert.equal(hit.applied, true);
  assert.equal(hit.staggered, false);
  assert.equal(hit.state.health, 93);
  director.applyDamage(999, 40);
  assert.equal(director.snapshot().lastAction, 'stagger');
  director.update(1, { moving: false, sprinting: false });
  const recovered = director.snapshot();
  assert.ok(recovered.stamina > 38);
  assert.ok(recovered.poise > 0);
  Object.freeze(recovered);
  return JSON.stringify(recovered);
};

const first = run();
const second = run();
assert.equal(first, second, 'director output must be deterministic');
console.log('player combat resource director: ok');
