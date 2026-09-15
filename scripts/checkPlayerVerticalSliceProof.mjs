import assert from 'node:assert/strict';
import { buildPlayerVerticalSliceProof, serializePlayerVerticalSliceProof, validatePlayerVerticalSliceProof } from '../src/3d/gameplay/playerVerticalSliceProof.js';

const snapshot = {
  spawned: true,
  spawn: { x: 12, z: -4 },
  position: { x: 12, y: 8.5, z: -4 },
  groundY: 8.5,
  input: { source: 'gamepad', move: { x: 0.8, y: -0.2 }, look: { x: 0.1, y: 0 }, actions: ['attack-light', 'lock-on', 'attack-light'] },
  animation: { locomotion: 'run', action: 'light-attack', defense: 'none', layers: [{ name: 'upper-body', weight: 0.8, additive: true }] },
  combat: { state: 'attack-light', targetId: 'wolf-01', stamina: 72, poise: 90, activeWindow: true, lastEvent: { type: 'attack-window', outcome: 'active', serial: 4 } },
  equipment: { slots: [{ slot: 'main-hand', itemId: 'arming-sword', socket: 'mixamorigRightHand', ready: true, surfaceRoles: ['metal', 'leather'] }], missingAssetCount: 0, placementValidated: true },
};

const proof = buildPlayerVerticalSliceProof(snapshot);
assert.equal(proof.acceptance.complete, true);
assert.equal(proof.acceptance.playerRelativeGrounding, true);
assert.equal(proof.acceptance.inputParity, true);
assert.deepEqual(validatePlayerVerticalSliceProof(proof), { valid: true, reasons: [] });
assert.equal(serializePlayerVerticalSliceProof(snapshot), serializePlayerVerticalSliceProof(snapshot));
assert.equal(Object.isFrozen(proof), true);
assert.equal(Object.isFrozen(proof.acceptance), true);
assert.equal(proof.input.actions.length, 3);

const broken = buildPlayerVerticalSliceProof({ ...snapshot, pageErrorCount: 1, equipment: { ...snapshot.equipment, missingAssetCount: 1 } });
const brokenResult = validatePlayerVerticalSliceProof(broken);
assert.equal(brokenResult.valid, false);
assert.deepEqual(brokenResult.reasons, ['missing-asset', 'page-error']);

console.log('player vertical slice proof contract: ok');
