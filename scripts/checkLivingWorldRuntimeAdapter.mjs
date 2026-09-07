import assert from 'node:assert/strict';
import { attachLivingWorldRuntime, disposeLivingWorldRuntime, tickLivingWorldRuntime } from '../src/3d/gameplay/livingWorldRuntimeAdapter.js';

const actor = { object3D: { position: { x: 0, z: 0 }, userData: {} }, updates: 0, update() { this.updates += 1; } };
const state = { npcs: [actor], animals: [], creatures: [], dragons: [] };
const runtime = attachLivingWorldRuntime({ state, playerPositionProvider: () => ({ x: 0, z: 0 }) });
assert.equal(state.livingWorldRuntimeSlice, runtime);
const frame = tickLivingWorldRuntime(state, 0.1, { x: 0, z: 0 });
assert.equal(frame.lanes.npc.updated, 1);
assert.equal(actor.updates, 1);
disposeLivingWorldRuntime(state);
assert.equal(state.livingWorldRuntimeSlice, undefined);
assert.equal(tickLivingWorldRuntime(state, 0.1, { x: 0, z: 0 }).disposed, true);
console.log('living-world runtime adapter checks passed');
