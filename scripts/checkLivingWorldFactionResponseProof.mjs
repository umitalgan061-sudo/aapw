import assert from 'node:assert/strict';
import { planFactionResponseTick } from '../src/3d/gameplay/livingWorldFactionResponseBridge.js';
import { summarizeFactionResponseProof } from '../src/3d/gameplay/livingWorldFactionResponseProof.js';

const actors = [
  { id: 'guard-1', factionId: 'north-watch', canAttack: true },
  { id: 'wanted-1', factionId: 'raiders', fleeing: true },
  { id: 'citizen-1', factionId: 'north-watch' },
];
const services = {
  factions: { getFactionIdForActor: (actor) => actor.factionId },
  reputation: { getReputation: (_actor, target) => target.id === 'wanted-1' ? -80 : 60 },
  diplomacy: { getRelation: (a, b) => a === b ? 'ally' : 'war' },
  law: { getWantedLevel: (target) => target.id === 'wanted-1' ? 90 : 0 },
};
const plan = planFactionResponseTick({
  tick: 12,
  actors,
  observations: [
    { actorId: 'guard-1', targetId: 'citizen-1', confidence: 0.9 },
    { actorId: 'guard-1', targetId: 'wanted-1', confidence: 1 },
  ],
  services,
});
const proof = summarizeFactionResponseProof(plan, { expectedTick: 12, frameBudgetMs: 1.4 });
assert.equal(proof.accepted, true);
assert.equal(proof.deterministic, true);
assert.equal(proof.decisionCount, 2);
assert.equal(proof.eventCount, 1);
assert.equal(proof.actionCounts.assist, 1);
assert.equal(proof.actionCounts.pursue, 1);
assert.equal(proof.cooldownThrottled, 0);
assert.equal(proof.tickConsistent, true);
assert.equal(proof.frameBudgetWithinTarget, true);
assert.equal(proof.eventBudgetWithinPolicy, true);
assert.equal(typeof proof.fingerprint, 'string');
console.log(JSON.stringify({ marker: 'FACTION_RESPONSE_PROOF_OK', proof }));
