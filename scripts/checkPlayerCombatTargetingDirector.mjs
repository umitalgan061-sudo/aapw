import assert from 'node:assert/strict';
import { createPlayerCombatTargetingDirector, validatePlayerCombatTargetingSnapshot } from '../src/3d/gameplay/playerCombatTargetingDirector.js';
const d = createPlayerCombatTargetingDirector();
const input = { player: { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 } }, lockOn: true, targets: [{ id: 'far', position: { x: 0, y: 0, z: 45 } }, { id: 'near', position: { x: 0, y: 0, z: 4 }, hostile: true }, { id: 'dead', position: { x: 0, y: 0, z: 2 }, isAlive: false }] };
const first = d.update(input); assert.equal(first.selectedTargetId, 'near'); assert.equal(first.targets.length, 3); assert.equal(first.targets[0].reason, 'eligible'); assert.ok(validatePlayerCombatTargetingSnapshot(first)); assert.ok(Object.isFrozen(first.targets[0]));
const reordered = d.update({ ...input, targets: [...input.targets].reverse() }); assert.equal(reordered.digest, first.digest);
const malformed = d.update({ player: { position: { x: NaN, z: Infinity }, forward: { x: NaN, z: Infinity } }, targets: [{ position: { x: NaN, z: Infinity } }] }); assert.equal(malformed.selectedTargetId, null); assert.ok(Number.isFinite(malformed.targets[0].distanceMeters));
d.dispose(); assert.equal(d.read().selectedTargetId, null); console.log('player combat targeting director: PASS');
