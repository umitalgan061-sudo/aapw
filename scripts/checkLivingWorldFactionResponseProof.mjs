import assert from 'node:assert/strict';
import {
  createLivingWorldReactionRuntime,
  auditLivingWorldReactionResult,
  livingWorldReactionDigest,
} from '../src/3d/gameplay/livingWorldReactionRuntime.js';
import { summarizeFactionResponseProof } from '../src/3d/gameplay/livingWorldFactionResponseProof.js';

function actor(id, x, z, extra = {}) {
  return { id, factionId: extra.factionId ?? 'north-watch', object3D: { position: { x, z }, userData: {} }, ...extra };
}

const guard = actor('guard-1', 0, 0, { canAttack: true });
const raider = actor('raider-1', 5, 0, { factionId: 'raiders' });
const farmer = actor('farmer-1', 200, 0, { occupationSchedule: { phase: 'work', activityId: 'farm', locationId: 'field-1', shouldTravel: false } });
const runtime = createLivingWorldReactionRuntime({
  actors: [guard, raider, farmer],
  seed: 283,
  services: {
    perception: { sense: (current) => current.id === 'guard-1' ? [{ id: 'sight-raider', kind: 'visual', targetId: 'raider-1', position: { x: 5, z: 0 }, confidence: 1, distanceMeters: 5, visible: true, suspicious: true, severity: 90 }] : [] },
    factions: { getFactionIdForActor: (current) => current.factionId },
    reputation: { getReputation: () => -80 },
    diplomacy: { getRelation: (a, b) => a === b ? 'ally' : 'war' },
    law: { getWantedLevel: (target) => target.id === 'raider-1' ? 90 : 0, canArrest: () => true, reportCrime: () => true },
    navigation: { requestPath: () => ({ invoked: true }) },
    encounters: { requestAttack: () => ({ invoked: true }) },
    worldEvents: { emit: (event) => ({ invoked: Boolean(event) }) },
  },
});

const first = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
assert.equal(auditLivingWorldReactionResult(first).ok, true);
const proof = summarizeFactionResponseProof(first, { expectedTick: first.tick, frameBudgetMs: 1.4 });
assert.equal(proof.accepted, true);
assert.equal(proof.deterministic, true);
assert.equal(proof.tickConsistent, true);
assert.equal(proof.frameBudgetWithinTarget, true);
assert.equal(proof.eventBudgetWithinPolicy, true);
assert.equal(proof.decisionBudgetWithinPolicy, true);
assert.equal(proof.hasRuntimeChain, true);
assert.equal(typeof proof.fingerprint, 'string');
assert.ok(Object.values(proof.actionCounts).some((count) => count >= 1));

const second = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
assert.equal(auditLivingWorldReactionResult(second).ok, true);
assert.notEqual(livingWorldReactionDigest(first), livingWorldReactionDigest(second));

const malformed = summarizeFactionResponseProof({ results: [{ phase: null, tick: 'bad' }], events: [] }, { expectedTick: 12 });
assert.equal(malformed.accepted, false);
assert.equal(malformed.tickConsistent, false);
assert.equal(malformed.actionCounts.unknown, 1);
assert.equal(malformed.hasRuntimeChain, false);

console.log(JSON.stringify({ marker: 'FACTION_RESPONSE_PROOF_OK', proof, malformed }));
