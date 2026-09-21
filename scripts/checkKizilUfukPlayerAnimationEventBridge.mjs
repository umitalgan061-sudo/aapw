import assert from 'node:assert/strict';
import { createPlayerAnimationEventBridge, validatePlayerAnimationEvent } from '../src/3d/gameplay/playerAnimationEventBridge.js';

function run() {
  let clock = 1000;
  const bridge = createPlayerAnimationEventBridge({ now: () => clock, maxHistory: 3 });
  const light = bridge.project('lightAttack', { source: 'keyboard', comboStep: 1, intensity: 1.2 });
  assert.equal(light.action, 'light');
  assert.equal(light.clip, 'attack_light');
  assert.equal(light.phases.activeMs, 120);
  assert.equal(light.interruptibleAfterMs, 180);
  assert.equal(validatePlayerAnimationEvent(light), true);
  assert.equal(Object.isFrozen(light), true);
  assert.equal(Object.isFrozen(light.phases), true);

  clock += 50;
  const parry = bridge.project('parry', { source: 'gamepad', intensity: 2 });
  assert.equal(parry.intensity, 1.5);
  assert.equal(parry.serial, 2);

  clock += 50;
  bridge.project('unsupported', { source: 'touch' });
  bridge.project('heavyAttack', { source: 'touch', comboStep: 2 });
  bridge.project('dodge', { source: 'touch' });
  assert.equal(bridge.recent(10).length, 3);
  assert.equal(bridge.recent(10)[0].clip, 'attack_heavy');

  const replayA = bridge.recent(3).map((event) => ({ ...event, phases: { ...event.phases } }));
  bridge.reset();
  clock = 1000;
  bridge.project('lightAttack', { source: 'keyboard', comboStep: 1, intensity: 1.2 });
  clock += 50;
  bridge.project('parry', { source: 'gamepad', intensity: 2 });
  clock += 50;
  bridge.project('heavyAttack', { source: 'touch', comboStep: 2 });
  clock += 50;
  bridge.project('dodge', { source: 'touch' });
  const replayB = bridge.recent(3).map((event) => ({ ...event, phases: { ...event.phases } }));
  assert.deepEqual(replayA, replayB);

  bridge.dispose();
  assert.equal(bridge.project('light'), null);
  assert.deepEqual(bridge.recent(3), []);
}

run();
console.log('Kızıl Ufuk animation event bridge PASS');
