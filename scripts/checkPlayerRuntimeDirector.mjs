import assert from 'node:assert/strict';
import { createPlayerRuntimeDirector, validatePlayerRuntimeDirector } from '../src/3d/gameplay/playerRuntimeDirector.js';

const observation = {
  player: { x: 0, z: 0 },
  input: { source: 'gamepad', connected: true, move: { x: 0.8, y: 0 }, actions: ['target', 'attack', 'attack'] },
  state: { alive: true, grounded: true, attacking: true },
  resources: { stamina: 87, poise: 55 },
  equipment: { weaponId: 'iron-sword', socketsReady: true },
  targets: [{ id: 'wolf-2', x: 4, z: 0, hostile: true, visible: true }, { id: 'wolf-1', x: 4, z: 0, hostile: true, visible: true }, { id: 'ally', x: 1, z: 0, hostile: false, visible: true }],
};

const director = createPlayerRuntimeDirector();
const first = director.snapshot(observation);
const second = director.snapshot(observation);
assert.equal(first.target.id, 'wolf-1');
assert.equal(first.input.actions.join(','), 'lockOn,light');
assert.equal(first.animation.combat, 'lightAttack');
assert.equal(first.handoff.materialPlacement, 'merged-#590');
assert.equal(first.fingerprint, second.fingerprint.replace('"revision":2', '"revision":1'));
assert.ok(Object.isFrozen(first));
assert.ok(validatePlayerRuntimeDirector(first));
assert.throws(() => { first.state.stamina = 1; }, TypeError);

director.dispose();
const disposed = director.snapshot(observation);
assert.equal(disposed.disposed, true);
assert.equal(director.getStatus().disposed, true);
console.log('player runtime director: ok');
