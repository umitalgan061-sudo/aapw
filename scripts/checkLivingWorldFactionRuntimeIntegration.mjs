import assert from 'node:assert/strict';
import {
  createLivingWorldReactionRuntime,
  livingWorldReactionDigest,
  auditLivingWorldReactionResult,
} from '../src/3d/gameplay/livingWorldReactionRuntime.js';

function makeActor(id, x, z, extra = {}) {
  return { id, object3D: { position: { x, z }, userData: {} }, ...extra };
}

const guard = makeActor('guard-1', 0, 0, { factionId: 'north-watch', canAttack: true });
const raider = makeActor('raider-1', 5, 0, { factionId: 'raiders' });
const farmer = makeActor('farmer-1', 200, 0, { factionId: 'north-watch', occupationSchedule: { phase: 'work', activityId: 'farm', locationId: 'field-1', shouldTravel: false } });

const events = [];
const attacks = [];
const navigations = [];
const runtime = createLivingWorldReactionRuntime({
  actors: [guard, raider, farmer],
  seed: 283,
  services: {
    perception: {
      sense: (actor) => actor.id === 'guard-1'
        ? [{ id: 'sight-raider', kind: 'visual', targetId: 'raider-1', position: { x: 5, z: 0 }, confidence: 1, distanceMeters: 5, visible: true, suspicious: true, severity: 90 }]
        : [],
    },
    factions: { getFactionIdForActor: (actor) => actor.factionId },
    reputation: { getReputation: () => -80 },
    diplomacy: { getRelation: (a, b) => a === b ? 'ally' : 'war' },
    law: {
      getWantedLevel: (target) => target.id === 'raider-1' ? 90 : 0,
      canArrest: () => true,
      reportCrime: () => true,
    },
    navigation: {
      move: (actor, directive) => { navigations.push({ actorId: actor.id, kind: directive.kind }); return { invoked: true }; },
    },
    combat: {
      attack: (actor, directive) => { if (directive.kind === 'attack') attacks.push(actor.id); return { invoked: directive.kind === 'attack' }; },
    },
    worldEvents: {
      emit: (event) => { if (event) events.push(event); return { invoked: Boolean(event) }; },
    },
  },
});

const phases = [];
for (let index = 0; index < 8; index += 1) {
  const result = runtime.tick({
    deltaSeconds: 0.2,
    playerPosition: { x: 0, z: 0 },
  });
  const guardResult = result.results.find((entry) => entry.actorId === 'guard-1');
  phases.push(guardResult?.phase ?? null);
  assert.equal(auditLivingWorldReactionResult(result).ok, true);
}

assert.equal(phases[0], 'detect');
assert.ok(phases.includes('investigate'));
assert.ok(phases.includes('chase'));
assert.ok(phases.includes('attack'));
assert.ok(attacks.length >= 1, 'combat owner receives attack delegation');
assert.ok(events.length >= 1, 'world-event owner receives bounded reaction event');
assert.ok(navigations.some((entry) => entry.kind === 'chase'));
assert.equal(farmer.object3D.userData.livingWorldReaction.phase, 'patrol');
assert.equal(farmer.object3D.userData.livingWorldReaction.occupation.activityId, 'farm');

const firstDigest = livingWorldReactionDigest(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
runtime.reset();
const secondDigest = livingWorldReactionDigest(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
assert.equal(typeof firstDigest, 'string');
assert.equal(typeof secondDigest, 'string');
assert.notEqual(firstDigest, secondDigest, 'later runtime state must advance after prior ticks');
runtime.reset();
const deterministicA = livingWorldReactionDigest(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
runtime.reset();
const deterministicB = livingWorldReactionDigest(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
assert.equal(deterministicA, deterministicB);

console.log(JSON.stringify({ marker: 'FACTION_RUNTIME_INTEGRATION_OK', phases, attacks: attacks.length, events: events.length, navigations: navigations.length, digest: deterministicA }));
