import assert from 'node:assert/strict';
import { createLivingWorldAgent, createDeterministicWorldEventDirector, createReputationLedger, evaluateCrime, evaluatePerception, STATES } from '../src/3d/gameplay/livingWorldDirector.js';

const perception = evaluatePerception({ observer: { x: 0, z: 0 }, target: { x: 0, z: 6 }, forward: { x: 0, z: 1 }, visionRange: 10, lineOfSight: true });
assert.equal(perception.detected, true);
assert.equal(evaluatePerception({ observer: { x: 0, z: 0 }, target: { x: 0, z: 6 }, forward: { x: 0, z: 1 }, visionRange: 10, lineOfSight: false }).detected, false);

const ledger = createReputationLedger({ north: 90 });
assert.equal(ledger.adjust('north', 20), 100);
assert.equal(ledger.adjust('north', -250), -100);

const crime = evaluateCrime({ law: { enabled: true }, actorId: 'thief', victimFaction: 'reach', severity: 2, witnessIds: ['guard', 'guard'] });
assert.deepEqual(crime.witnessIds, ['guard']);
assert.equal(crime.wanted, true);

const transitions = [];
const guard = createLivingWorldAgent({ id: 'guard-1', role: 'guard', home: { x: 0, z: 0 }, onStateChange: (event) => transitions.push(event.state) });
guard.observe({ delta: 0.25, targetPosition: { x: 0, z: 1.5 }, lineOfSight: true });
assert.equal(guard.state, STATES.ATTACK);
assert.equal(transitions.at(-1), STATES.ATTACK);

guard.observe({ delta: 0.25, targetPosition: null });
assert.equal(guard.state, STATES.INVESTIGATE);

const eventA = createDeterministicWorldEventDirector({ seed: 77, cooldownSeconds: 0 });
const eventB = createDeterministicWorldEventDirector({ seed: 77, cooldownSeconds: 0 });
const candidates = [{ type: 'wolf-pack', anchorId: 'north-road' }, { type: 'market', anchorId: 'winter-town' }];
assert.deepEqual(eventA.tick(0.1, candidates), eventB.tick(0.1, candidates));

console.log('LIVING_WORLD_DIRECTOR_CONTRACT_PASS');
