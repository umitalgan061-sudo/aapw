import {
  LIVING_WORLD_REACTION_INTEGRATION_POLICY,
  auditLivingWorldReactionIntegration,
  createLivingWorldReactionIntegration,
} from '../src/3d/gameplay/livingWorldReactionIntegrationAdapter.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function equal(actual, expected, message) {
  assert(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function actor(id, factionId = 'watch') {
  return {
    id,
    factionId,
    object3D: { name: id, position: { x: 4, z: 6 }, userData: {} },
    update() {},
  };
}

assert(LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors === 128, 'integration actor budget stays aligned with reaction runtime');
equal(LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxGroups, 24, 'integration group budget stays bounded');
assert(LIVING_WORLD_REACTION_INTEGRATION_POLICY.reactionPolicyId.includes('living-world-reaction'), 'integration pins the reaction runtime policy identity');

const guard = actor('integration-guard', 'watch');
const wolf = actor('integration-wolf', 'wildlife');
const calls = [];
const integration = createLivingWorldReactionIntegration({
  seed: 'integration-seed',
  clockSeconds: 21600,
  services: {
    perception: { sense(subject) { calls.push(`sense:${subject.id}`); return []; } },
    factions: { getFactionIdForActor(subject) { return subject.factionId; } },
    worldEvents: { publish(event) { calls.push(`event:${event.type}`); return true; } },
    navigation: { requestTravel() { calls.push('navigation'); return true; } },
    encounters: { shouldChase() { return false; }, canAttack() { return false; } },
  },
});

const first = integration.tick({
  deltaSeconds: 0.1,
  collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] },
  occupations: [],
  faunaRequests: [],
  eventContext: { worldSeed: 'integration-seed', playerX: 0, playerZ: 0 },
  eventTypes: ['traveller_sighting'],
  groups: [{ id: 'watch-pair', members: [guard, wolf], threatPositions: [{ x: 8, z: 6 }], seed: 'group-seed' }],
  playerPosition: { x: 0, z: 0 },
});

equal(first.accepted, true, 'composition tick is accepted');
equal(first.actorCount, 2, 'composition preserves caller actor collection');
equal(first.reaction.actorCount, 2, 'reaction layer sees exactly the same actors');
equal(first.groups.groupCount, 1, 'existing group director remains authoritative for group output');
assert(first.director != null, 'existing living-world director still runs beside reaction adapter');
assert(first.ownerSnapshot.actors.length === 2, 'composition exposes shared owner snapshot without copying controller ownership');
assert(first.reaction.results.every((entry) => entry.phase === 'patrol'), 'no perception signal leaves both actors on patrol');
assert(calls.some((entry) => entry === 'sense:integration-guard'), 'reaction perception service is invoked for existing actor');
assert(calls.some((entry) => entry === 'sense:integration-wolf'), 'reaction perception service is invoked for fauna actor');

const second = integration.tick({
  deltaSeconds: 0.2,
  collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] },
  groups: [],
  playerPosition: { x: 0, z: 0 },
});
equal(second.tick, 2, 'integration tick counter is deterministic');
assert(integration.audit().ok, 'composed director and reaction runtime remain auditable');
assert(auditLivingWorldReactionIntegration(second).ok, 'integrated result passes composition audit');

const beforeDispose = integration.snapshot();
assert(beforeDispose.tick === 2, 'snapshot records composed tick count');
equal(integration.dispose(), true, 'integration disposes both composed owners');
equal(integration.tick({ deltaSeconds: 0.1, collections: { npcs: [guard] } }).accepted, false, 'disposed composition refuses new simulation');

// The composition is not allowed to create a replacement group or combat framework.
const serialized = JSON.stringify(first);
for (const forbidden of ['FactionManager', 'ReputationManager', 'WorldEventSystem', 'MaterialAssignmentCore', 'WorldAssetPlacementPipeline', 'new THREE.']) {
  assert(!serialized.includes(forbidden), `integrated runtime result does not expose duplicate framework marker: ${forbidden}`);
}

if (failures.length) {
  console.error(`[living-world-reaction-integration] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[living-world-reaction-integration] PASS: ${passed} composition assertions.`);
