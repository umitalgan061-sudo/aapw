import assert from 'node:assert/strict';
import { createPlayerCombatPresentationDirector, validatePlayerCombatPresentationReceipt } from '../src/3d/gameplay/playerCombatPresentationDirector.js';

const run = () => {
  const director = createPlayerCombatPresentationDirector({ maxHistory: 4 });
  const light = director.emit({ action: 'light', sequence: 1, targetId: 'wolf', intensity: 0.8 });
  const heavy = director.emit({ action: 'heavy', sequence: 2, targetId: 'wolf' });
  const dodge = director.emit({ action: 'roll', sequence: 3 });
  assert.equal(light.animation.clip, 'attack-light');
  assert.equal(heavy.interruptible, false);
  assert.equal(dodge.action, 'dodge');
  assert.equal(validatePlayerCombatPresentationReceipt(heavy), true);
  assert.equal(director.emit({ action: 'unknown', sequence: 4 }), null);
  assert.equal(director.emit({ action: 'parry', sequence: 3 }), null);
  assert.equal(director.history().length, 3);
  assert.equal(Object.isFrozen(heavy.feedback), true);
  director.dispose();
  assert.equal(director.emit({ action: 'hit', sequence: 4 }), null);
  return [light, heavy, dodge];
};

const first = run();
const second = run();
assert.deepEqual(first, second);
console.log('kizil ufuk combat presentation director: PASS');
