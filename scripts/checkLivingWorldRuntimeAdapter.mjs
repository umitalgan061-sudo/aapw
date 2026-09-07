import assert from 'node:assert/strict';
import { attachLivingWorldDirector, tickLivingWorldDirector } from '../src/3d/gameplay/livingWorldRuntimeAdapter.js';

const makeObject = (name, x, z, extra = {}) => ({
  name,
  position: { x, y: 0, z },
  userData: { ...extra },
});
const state = {
  npcs: [{ object3D: makeObject('guard-1', 0, 0), update() {} }],
  creatures: [{ object3D: makeObject('wolf-1', 15, 0, { speciesId: 'wolf' }), update() {} }],
  settlementSeats: [{ type: 'roadside-encounter', anchorId: 'seat-1' }],
};
const director = attachLivingWorldDirector({ state, worldSeed: 77 });
assert.equal(director.agents.length, 2);
const first = tickLivingWorldDirector(state, 0.1, { x: 6, z: 0 });
const second = tickLivingWorldDirector(state, 0.1, { x: 6, z: 0 });
assert.equal(first.dt, 0.1);
assert.equal(second.dt, 0.1);
assert.ok(state.npcs[0].object3D.userData.livingWorldDirector);
assert.ok(state.creatures[0].object3D.userData.livingWorldDirector);
assert.deepEqual(first.events, second.events);
director.dispose();
assert.equal(state.npcs[0].object3D.userData.livingWorldDirector, undefined);
console.log('LIVING_WORLD_RUNTIME_ADAPTER_PASS');
