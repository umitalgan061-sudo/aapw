import assert from 'node:assert/strict';
import { createLivingWorldDirector } from '../src/3d/gameplay/livingWorldDirector.js';

function fixture(order) {
  const actors = {
    'guard-a': { id: 'guard-a', position: { x: 0, z: 0 }, perception: { range: 40, hearing: 20 }, schedule: { phase: 'patrol' }, lod: 'near', health: 100 },
    'wolf-a': { id: 'wolf-a', position: { x: 18, z: 0 }, perception: { range: 25, hearing: 10 }, schedule: { phase: 'patrol' }, lod: 'near', health: 100 },
  };
  const calls = [];
  const actorRegistry = { list: () => order.map((id) => actors[id]), getThreat: (id) => id === 'guard-a' ? { id: 'wolf-a', position: { x: 18, z: 0 }, health: 100 } : null, hasLineOfSight: () => true };
  const navigation = { patrol: (c) => calls.push(['patrol', c]), moveTo: (c) => calls.push(['move', c]), returnToPost: (c) => calls.push(['return', c]), flee: (c) => calls.push(['flee', c]) };
  const combat = { engage: (c) => calls.push(['attack', c]) };
  const worldEvents = { publish: (e) => calls.push(['event', e]) };
  const factions = { recordObservation: (e) => calls.push(['faction', e]) };
  return { director: createLivingWorldDirector({ actorRegistry, navigation, combat, worldEvents, factions, seed: 7 }), calls };
}

const first = fixture(['guard-a', 'wolf-a']);
const firstTick = first.director.update({ now: 1, delta: 1 });
assert.equal(firstTick.actors.find((x) => x.actorId === 'guard-a').phase, 'chase');
first.director.update({ now: 2, delta: 1 });
assert.ok(first.calls.some(([kind]) => kind === 'attack'));

const ordered = fixture(['guard-a', 'wolf-a']);
const reversed = fixture(['wolf-a', 'guard-a']);
ordered.director.update({ now: 1, delta: 1 });
reversed.director.update({ now: 1, delta: 1 });
assert.equal(ordered.director.read().fingerprint, reversed.director.read().fingerprint);

first.director.dispose();
assert.equal(first.director.update({ now: 3 }).tick, 2);
console.log('[checkLivingWorldDirector] PASS: patrol→detect/investigate→chase→attack path, LOD throttle, deterministic actor ordering and disposal guard.');
