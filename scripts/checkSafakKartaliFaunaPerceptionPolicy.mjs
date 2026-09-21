import assert from 'node:assert/strict';
import { createLivingWorldFaunaPerceptionPolicy } from '../src/3d/gameplay/livingWorldFaunaPerceptionPolicy.js';

const actors = [
  { id: 'wolf-2', position: { x: 4, y: 0, z: 0 }, headingDegrees: 270, lineOfSight: true },
  { id: 'wolf-1', position: { x: 0, y: 0, z: 0 }, headingDegrees: 90, lineOfSight: true },
];
const stimuli = [
  { id: 'traveller', type: 'actor', sourceId: 'player', position: { x: 8, y: 0, z: 0 }, intensity: 1, channel: 'vision' },
  { id: 'branch-crack', type: 'noise', position: { x: 10, y: 0, z: 0 }, intensity: 0.8, channel: 'hearing' },
  { id: 'far-noise', type: 'noise', position: { x: 60, y: 0, z: 0 }, intensity: 1, channel: 'hearing' },
];

function run(inputActors) {
  return createLivingWorldFaunaPerceptionPolicy({ maxActors: 8, maxStimuliPerActor: 4 }).evaluate({
    actors: inputActors,
    stimuli,
    nowSeconds: 2,
  });
}

const first = run(actors);
const second = run([...actors].reverse());
assert.deepEqual(first, second, 'actor order must not change perception output');
assert.equal(first.observations.length, 2);
assert.equal(first.observations[0].actorId, 'wolf-1');
assert.equal(first.observations[0].observations[0].id, 'traveller');
assert.equal(first.observations[0].observations[0].response, 'engage');
assert.equal(first.observations[1].observations.some((entry) => entry.id === 'branch-crack'), true);
assert.equal(first.observations.flatMap((entry) => entry.observations).some((entry) => entry.id === 'far-noise'), false);

const stealthPolicy = createLivingWorldFaunaPerceptionPolicy();
const exposed = stealthPolicy.evaluate({
  actors: [{ id: 'sentinel', position: { x: 0, y: 0, z: 0 }, headingDegrees: 90, lineOfSight: true }],
  stimuli: [{ id: 'exposed', position: { x: 8, y: 0, z: 0 }, intensity: 1, stealth: 0, channel: 'vision' }],
});
const hidden = stealthPolicy.evaluate({
  actors: [{ id: 'sentinel', position: { x: 0, y: 0, z: 0 }, headingDegrees: 90, lineOfSight: true }],
  stimuli: [{ id: 'hidden', position: { x: 8, y: 0, z: 0 }, intensity: 1, stealth: 1, channel: 'vision' }],
});
assert.equal(exposed.observations[0].observations[0].response, 'engage');
assert.equal(hidden.observations[0].observations[0].response, 'ignore');
assert.equal(hidden.observations[0].observations[0].score < exposed.observations[0].observations[0].score, true);

const blocked = createLivingWorldFaunaPerceptionPolicy().evaluate({
  actors: [{ id: 'blocked', position: { x: 0, y: 0, z: 0 }, headingDegrees: 0, lineOfSight: false }],
  stimuli: [{ id: 'hidden', position: { x: 0, y: 0, z: 10 }, intensity: 1, channel: 'vision' }],
});
assert.equal(blocked.observations[0].observations.length, 0);

const disposed = createLivingWorldFaunaPerceptionPolicy();
disposed.dispose();
assert.throws(() => disposed.evaluate({ actors: [], stimuli: [] }), /disposed/);

console.log('Safak Kartali fauna perception policy proof: PASS');
